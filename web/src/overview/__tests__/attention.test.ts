import { describe, expect, it } from 'vitest'
import type { PendingReview, QueuedDispatch, RunHandle, SessionSummary, TokenTotals } from '../../shared/types.js'
import { QUEUE_STALE_MS, buildAttentionItems } from '../attention.js'

const NOW = Date.parse('2026-08-13T12:00:00.000Z')

let seq = 0

function zeros(): TokenTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
    webSearchRequests: 0, webFetchRequests: 0, messages: 0,
  }
}

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: `s${++seq}`,
    projectId: null,
    projectPath: null,
    status: 'active',
    startedAt: '2026-08-13T10:00:00.000Z',
    lastActivity: '2026-08-13T11:00:00.000Z',
    lastUserPrompt: null,
    lastAssistantText: null,
    filesTouched: [],
    toolCounts: {},
    messageCount: 0,
    hasSidechain: false,
    versions: [],
    skippedUnknown: 0,
    historyTruncated: false,
    live: null,
    gitBranch: null,
    usage: {
      main: zeros(), subagents: zeros(), total: zeros(),
      contextTokens: null, contextAt: null, contextModel: null,
      models: [], effort: null, compactions: 0, byRate: [],
    },
    reportedCostUsd: null,
    ...over,
  }
}

function run(over: Partial<RunHandle> = {}): RunHandle {
  return {
    runId: `r${++seq}`,
    projectId: 'p1',
    taskId: null,
    sessionId: null,
    status: 'running',
    startedAt: '2026-08-13T10:00:00.000Z',
    endedAt: null,
    exitCode: null,
    costUsd: null,
    numTurns: null,
    ...over,
  }
}

function review(over: Partial<PendingReview> = {}): PendingReview {
  return {
    runId: `r${++seq}`,
    projectId: 'p1',
    taskId: null,
    branch: 'mc/run-abc',
    baseCommit: null,
    startedAt: '2026-08-13T09:00:00.000Z',
    endedAt: '2026-08-13T09:30:00.000Z',
    source: 'live',
    loopId: null,
    ...over,
  }
}

function queued(over: Partial<QueuedDispatch> = {}): QueuedDispatch {
  return {
    queueId: `q${++seq}`,
    projectId: 'p1',
    input: { projectId: 'p1', projectPath: '/tmp/p1', taskId: null, prompt: 'do it' },
    queuedAt: new Date(NOW - QUEUE_STALE_MS - 60_000).toISOString(),
    ...over,
  }
}

function build(over: {
  sessions?: SessionSummary[]
  runs?: RunHandle[]
  queue?: QueuedDispatch[]
  reviews?: PendingReview[]
} = {}) {
  return buildAttentionItems({
    sessions: over.sessions ?? [],
    runs: over.runs ?? [],
    queue: over.queue ?? [],
    reviews: over.reviews ?? [],
    now: NOW,
  })
}

