import { describe, it, expect, vi, afterEach } from 'vitest'
import { SessionStore } from '../session-store.js'
import type { TranscriptEntry, ParseStats } from '../../../transcript/types.js'

const stats: ParseStats = {
  parsed: 0, skippedUnknown: 0, skippedBookkeeping: 0, skippedInvalid: 0, versions: ['2.1.0'],
}

function entry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    uuid: 'u1', parentUuid: null, sessionId: 's1', timestamp: '2026-08-12T10:00:00.000Z',
    role: 'user', isSidechain: false, cwd: '/p', gitBranch: 'main', version: '2.1.0',
    text: 'do the thing', toolCalls: [], isMeta: false, ...over,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('SessionStore', () => {
  it('derives a summary from entries', () => {
    const store = new SessionStore()
    const s = store.apply('s1', [
      entry(),
      entry({ uuid: 'u2', role: 'assistant', text: 'done', timestamp: '2026-08-12T10:01:00.000Z',
              toolCalls: [{ id: 't1', name: 'Read', filePath: '/p/a.ts' }] }),
    ], stats, null)

    expect(s.lastUserPrompt).toBe('do the thing')
    expect(s.lastAssistantText).toBe('done')
    expect(s.filesTouched).toEqual(['/p/a.ts'])
    expect(s.toolCounts).toEqual({ Read: 1 })
    expect(s.messageCount).toBe(2)
    expect(s.startedAt).toBe('2026-08-12T10:00:00.000Z')
    expect(s.lastActivity).toBe('2026-08-12T10:01:00.000Z')
    expect(s.versions).toEqual(['2.1.0'])
  })

  it('accumulates across successive applies without losing earlier data', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    const s = store.apply('s1', [entry({ uuid: 'u2', role: 'assistant', text: 'ok',
                                         timestamp: '2026-08-12T10:02:00.000Z' })], stats, null)
    expect(s.messageCount).toBe(2)
    expect(s.lastUserPrompt).toBe('do the thing')
  })

  it('ignores a duplicate uuid on re-read', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    const s = store.apply('s1', [entry()], stats, null)
    expect(s.messageCount).toBe(1)
  })

  it('flags sessions containing subagent activity', () => {
    const store = new SessionStore()
    const s = store.apply('s1', [entry({ isSidechain: true })], stats, null)
    expect(s.hasSidechain).toBe(true)
  })

  it('is active within the idle threshold and idle beyond it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:02:00.000Z'))
    const store = new SessionStore()
    expect(store.apply('s1', [entry()], stats, null).status).toBe('active')

    vi.setSystemTime(new Date('2026-08-12T10:30:00.000Z'))
    expect(store.get('s1')!.status).toBe('idle')
  })

  it('marks a session done and keeps it done regardless of recency', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:30.000Z'))
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    store.markEnded('s1')
    expect(store.get('s1')!.status).toBe('done')
  })

  it('deduplicates files touched and counts each tool use', () => {
    const store = new SessionStore()
    const s = store.apply('s1', [
      entry({ uuid: 'a', toolCalls: [{ id: 't1', name: 'Edit', filePath: '/p/a.ts' }] }),
      entry({ uuid: 'b', toolCalls: [{ id: 't2', name: 'Edit', filePath: '/p/a.ts' }] }),
    ], stats, null)
    expect(s.filesTouched).toEqual(['/p/a.ts'])
    expect(s.toolCounts).toEqual({ Edit: 2 })
  })

  it('sorts all() with the most recently active session first', () => {
    const store = new SessionStore()
    store.apply('old', [entry({ sessionId: 'old', timestamp: '2026-08-12T09:00:00.000Z' })], stats, null)
    store.apply('new', [entry({ sessionId: 'new', timestamp: '2026-08-12T11:00:00.000Z' })], stats, null)
    expect(store.all().map(s => s.sessionId)).toEqual(['new', 'old'])
  })
})

describe('SessionStore.sweepStatusChanges', () => {
  it('reports a session that has gone quiet since the last look', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:02:00.000Z'))
    const store = new SessionStore()
    expect(store.apply('s1', [entry()], stats, null).status).toBe('active')

    expect(store.sweepStatusChanges()).toEqual([])   // nothing changed yet

    vi.setSystemTime(new Date('2026-08-12T10:30:00.000Z'))
    const changed = store.sweepStatusChanges()
    expect(changed.map(s => [s.sessionId, s.status])).toEqual([['s1', 'idle']])
  })

  it('reports each transition only once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:02:00.000Z'))
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)

    vi.setSystemTime(new Date('2026-08-12T10:30:00.000Z'))
    expect(store.sweepStatusChanges()).toHaveLength(1)
    expect(store.sweepStatusChanges()).toHaveLength(0)
  })
})

describe('SessionStore — truncated history', () => {
  it('is not truncated by default', () => {
    const store = new SessionStore()
    expect(store.apply('s1', [entry()], stats, null).historyTruncated).toBe(false)
  })

  it('reports truncation when the transcript was joined partway through', () => {
    const store = new SessionStore()
    store.markTruncated('s1')
    expect(store.apply('s1', [entry()], stats, null).historyTruncated).toBe(true)
  })
})
