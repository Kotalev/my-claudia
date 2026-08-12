import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpendLedger } from '../spend-ledger.js'
import { makeEntry } from '../../../../test/helpers/entry.js'
import type { EntryUsage, TranscriptEntry } from '../../../transcript/types.js'

function usage(over: Partial<EntryUsage> = {}): EntryUsage {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
    thinkingTokens: null, webSearchRequests: 0, webFetchRequests: 0,
    serviceTier: null, inferenceGeo: null, speed: null, ...over,
  }
}

/** One assistant turn worth exactly $5: a million input tokens on claude-opus-5. */
function turn(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return makeEntry({
    role: 'assistant', model: 'claude-opus-5',
    usage: usage({ inputTokens: 1_000_000 }), ...over,
  })
}

/** Noon `daysBack` local calendar days ago — noon so no timezone flips the day. */
function at(daysBack: number, now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, 12).toISOString()
}

describe('SpendLedger', () => {
  it('reports null, not NaN, when it holds nothing', () => {
    const s = new SpendLedger().summary()
    expect(s.todayUsd).toBeNull()
    expect(s.sevenDayUsd).toBeNull()
    expect(s.thirtyDayUsd).toBeNull()
    expect(s.unpricedModels).toEqual([])
    expect(Date.parse(s.updatedAt)).not.toBeNaN()
  })

  it('prices one entry into every window it belongs to', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ messageId: 'm1', timestamp: at(0) }))
    const s = ledger.summary()
    expect(s.todayUsd).toBeCloseTo(5)
    expect(s.sevenDayUsd).toBeCloseTo(5)
    expect(s.thirtyDayUsd).toBeCloseTo(5)
  })

  it('counts a message reported twice once, keeping the larger report', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ uuid: 'a', messageId: 'm1', timestamp: at(0) }))
    ledger.addEntry('p1', turn({
      uuid: 'b', messageId: 'm1', timestamp: at(0),
      usage: usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    }))
    // 1M input at $5 + 1M output at $25 — the max of the two reports, once.
    expect(ledger.summary().todayUsd).toBeCloseTo(30)
  })

  it('buckets by local calendar day and sums the right days into each window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 12, 15, 0, 0))
    try {
      const ledger = new SpendLedger()
      for (const daysBack of [0, 6, 7, 29, 30]) {
        ledger.addEntry('p1', turn({ messageId: `m${daysBack}`, timestamp: at(daysBack) }))
      }
      const s = ledger.summary()
      expect(s.todayUsd).toBeCloseTo(5)        // day 0 only
      expect(s.sevenDayUsd).toBeCloseTo(10)    // days 0 and 6; day 7 is outside
      expect(s.thirtyDayUsd).toBeCloseTo(20)   // days 0, 6, 7, 29; day 30 is outside
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects entries older than the retention window outright', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ messageId: 'old', timestamp: at(40) }))
    expect(ledger.summary().thirtyDayUsd).toBeNull()
  })

  it('prunes buckets once the clock moves past their retention', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 12, 15, 0, 0))
    try {
      const ledger = new SpendLedger()
      ledger.addEntry('p1', turn({ messageId: 'm1', timestamp: at(0) }))
      expect(ledger.summary().thirtyDayUsd).toBeCloseTo(5)
      vi.setSystemTime(new Date(2026, 8, 13, 15, 0, 0)) // 32 days later
      const s = ledger.summary()
      expect(s.todayUsd).toBeNull()
      expect(s.thirtyDayUsd).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a project on removeProject and keeps the others', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ messageId: 'm1', timestamp: at(0) }))
    ledger.addEntry('p2', turn({ messageId: 'm2', timestamp: at(0) }))
    ledger.removeProject('p1')
    expect(ledger.summary().todayUsd).toBeCloseTo(5)
  })

  it('surfaces unpriced models instead of pricing them at zero', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ messageId: 'm1', timestamp: at(0) }))
    ledger.addEntry('p1', turn({ messageId: 'm2', timestamp: at(0), model: 'claude-novel-9' }))
    const s = ledger.summary()
    expect(s.todayUsd).toBeCloseTo(5)
    expect(s.unpricedModels).toEqual(['claude-novel-9'])
  })

  it('ignores entries that are not countable', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ messageId: 'm1', timestamp: at(0), isApiError: true }))
    ledger.addEntry('p1', makeEntry({ timestamp: at(0), text: 'no usage at all' }))
    expect(ledger.summary().todayUsd).toBeNull()
  })

  it('skips an entry whose timestamp is unreadable', () => {
    const ledger = new SpendLedger()
    ledger.addEntry('p1', turn({ messageId: 'm1', timestamp: 'not a date' }))
    expect(ledger.summary().todayUsd).toBeNull()
  })
})

describe('SpendLedger.scanProject', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spend-ledger-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function rawLine(messageId: string, timestamp: string): string {
    return JSON.stringify({
      type: 'assistant', uuid: `u-${messageId}`, sessionId: 's1', timestamp,
      message: {
        id: messageId, model: 'claude-opus-5', role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })
  }

  it('is idempotent with the live feed: scan then live report of the same message', async () => {
    const ts = at(0)
    await writeFile(join(dir, 'a.jsonl'), rawLine('m1', ts) + '\n')
    const ledger = new SpendLedger()
    await ledger.scanProject('p1', dir)
    ledger.addEntry('p1', turn({ uuid: 'live', messageId: 'm1', timestamp: ts }))
    expect(ledger.summary().todayUsd).toBeCloseTo(5)
  })

  it('skips malformed and bookkeeping lines without losing the valid ones', async () => {
    const lines = [
      'not json at all',
      '{"type":"summary","summary":"x"}',
      '{"truncated', rawLine('m1', at(0)), '',
    ]
    await writeFile(join(dir, 'a.jsonl'), lines.join('\n'))
    const ledger = new SpendLedger()
    await ledger.scanProject('p1', dir)
    expect(ledger.summary().todayUsd).toBeCloseTo(5)
  })

  it('does not open files whose mtime is older than retention', async () => {
    const path = join(dir, 'stale.jsonl')
    await writeFile(path, rawLine('m1', at(0)) + '\n')
    const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000
    await utimes(path, old, old)
    const ledger = new SpendLedger()
    await ledger.scanProject('p1', dir)
    expect(ledger.summary().todayUsd).toBeNull()
  })

  it('does not resurrect a project removed while its scan is in flight', async () => {
    await writeFile(join(dir, 'a.jsonl'), rawLine('m1', at(0)) + '\n')
    const ledger = new SpendLedger()
    const scan = ledger.scanProject('p1', dir)
    // The route callback runs before the unawaited scan reaches its first entry.
    ledger.removeProject('p1')
    await scan
    expect(ledger.summary().todayUsd).toBeNull()
  })

  it('scans normally when the project is re-registered after a removal', async () => {
    await writeFile(join(dir, 'a.jsonl'), rawLine('m1', at(0)) + '\n')
    const ledger = new SpendLedger()
    ledger.removeProject('p1')
    await ledger.scanProject('p1', dir)
    expect(ledger.summary().todayUsd).toBeCloseTo(5)
  })

  it('ignores non-jsonl files and survives a missing directory', async () => {
    await writeFile(join(dir, 'notes.txt'), rawLine('m1', at(0)) + '\n')
    const ledger = new SpendLedger()
    await ledger.scanProject('p1', dir)
    await ledger.scanProject('p2', join(dir, 'does-not-exist'))
    expect(ledger.summary().todayUsd).toBeNull()
  })
})
