import { describe, it, expect, vi, afterEach } from 'vitest'
import { SessionStore, MAX_RETAINED_ENTRIES } from '../session-store.js'
import type { ParseStats } from '../../../transcript/types.js'
import type { LiveProcess } from '../../../shared/types.js'
import { makeEntry } from '../../../../test/helpers/entry.js'

const stats: ParseStats = {
  parsed: 0, skippedUnknown: 0, skippedBookkeeping: 0, skippedInvalid: 0, versions: ['2.1.0'],
}

const entry = makeEntry

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

function live(over: Partial<LiveProcess> = {}): LiveProcess {
  return {
    sessionId: 's1', pid: 10478, cwd: '/Users/dev/proj', name: 'proj', kind: 'interactive',
    entrypoint: 'cli', version: '2.1.228', startedAt: '2026-08-12T09:00:00.000Z',
    state: 'busy', waitingFor: null, statusUpdatedAt: null, ...over,
  }
}

describe('SessionStore — live processes', () => {
  it('reports waiting, which no other signal can distinguish from idle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T20:00:00.000Z'))   // long past the active window
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)

    const changed = store.setLive([live({ state: 'waiting', waitingFor: 'permission' })])
    expect(changed.map(s => [s.sessionId, s.status])).toEqual([['s1', 'waiting']])
    expect(store.get('s1')?.live?.waitingFor).toBe('permission')
  })

  it('treats a blocked background agent as waiting on the user', () => {
    const store = new SessionStore()
    store.setLive([live({ sessionId: 'bg', pid: null, kind: 'background', state: 'blocked' })])
    expect(store.get('bg')?.status).toBe('waiting')
  })

  it('keeps a busy session active however old its last transcript line is', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T10:00:00.000Z'))
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    expect(store.get('s1')?.status).toBe('idle')

    store.setLive([live({ state: 'busy' })])
    expect(store.get('s1')?.status).toBe('active')
  })

  it('reads registry idle as idle even under fresh hook activity', () => {
    // The Stop hook and statusline both fire at turn end, so a finished turn is
    // always "fresh" — freshness must not overrule Claude Code's own idle.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:30.000Z'))
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    store.markActive('s1', null)
    store.setLive([live({ state: 'idle' })])
    expect(store.get('s1')?.status).toBe('idle')
  })

  it('lets freshness decide for a live process that states no status at all', () => {
    // sdk-cli registry entries and background agents carry no status.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:30.000Z'))
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    store.markActive('s1', null)
    store.setLive([live({ state: null })])
    expect(store.get('s1')?.status).toBe('active')

    vi.setSystemTime(new Date('2026-08-12T10:30:00.000Z'))
    expect(store.get('s1')?.status).toBe('idle')
  })

  it('surfaces a session it has never seen a transcript line for', () => {
    const store = new SessionStore()
    store.setLive([live({ sessionId: 'brand-new' })])
    const s = store.get('brand-new')
    expect(s).toBeDefined()
    expect(s?.messageCount).toBe(0)
    // Its own cwd, so an unregistered session still knows where it is.
    expect(s?.projectPath).toBe('/Users/dev/proj')
    expect(s?.startedAt).toBe('2026-08-12T09:00:00.000Z')
    expect(s?.lastActivity).toBe('2026-08-12T09:00:00.000Z')
  })

  it('calls a session done once its process is gone, which time decay never can', () => {
    const store = new SessionStore()
    store.setLive([live()])
    expect(store.get('s1')?.status).toBe('active')

    const changed = store.setLive([])
    expect(changed.map(s => [s.sessionId, s.status])).toEqual([['s1', 'done']])
    expect(store.get('s1')?.live).toBeNull()
  })

  it('leaves a session we never saw live alone when the live set is empty', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    expect(store.setLive([])).toEqual([])
    expect(store.get('s1')?.status).not.toBe('done')
  })

  it('reports nothing when the live set is unchanged', () => {
    const store = new SessionStore()
    expect(store.setLive([live()])).toHaveLength(1)
    expect(store.setLive([live()])).toEqual([])
  })

  it('reports a state change on the same process', () => {
    const store = new SessionStore()
    store.setLive([live({ state: 'busy' })])
    const changed = store.setLive([live({ state: 'waiting' })])
    expect(changed.map(s => s.status)).toEqual(['waiting'])
  })

  it('prefers a registered project path over the process cwd', () => {
    const store = new SessionStore()
    const project = {
      id: 'p1', path: '/registered/path', name: 'p', escapedDir: '-registered-path',
      addedAt: '2026-08-12T00:00:00.000Z',
    }
    store.apply('s1', [entry()], stats, project)
    store.setLive([live({ cwd: '/Users/dev/proj' })])
    expect(store.get('s1')?.projectPath).toBe('/registered/path')
  })

  it('carries no live process by default', () => {
    const store = new SessionStore()
    expect(store.apply('s1', [entry()], stats, null).live).toBeNull()
  })

  it('handles an empty live set on an empty store', () => {
    expect(new SessionStore().setLive([])).toEqual([])
  })
})

