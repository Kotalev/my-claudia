import { describe, expect, it } from 'vitest'
import type { SessionStatus, SessionSummary, TokenTotals } from '../../shared/types.js'
import { groupLiveSessions } from '../LiveBand.js'

let seq = 0

function zeros(): TokenTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
    webSearchRequests: 0, webFetchRequests: 0, messages: 0,
  }
}

function session(over: {
  status?: SessionStatus
  projectId?: string | null
  projectPath?: string | null
  name?: string | null
  startedAt?: string
  sessionId?: string
} = {}): SessionSummary {
  const id = over.sessionId ?? `s${++seq}`
  return {
    sessionId: id,
    projectId: over.projectId ?? null,
    projectPath: over.projectPath ?? null,
    status: over.status ?? 'active',
    startedAt: over.startedAt ?? '2026-08-12T10:00:00.000Z',
    lastActivity: '2026-08-12T10:00:00.000Z',
    lastUserPrompt: null,
    lastAssistantText: null,
    filesTouched: [],
    toolCounts: {},
    messageCount: 0,
    hasSidechain: false,
    versions: [],
    skippedUnknown: 0,
    historyTruncated: false,
    live: {
      sessionId: id,
      pid: 1,
      cwd: over.projectPath ?? '/tmp',
      name: over.name ?? null,
      state: 'busy',
      kind: 'interactive',
      entrypoint: 'cli',
      waitingFor: null,
      startedAt: over.startedAt ?? '2026-08-12T10:00:00.000Z',
      statusUpdatedAt: null,
      version: null,
    },
    usage: {
      main: zeros(),
      subagents: zeros(),
      total: zeros(),
      byRate: [],
      models: [],
      contextTokens: null,
      contextModel: null,
      contextAt: null,
      effort: null,
      compactions: 0,
    },
    reportedCostUsd: null,
  }
}

describe('groupLiveSessions', () => {
  it('puts two sessions of one registered project in one group', () => {
    const groups = groupLiveSessions([
      session({ projectId: 'p1', projectPath: '/code/a', name: 'a' }),
      session({ projectId: 'p1', projectPath: '/code/a', name: 'a' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions).toHaveLength(2)
    expect(groups[0]!.projectId).toBe('p1')
  })

  it('keeps a worktree apart from its checkout, which share a basename', () => {
    // The whole reason the key is the path and not the label: `claudia` in two
    // directories is two projects, and merging them would hide a running agent
    // under the wrong heading.
    const groups = groupLiveSessions([
      session({ projectPath: '/code/claudia', name: 'claudia' }),
      session({ projectPath: '/tmp/wt/claudia', name: 'claudia' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('groups unregistered sessions by their directory', () => {
    const groups = groupLiveSessions([
      session({ projectPath: '/code/b' }),
      session({ projectPath: '/code/b' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.projectId).toBeNull()
  })

  it('never merges sessions whose path is unknown', () => {
    // Two processes with no path in common are not evidence of a shared
    // project; grouping them would invent one.
    const groups = groupLiveSessions([session(), session()])
    expect(groups).toHaveLength(2)
  })

  it('puts the project with something waiting first', () => {
    const groups = groupLiveSessions([
      session({ projectPath: '/code/a', status: 'active', startedAt: '2026-08-12T09:00:00.000Z' }),
      session({ projectPath: '/code/b', status: 'idle', startedAt: '2026-08-12T09:30:00.000Z' }),
      session({ projectPath: '/code/c', status: 'waiting', startedAt: '2026-08-12T11:00:00.000Z' }),
    ])
    expect(groups.map(g => g.path)).toEqual(['/code/c', '/code/a', '/code/b'])
  })

  it('orders within a group by status, then by start time', () => {
    const groups = groupLiveSessions([
      session({ projectPath: '/code/a', status: 'idle', sessionId: 'idle' }),
      session({ projectPath: '/code/a', status: 'active', startedAt: '2026-08-12T12:00:00.000Z', sessionId: 'late' }),
      session({ projectPath: '/code/a', status: 'active', startedAt: '2026-08-12T08:00:00.000Z', sessionId: 'early' }),
      session({ projectPath: '/code/a', status: 'waiting', sessionId: 'waiting' }),
    ])
    expect(groups[0]!.sessions.map(s => s.sessionId)).toEqual(['waiting', 'early', 'late', 'idle'])
  })

  it('returns nothing for no sessions rather than an empty group', () => {
    expect(groupLiveSessions([])).toEqual([])
  })

  it('names a group from the process name, falling back to the path basename', () => {
    const [named, unnamed] = groupLiveSessions([
      session({ projectPath: '/code/a', name: 'friendly' }),
      session({ projectPath: '/code/b' }),
    ]).sort((x, y) => (x.path ?? '').localeCompare(y.path ?? ''))
    expect(named!.label).toBe('friendly')
    expect(unnamed!.label).toBe('b')
  })

  it('heads a registered group with the registered name, not the process name', () => {
    // The heading opens that project's card; a card labelled differently from
    // the link that opens it reads as two different projects.
    const [group] = groupLiveSessions(
      [session({ projectId: 'p1', projectPath: '/code/a', name: 'my-claudia-01' })],
      new Map([['p1', 'my-claudia']]),
    )
    expect(group!.label).toBe('my-claudia')
  })

  it('falls back to the process name when the id is not in the map', () => {
    const [group] = groupLiveSessions(
      [session({ projectId: 'gone', projectPath: '/code/a', name: 'my-claudia-01' })],
      new Map([['p1', 'my-claudia']]),
    )
    expect(group!.label).toBe('my-claudia-01')
  })

  it('says so rather than guessing when there is no path at all', () => {
    expect(groupLiveSessions([session()])[0]!.label).toBe('path unknown')
  })
})
