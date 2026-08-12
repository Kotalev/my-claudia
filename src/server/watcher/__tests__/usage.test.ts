import { describe, it, expect } from 'vitest'
import { UsageAccumulator, maxUsage, contextTokensOf, isCountable, emptyTotals } from '../usage.js'
import { makeEntry } from '../../../../test/helpers/entry.js'
import type { EntryUsage } from '../../../transcript/types.js'

function usage(over: Partial<EntryUsage> = {}): EntryUsage {
  return {
    inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 100,
    cacheCreationInputTokens: 30, cacheCreation5mInputTokens: 30, cacheCreation1hInputTokens: 0,
    thinkingTokens: null, webSearchRequests: 0, webFetchRequests: 0,
    serviceTier: 'standard', inferenceGeo: 'not_available', speed: null, ...over,
  }
}

const assistant = (over = {}) => makeEntry({ role: 'assistant', usage: usage(), model: 'claude-opus-5', ...over })

describe('UsageAccumulator', () => {
  it('starts at zero, not at null or NaN', () => {
    const snap = new UsageAccumulator().snapshot()
    expect(snap.total).toEqual(emptyTotals())
    expect(snap.contextTokens).toBeNull()   // no turn yet is not the same as an empty context
    expect(snap.models).toEqual([])
    expect(snap.compactions).toBe(0)
  })

  it('sums one assistant turn', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1' }))
    expect(acc.snapshot().total).toMatchObject({
      inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 100,
      cacheCreationInputTokens: 30, messages: 1,
    })
  })

  it('counts a response split over several lines once', () => {
    // Claude Code writes one line per content block, each repeating the same
    // usage. Summing lines instead of messages inflates every total.
    const acc = new UsageAccumulator()
    acc.add(assistant({ uuid: 'a', messageId: 'msg_1' }))
    acc.add(assistant({ uuid: 'b', messageId: 'msg_1' }))
    acc.add(assistant({ uuid: 'c', messageId: 'msg_1' }))
    expect(acc.snapshot().total).toMatchObject({ outputTokens: 20, messages: 1 })
  })

  it('takes the larger figure when two lines disagree about the same message', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ uuid: 'a', messageId: 'msg_1', usage: usage({ outputTokens: 5 }) }))
    acc.add(assistant({ uuid: 'b', messageId: 'msg_1', usage: usage({ outputTokens: 900 }) }))
    expect(acc.snapshot().total).toMatchObject({ outputTokens: 900, messages: 1 })
  })

  it('is idempotent when the same message is re-read', () => {
    const acc = new UsageAccumulator()
    const e = assistant({ messageId: 'msg_1' })
    acc.add(e)
    const once = acc.snapshot().total
    acc.add(e)
    acc.add(e)
    expect(acc.snapshot().total).toEqual(once)
  })

  it('separates subagent usage from the session own thread', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1' }))
    acc.add(assistant({ uuid: 'sub', messageId: 'm2', isSidechain: true }))
    const snap = acc.snapshot()
    expect(snap.main.messages).toBe(1)
    expect(snap.subagents.messages).toBe(1)
    expect(snap.total.messages).toBe(2)
    expect(snap.total.outputTokens).toBe(40)
  })

  it('ignores the synthetic sentinel, which is not a model and costs nothing', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1', model: '<synthetic>' }))
    expect(acc.snapshot().total.messages).toBe(0)
    expect(acc.snapshot().models).toEqual([])
  })

  it('ignores an api error rendered as an assistant turn', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1', isApiError: true }))
    expect(acc.snapshot().total.messages).toBe(0)
  })

  it('ignores entries with no usage at all', () => {
    const acc = new UsageAccumulator()
    acc.add(makeEntry({ text: 'hello' }))
    expect(acc.snapshot().total.messages).toBe(0)
  })

  it('reports occupancy from the last main-thread assistant turn', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1', usage: usage({ inputTokens: 1, cacheReadInputTokens: 400_000, cacheCreationInputTokens: 1000, outputTokens: 250 }), timestamp: '2026-08-12T10:00:00.000Z' }))
    const snap = acc.snapshot()
    expect(snap.contextTokens).toBe(401_251)
    expect(snap.contextAt).toBe('2026-08-12T10:00:00.000Z')
  })

  it('does not let a subagent turn define this session occupancy', () => {
    // A subagent runs in a context window of its own.
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1', usage: usage({ cacheReadInputTokens: 400_000 }) }))
    const before = acc.snapshot().contextTokens
    acc.add(assistant({ uuid: 'sub', messageId: 'm2', isSidechain: true, usage: usage({ cacheReadInputTokens: 5 }) }))
    expect(acc.snapshot().contextTokens).toBe(before)
  })

  it('lets occupancy fall after a compaction rather than pinning the high-water mark', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ uuid: 'a', messageId: 'm1', usage: usage({ cacheReadInputTokens: 400_000 }) }))
    acc.add(makeEntry({ uuid: 'boundary', role: 'system', isCompactBoundary: true }))
    acc.add(assistant({ uuid: 'b', messageId: 'm2', usage: usage({ cacheReadInputTokens: 30_000 }) }))
    const snap = acc.snapshot()
    expect(snap.contextTokens).toBeLessThan(100_000)
    expect(snap.compactions).toBe(1)
    // The tokens spent before compacting are still spent.
    expect(snap.total.cacheReadInputTokens).toBe(430_000)
  })

  it('records every model the session used, in order', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ uuid: 'a', messageId: 'm1', model: 'claude-opus-5' }))
    acc.add(assistant({ uuid: 'b', messageId: 'm2', model: 'claude-haiku-4-5-20251001' }))
    acc.add(assistant({ uuid: 'c', messageId: 'm3', model: 'claude-opus-5' }))
    expect(acc.snapshot().models).toEqual(['claude-opus-5', 'claude-haiku-4-5-20251001'])
  })

  it('keeps the most recent effort', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ uuid: 'a', messageId: 'm1', effort: 'medium' }))
    acc.add(assistant({ uuid: 'b', messageId: 'm2', effort: 'xhigh' }))
    expect(acc.snapshot().effort).toBe('xhigh')
  })

  it('falls back to the uuid when a message carries no id', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ uuid: 'a', messageId: null }))
    acc.add(assistant({ uuid: 'b', messageId: null }))
    expect(acc.snapshot().total.messages).toBe(2)
  })

  it('hands out copies, so a caller cannot mutate the running totals', () => {
    const acc = new UsageAccumulator()
    acc.add(assistant({ messageId: 'm1' }))
    const snap = acc.snapshot()
    snap.total.outputTokens = 999_999
    snap.main.outputTokens = 999_999
    expect(acc.snapshot().total.outputTokens).toBe(20)
  })
})

describe('maxUsage', () => {
  it('is a no-op for identical reports, which is the normal case', () => {
    const u = usage()
    expect(maxUsage(u, { ...u })).toEqual(u)
  })

  it('keeps the later non-null label', () => {
    const merged = maxUsage(usage({ speed: null }), usage({ speed: 'fast' }))
    expect(merged.speed).toBe('fast')
  })

  it('leaves thinking tokens null when neither side reported any', () => {
    expect(maxUsage(usage(), usage()).thinkingTokens).toBeNull()
  })
})

describe('contextTokensOf', () => {
  it('counts everything the model was sent plus what it wrote back', () => {
    expect(contextTokensOf(usage({
      inputTokens: 2, cacheReadInputTokens: 409_146, cacheCreationInputTokens: 1132, outputTokens: 251,
    }))).toBe(410_531)
  })

  it('is zero for an empty turn rather than NaN', () => {
    expect(contextTokensOf(usage({
      inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0,
    }))).toBe(0)
  })
})

describe('isCountable', () => {
  it('rejects a turn with no usage', () => {
    expect(isCountable(makeEntry())).toBe(false)
  })

  it('accepts a normal assistant turn', () => {
    expect(isCountable(assistant())).toBe(true)
  })
})