describe('buildAttentionItems', () => {
  it('is empty for empty inputs', () => {
    expect(build()).toEqual([])
  })

  it('ignores everything that needs nobody', () => {
    const items = build({
      sessions: [session({ status: 'active' }), session({ status: 'idle' }), session({ status: 'done' })],
      runs: [
        run({ status: 'running' }),
        run({ status: 'succeeded', endedAt: '2026-08-13T11:00:00.000Z' }),
        run({ status: 'cancelled', endedAt: '2026-08-13T11:00:00.000Z' }),
      ],
      queue: [queued({ queuedAt: new Date(NOW - 60_000).toISOString() })],
    })
    expect(items).toEqual([])
  })

  it('lists a waiting session, dated by its status transition, opening the session', () => {
    const s = session({
      status: 'waiting',
      sessionId: 'sess-1',
      projectId: 'p1',
      live: {
        sessionId: 'sess-1', pid: 1, cwd: null, name: 'my-claudia', kind: 'interactive',
        entrypoint: null, version: null, startedAt: null, state: 'waiting',
        waitingFor: null, statusUpdatedAt: '2026-08-13T11:30:00.000Z',
      },
    })
    const [item] = build({ sessions: [s] })
    expect(item).toMatchObject({
      kind: 'waiting-session',
      label: 'my-claudia',
      since: '2026-08-13T11:30:00.000Z',
      sessionId: 'sess-1',
      projectId: 'p1',
    })
  })

  it('falls back to lastActivity and prompt when the wait was never dated', () => {
    const s = session({ status: 'waiting', lastUserPrompt: 'fix the tests' })
    const [item] = build({ sessions: [s] })
    expect(item!.since).toBe(s.lastActivity)
    expect(item!.label).toBe('fix the tests')
  })

  it('lists a run awaiting input, opening the project', () => {
    const r = run({ status: 'awaiting-input', taskId: 'T-001', lastOutputAt: '2026-08-13T11:00:00.000Z' })
    const [item] = build({ runs: [r] })
    expect(item).toMatchObject({
      kind: 'awaiting-input', label: 'T-001', since: '2026-08-13T11:00:00.000Z',
      projectId: 'p1', sessionId: null,
    })
  })

  it('lists a stalled run, dated by its last output', () => {
    const r = run({ stalled: true, lastOutputAt: '2026-08-13T11:40:00.000Z' })
    const [item] = build({ runs: [r] })
    expect(item).toMatchObject({ kind: 'stalled-run', since: '2026-08-13T11:40:00.000Z' })
  })

  it('does not list an ended run as stalled', () => {
    const r = run({ stalled: true, status: 'failed', endedAt: '2026-08-13T11:00:00.000Z' })
    const items = build({ runs: [r] })
    expect(items.map(i => i.kind)).toEqual(['failed-run'])
  })

  it('lists a failed run dated by its end, labelled by the run id when taskless', () => {
    const r = run({ runId: 'abcdef1234', status: 'failed', endedAt: '2026-08-13T11:15:00.000Z' })
    const [item] = build({ runs: [r] })
    expect(item).toMatchObject({ kind: 'failed-run', label: 'run abcdef12', since: '2026-08-13T11:15:00.000Z' })
  })

  it('lists a pending review, preferring the task id over the branch', () => {
    const items = build({ reviews: [review({ taskId: 'T-042' }), review({ taskId: null, branch: 'mc/run-x', endedAt: null })] })
    // The undated one falls back to startedAt (09:00), which sorts it first.
    expect(items.map(i => [i.kind, i.label])).toEqual([
      ['pending-review', 'mc/run-x'],
      ['pending-review', 'T-042'],
    ])
    expect(items[0]!.since).toBe('2026-08-13T09:00:00.000Z')
  })

  it('suppresses a failed run that already has a pending review', () => {
    const r = run({ runId: 'dup', status: 'failed', endedAt: '2026-08-13T11:00:00.000Z' })
    const items = build({ runs: [r], reviews: [review({ runId: 'dup' })] })
    expect(items.map(i => i.kind)).toEqual(['pending-review'])
  })

  it('lists only queue entries older than the threshold', () => {
    const fresh = queued({ queuedAt: new Date(NOW - QUEUE_STALE_MS + 1000).toISOString() })
    const stale = queued({ input: { projectId: 'p1', projectPath: '/tmp/p1', taskId: 'T-009', prompt: 'x' } })
    const items = build({ queue: [fresh, stale] })
    expect(items.map(i => [i.kind, i.label])).toEqual([['stuck-queue', 'T-009']])
  })

  it('skips a queue entry whose timestamp does not parse', () => {
    expect(build({ queue: [queued({ queuedAt: 'not a date' })] })).toEqual([])
  })

  it('sorts everything oldest first across sources', () => {
    const items = build({
      sessions: [session({ status: 'waiting', lastActivity: '2026-08-13T11:50:00.000Z' })],
      runs: [run({ status: 'awaiting-input', lastOutputAt: '2026-08-13T11:10:00.000Z' })],
      reviews: [review({ endedAt: '2026-08-13T09:30:00.000Z' })],
      queue: [queued({ queuedAt: '2026-08-13T11:40:00.000Z' })],
    })
    expect(items.map(i => i.kind)).toEqual(['pending-review', 'awaiting-input', 'stuck-queue', 'waiting-session'])
  })
})
