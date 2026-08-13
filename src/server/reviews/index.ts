import type { PendingReview, RunHandle } from '../../shared/types.js'
import type { HistoryDb } from '../history/db.js'
import { git } from '../dispatcher/worktree.js'

/**
 * The review backlog: finished worktree runs whose changes are neither merged
 * nor discarded. Two sources feed it — the current process's dispatcher (live)
 * and unresolved rows in the history db (previous processes, which loops
 * produce nightly). A historical item only counts while its `mc/run-*` branch
 * still exists in the project checkout; a deleted branch means the work is
 * gone and there is nothing left to review.
 */

export interface ListPendingReviewsOptions {
  runs: RunHandle[]
  history: HistoryDb
  /** Registered project path by id. Undefined skips that project's historical rows. */
  projectPath: (projectId: string) => string | undefined
}

/** True when `branch` exists as a local branch of the repo at `path`. Argv only, never a shell string. */
async function branchExists(path: string, branch: string): Promise<boolean> {
  const res = await git(['-C', path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  return res.code === 0
}

/** A live run that is finished, worktree-isolated and still unresolved. */
function pendingLive(run: RunHandle): run is RunHandle & { branch: string; endedAt: string } {
  return run.endedAt !== null && run.isolation === 'worktree' && run.diffAvailable === true
    && run.merged !== true && run.discarded !== true && typeof run.branch === 'string'
}

/** Pending reviews across all projects, newest `startedAt` first. Dedup by runId — live wins. */
export async function listPendingReviews(opts: ListPendingReviewsOptions): Promise<PendingReview[]> {
  const reviews: PendingReview[] = []
  // Every live runId is claimed, resolved or not: the dispatcher's word about a
  // run it still tracks always beats a possibly stale history row.
  const liveIds = new Set(opts.runs.map(r => r.runId))

  for (const run of opts.runs) {
    if (!pendingLive(run)) continue
    reviews.push({
      runId: run.runId,
      projectId: run.projectId,
      taskId: run.taskId,
      branch: run.branch,
      baseCommit: run.baseCommit ?? null,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      source: 'live',
      loopId: run.loopId ?? null,
    })
  }

  for (const row of opts.history.listUnresolvedWorktreeRuns()) {
    if (liveIds.has(row.runId) || row.branch === null) continue
    const path = opts.projectPath(row.projectId)
    if (path === undefined) continue
    if (!(await branchExists(path, row.branch))) continue
    reviews.push({
      runId: row.runId,
      projectId: row.projectId,
      taskId: row.taskId,
      branch: row.branch,
      baseCommit: row.baseCommit,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      source: 'history',
      loopId: row.loopId,
    })
  }

  return reviews.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * Which worktree directories the startup prune must spare: every run the
 * dispatcher tracks, plus every unresolved worktree run in the history db —
 * a previous process's unreviewed work may still sit there uncommitted. With
 * history disabled there is nothing to consult, so only live runs survive.
 */
export function worktreeKeepSet(runs: RunHandle[], history: HistoryDb): Set<string> {
  const keep = new Set(runs.map(r => r.runId))
  for (const row of history.listUnresolvedWorktreeRuns()) keep.add(row.runId)
  return keep
}
