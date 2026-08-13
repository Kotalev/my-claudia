import type { FastifyInstance } from 'fastify'
import type { HistoryDb, RunRow } from '../history/db.js'
import type { PendingReview, RunHandle } from '../../shared/types.js'
import type { LoopStopTrace } from '../scheduler/loop.js'

/**
 * "What ran while you were away": one answer summarising the last N hours —
 * runs from the history db, outcome totals, the review backlog size and loops
 * that stopped on their own. Everything here is read from state other modules
 * already own; the digest never keeps state of its own.
 */

const DEFAULT_HOURS = 12
const MAX_HOURS = 168

export interface DigestDeps {
  history: HistoryDb
  /** The in-memory dispatcher's runs — the fallback window when history is disabled. */
  liveRuns: () => RunHandle[]
  /** The current review backlog (T-069's cached list); the digest only counts it. */
  pendingReviews: () => PendingReview[]
  /** Loops that stopped on their own, as GET /api/schedules already exposes them. */
  stoppedLoops: () => LoopStopTrace[]
}

export interface DigestTotals {
  runs: number
  succeeded: number
  failed: number
  cancelled: number
  /** Sum of the non-null run costs. 0 when nothing was priced. */
  costUsd: number
}

/** A live RunHandle reshaped as the RunRow the db would have held for it. */
function toRunRow(run: RunHandle): RunRow {
  return {
    runId: run.runId,
    projectId: run.projectId,
    taskId: run.taskId,
    sessionId: run.sessionId,
    status: run.status,
    isolation: run.isolation ?? null,
    branch: run.branch ?? null,
    merged: run.merged === true,
    discarded: run.discarded === true,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    costUsd: run.costUsd,
    numTurns: run.numTurns,
    loopId: run.loopId ?? null,
    baseCommit: run.baseCommit ?? null,
  }
}

export function registerDigestRoutes(app: FastifyInstance, deps: DigestDeps): void {
  app.get<{ Querystring: { hours?: string } }>('/api/digest', async req => {
    const parsed = Number(req.query.hours)
    const hours = Number.isFinite(parsed)
      ? Math.min(MAX_HOURS, Math.max(1, Math.floor(parsed)))
      : DEFAULT_HOURS
    // ISO stamps compare correctly as strings, which is how every stored
    // startedAt is filtered against the cutoff.
    const since = new Date(Date.now() - hours * 3_600_000).toISOString()

    const disabled = !deps.history.enabled
    const runs = disabled
      // No db: the process's own memory is all there is, so the window is
      // effectively "since the server started". Only finished runs count —
      // a running one is not yet something that happened while away.
      ? deps.liveRuns()
          .filter(r => r.endedAt !== null && r.startedAt >= since)
          .map(toRunRow)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      : deps.history.listRuns({ limit: 1000 }).filter(r => r.startedAt >= since)

    const totals: DigestTotals = {
      runs: runs.length,
      succeeded: runs.filter(r => r.status === 'succeeded').length,
      failed: runs.filter(r => r.status === 'failed').length,
      cancelled: runs.filter(r => r.status === 'cancelled').length,
      costUsd: runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    }

    return {
      since,
      disabled,
      runs,
      totals,
      pendingReviews: deps.pendingReviews().length,
      stoppedLoops: deps.stoppedLoops(),
    }
  })
}
