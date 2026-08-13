import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerDigestRoutes, type DigestDeps } from '../digest.js'
import { openHistoryDb, DISABLED_HISTORY, type HistoryDb, type RunRow } from '../../history/db.js'
import type { PendingReview, RunHandle } from '../../../shared/types.js'
import type { LoopStopTrace } from '../../scheduler/loop.js'

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

function row(overrides: Partial<RunRow>): RunRow {
  return {
    runId: 'run-x', projectId: 'p1', taskId: 'T-001', sessionId: null,
    status: 'succeeded', isolation: null, branch: null, merged: false, discarded: false,
    startedAt: hoursAgo(1), endedAt: hoursAgo(0.5), costUsd: null, numTurns: null,
    exitCode: 0, loopId: null, baseCommit: null,
    ...overrides,
  }
}

function liveRun(overrides: Partial<RunHandle>): RunHandle {
  return {
    runId: 'live-x', projectId: 'p1', taskId: 'T-002', sessionId: null,
    status: 'succeeded', startedAt: hoursAgo(1), endedAt: hoursAgo(0.5),
    exitCode: 0, costUsd: null, numTurns: null,
    ...overrides,
  }
}

async function build(deps: Partial<DigestDeps> & { history: HistoryDb }): Promise<FastifyInstance> {
  const app = Fastify()
  registerDigestRoutes(app, {
    liveRuns: () => [],
    pendingReviews: (): PendingReview[] => [],
    stoppedLoops: (): LoopStopTrace[] => [],
    ...deps,
  })
  await app.ready()
  return app
}

describe('digest route', () => {
  let app: FastifyInstance | null = null
  let db: HistoryDb | null = null

  afterEach(async () => {
    await app?.close()
    app = null
    db?.close()
    db = null
  })

  async function openDb(): Promise<HistoryDb> {
    const dir = await mkdtemp(join(tmpdir(), 'mc-digest-routes-'))
    db = await openHistoryDb(join(dir, 'history.db'))
    expect(db.enabled).toBe(true)
    return db
  }

  it('answers runs inside the window newest first, with outcome totals', async () => {
    const history = await openDb()
    history.upsertRun(row({ runId: 'old', startedAt: hoursAgo(30), endedAt: hoursAgo(29) }))
    history.upsertRun(row({ runId: 'ok', startedAt: hoursAgo(2), costUsd: 1.25 }))
    history.upsertRun(row({ runId: 'bad', status: 'failed', startedAt: hoursAgo(1), costUsd: 0.5 }))
    history.upsertRun(row({ runId: 'gone', status: 'cancelled', startedAt: hoursAgo(0.5), endedAt: null }))
    app = await build({ history })

    const res = await app.inject({ method: 'GET', url: '/api/digest' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.disabled).toBe(false)
    expect(body.runs.map((r: RunRow) => r.runId)).toEqual(['gone', 'bad', 'ok'])
    expect(body.totals).toEqual({ runs: 3, succeeded: 1, failed: 1, cancelled: 1, costUsd: 1.75 })
  })

  it('sums cost as 0 when every run cost is null, and answers empty on an empty window', async () => {
    const history = await openDb()
    history.upsertRun(row({ runId: 'unpriced', startedAt: hoursAgo(3), endedAt: hoursAgo(2.5), costUsd: null }))
    app = await build({ history })

    const priced = (await app.inject({ method: 'GET', url: '/api/digest' })).json()
    expect(priced.totals.costUsd).toBe(0)

    // The only run is older than a 1-hour window.
    const empty = (await app.inject({ method: 'GET', url: '/api/digest?hours=1' })).json()
    expect(empty.runs).toEqual([])
    expect(empty.totals).toEqual({ runs: 0, succeeded: 0, failed: 0, cancelled: 0, costUsd: 0 })
  })

  it('clamps hours to 1..168 and falls back to 12 on garbage', async () => {
    app = await build({ history: DISABLED_HISTORY })
    const sinceHours = async (query: string): Promise<number> => {
      const body = (await app!.inject({ method: 'GET', url: `/api/digest${query}` })).json()
      return (Date.now() - Date.parse(body.since)) / 3_600_000
    }
    expect(await sinceHours('?hours=9999')).toBeCloseTo(168, 1)
    expect(await sinceHours('?hours=0')).toBeCloseTo(1, 1)
    expect(await sinceHours('?hours=banana')).toBeCloseTo(12, 1)
    expect(await sinceHours('')).toBeCloseTo(12, 1)
  })

  it('surfaces the review count and stopped-loop traces', async () => {
    const trace: LoopStopTrace = {
      loopId: 'loop-1', projectId: 'p1', taskId: 'T-003', iteration: 4,
      note: 'completed all 4 iterations', stoppedAt: hoursAgo(1),
    }
    const review: PendingReview = {
      runId: 'run-r', projectId: 'p1', taskId: 'T-004', branch: 'mc/run-r',
      baseCommit: null, startedAt: hoursAgo(2), endedAt: hoursAgo(1),
      source: 'live', loopId: null,
    }
    app = await build({
      history: DISABLED_HISTORY,
      pendingReviews: () => [review],
      stoppedLoops: () => [trace],
    })
    const body = (await app.inject({ method: 'GET', url: '/api/digest' })).json()
    expect(body.pendingReviews).toBe(1)
    expect(body.stoppedLoops).toEqual([trace])
  })

  it('falls back to the dispatcher finished runs when history is disabled', async () => {
    app = await build({
      history: DISABLED_HISTORY,
      liveRuns: () => [
        liveRun({ runId: 'done', startedAt: hoursAgo(2), costUsd: 0.75, isolation: 'worktree', branch: 'mc/run-done', merged: true }),
        liveRun({ runId: 'running', status: 'running', startedAt: hoursAgo(1), endedAt: null }),
        liveRun({ runId: 'ancient', startedAt: hoursAgo(400), endedAt: hoursAgo(399) }),
      ],
    })
    const body = (await app.inject({ method: 'GET', url: '/api/digest?hours=24' })).json()
    expect(body.disabled).toBe(true)
    expect(body.runs.map((r: RunRow) => r.runId)).toEqual(['done'])
    // The handle's optional fields land as the RunRow shape the db would hold.
    expect(body.runs[0]).toMatchObject({
      isolation: 'worktree', branch: 'mc/run-done', merged: true, discarded: false,
      loopId: null, baseCommit: null, costUsd: 0.75,
    })
    expect(body.totals).toEqual({ runs: 1, succeeded: 1, failed: 0, cancelled: 0, costUsd: 0.75 })
  })
})