describe('SessionStore — bounded retention', () => {
  it('keeps the newest entries and says so, rather than growing without limit', () => {
    const store = new SessionStore()
    const many = Array.from({ length: MAX_RETAINED_ENTRIES + 500 }, (_, i) =>
      entry({ uuid: `u${i}`, timestamp: new Date(Date.parse('2026-08-12T10:00:00.000Z') + i * 1000).toISOString() }))
    const summary = store.apply('s1', many, stats, null)

    expect(store.entries('s1')).toHaveLength(MAX_RETAINED_ENTRIES)
    expect(store.entries('s1')[0]!.uuid).toBe('u500')
    expect(summary.historyTruncated).toBe(true)
  })

  it('does not truncate a session that fits', () => {
    const store = new SessionStore()
    const few = Array.from({ length: 10 }, (_, i) => entry({ uuid: `u${i}` }))
    expect(store.apply('s1', few, stats, null).historyTruncated).toBe(false)
  })

  it('keeps usage totals intact across truncation', () => {
    const store = new SessionStore()
    const many = Array.from({ length: MAX_RETAINED_ENTRIES + 100 }, (_, i) =>
      entry({
        uuid: `u${i}`, messageId: `m${i}`, role: 'assistant', model: 'claude-opus-5',
        usage: {
          inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
          cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, thinkingTokens: null,
          webSearchRequests: 0, webFetchRequests: 0, serviceTier: null, inferenceGeo: null, speed: null,
        },
      }))
    const summary = store.apply('s1', many, stats, null)
    // Dropped entries were already folded in; the totals must not shrink with them.
    expect(summary.usage.total.messages).toBe(MAX_RETAINED_ENTRIES + 100)
  })
})

describe('SessionStore — what counts as a live change', () => {
  it('broadcasts when what the session is waiting for changes', () => {
    const store = new SessionStore()
    store.setLive([live({ state: 'waiting', waitingFor: 'permission to run Bash' })])
    const changed = store.setLive([live({ state: 'waiting', waitingFor: 'your answer to a question' })])
    expect(changed).toHaveLength(1)
    expect(changed[0]!.live?.waitingFor).toBe('your answer to a question')
  })
})

describe('SessionStore — a project that is no longer registered', () => {
  const project = {
    id: 'p1', path: '/registered/path', name: 'p', escapedDir: '-registered-path',
    addedAt: '2026-08-12T00:00:00.000Z',
  }

  it('drops the record so the session falls back to unregistered instead of vanishing', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, project)
    expect(store.get('s1')?.projectId).toBe('p1')

    const changed = store.forgetUnregistered(new Set())
    expect(changed.map(s => s.sessionId)).toEqual(['s1'])
    expect(store.get('s1')?.projectId).toBeNull()
  })

  it('keeps the path it can still prove, from the live process', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, project)
    store.setLive([live({ cwd: '/Users/dev/proj' })])
    store.forgetUnregistered(new Set())
    expect(store.get('s1')?.projectPath).toBe('/Users/dev/proj')
  })

  it('leaves registered projects alone', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, project)
    expect(store.forgetUnregistered(new Set(['p1']))).toEqual([])
    expect(store.get('s1')?.projectId).toBe('p1')
  })

  it('reports nothing for sessions that never had a project', () => {
    const store = new SessionStore()
    store.apply('s1', [entry()], stats, null)
    expect(store.forgetUnregistered(new Set())).toEqual([])
  })
})

describe('SessionStore — spend sink', () => {
  const project = {
    id: 'p1', path: '/Users/dev/proj', name: 'proj', escapedDir: '-Users-dev-proj',
    addedAt: '2026-08-12T00:00:00.000Z',
  }

  it('hands each new entry of a registered session to the sink with its project id', () => {
    const store = new SessionStore()
    const sink = vi.fn()
    store.onSpendEntry(sink)
    store.apply('s1', [entry(), entry({ uuid: 'u2' })], stats, project)
    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenCalledWith('p1', expect.objectContaining({ uuid: 'u2' }))
  })

  it('does not feed the sink for sessions without a registered project', () => {
    const store = new SessionStore()
    const sink = vi.fn()
    store.onSpendEntry(sink)
    store.apply('s1', [entry()], stats, null)
    expect(sink).not.toHaveBeenCalled()
  })

  it('does not feed the sink again for a duplicate uuid on re-read', () => {
    const store = new SessionStore()
    const sink = vi.fn()
    store.onSpendEntry(sink)
    store.apply('s1', [entry()], stats, project)
    store.apply('s1', [entry()], stats, project)
    expect(sink).toHaveBeenCalledTimes(1)
  })
})
