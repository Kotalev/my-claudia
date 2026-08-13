import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DISABLED_HISTORY, type HistoryDb, type RunRow } from '../../history/db.js'
import { initRepo } from '../../dispatcher/__tests__/init-repo.js'
import { listPendingReviews, worktreeKeepSet } from '../index.js'
import type { RunHandle } from '../../../shared/types.js'

const exec = promisify(execFile)

/** A HistoryDb whose only life is the unresolved-runs list. */
function historyWith(rows: RunRow[]): HistoryDb {
  return { ...DISABLED_HISTORY, enabled: true, listUnresolvedWorktreeRuns: () => rows }
}

function liveRun(over: Partial<RunHandle> = {}): RunHandle {
  return {
    runId: 'live-1', projectId: 'p1', taskId: 'T-001', sessionId: null,
    status: 'succeeded', startedAt: '2026-08-13T10:00:00.000Z',
    endedAt: '2026-08-13T10:05:00.000Z', exitCode: 0, costUsd: null, numTurns: null,
    isolation: 'worktree', branch: 'mc/run-live0001', worktreeDir: '/tmp/wt/live-1',
    baseCommit: 'abc', diffAvailable: true, merged: false, discarded: false, loopId: null,
    ...over,
  }
}

function historyRow(over: Partial<RunRow> = {}): RunRow {
  return {
    runId: 'hist-1', projectId: 'p1', taskId: 'T-002', sessionId: null,
    status: 'succeeded', isolation: 'worktree', branch: 'mc/run-hist0001',
    merged: false, discarded: false,
    startedAt: '2026-08-12T10:00:00.000Z', endedAt: '2026-08-12T10:05:00.000Z',
    costUsd: null, numTurns: null, exitCode: 0, loopId: 'loop-1', baseCommit: 'def',
    ...over,
  }
}

describe('listPendingReviews', () => {
  it('answers empty for no runs and a disabled db', async () => {
    const reviews = await listPendingReviews({
      runs: [], history: DISABLED_HISTORY, projectPath: () => undefined,
    })
    expect(reviews).toEqual([])
  })

  it('merges live and historical items, newest startedAt first, and tags the source', async () => {
    const repo = await initRepo()
    await exec('git', ['-C', repo, 'branch', 'mc/run-hist0001'])
    const reviews = await listPendingReviews({
      runs: [liveRun()],
      history: historyWith([historyRow()]),
      projectPath: () => repo,
    })
    expect(reviews.map(r => [r.runId, r.source])).toEqual([['live-1', 'live'], ['hist-1', 'history']])
    expect(reviews[0]).toMatchObject({
      projectId: 'p1', taskId: 'T-001', branch: 'mc/run-live0001',
      baseCommit: 'abc', endedAt: '2026-08-13T10:05:00.000Z', loopId: null,
    })
    expect(reviews[1]).toMatchObject({ branch: 'mc/run-hist0001', baseCommit: 'def', loopId: 'loop-1' })
  })

  it('excludes live runs that are unfinished, in-place, or already resolved', async () => {
    const reviews = await listPendingReviews({
      runs: [
        liveRun({ runId: 'going', endedAt: null, status: 'running' }),
        liveRun({ runId: 'in-place', isolation: 'in-place', branch: null, diffAvailable: false }),
        liveRun({ runId: 'merged', merged: true, diffAvailable: false }),
        liveRun({ runId: 'discarded', discarded: true, diffAvailable: false }),
      ],
      history: DISABLED_HISTORY,
      projectPath: () => undefined,
    })
    expect(reviews).toEqual([])
  })

  it('dedups by runId — the dispatcher\'s word beats a stale history row, even a resolved one', async () => {
    const repo = await initRepo()
    await exec('git', ['-C', repo, 'branch', 'mc/run-live0001'])
    const reviews = await listPendingReviews({
      // The live run was just merged; a history row for the same id must not resurrect it.
      runs: [liveRun({ merged: true, diffAvailable: false })],
      history: historyWith([historyRow({ runId: 'live-1', branch: 'mc/run-live0001' })]),
      projectPath: () => repo,
    })
    expect(reviews).toEqual([])
  })

  it('drops a historical item whose branch no longer exists — the work is gone', async () => {
    const repo = await initRepo()
    await exec('git', ['-C', repo, 'branch', 'mc/run-hist0001'])
    const reviews = await listPendingReviews({
      runs: [],
      history: historyWith([historyRow(), historyRow({ runId: 'hist-2', branch: 'mc/run-deleted1' })]),
      projectPath: () => repo,
    })
    expect(reviews.map(r => r.runId)).toEqual(['hist-1'])
  })

  it('skips historical rows of unregistered projects and rows without a branch', async () => {
    const reviews = await listPendingReviews({
      runs: [],
      history: historyWith([historyRow(), historyRow({ runId: 'hist-3', branch: null })]),
      projectPath: () => undefined,
    })
    expect(reviews).toEqual([])
  })
})

describe('worktreeKeepSet', () => {
  it('keeps live run ids plus unresolved historical run ids', () => {
    const keep = worktreeKeepSet([liveRun()], historyWith([historyRow()]))
    expect(keep).toEqual(new Set(['live-1', 'hist-1']))
  })

  it('keeps only live run ids when the db is disabled — nothing to consult', () => {
    expect(worktreeKeepSet([liveRun()], DISABLED_HISTORY)).toEqual(new Set(['live-1']))
  })

  it('is empty for a fresh process with no history', () => {
    expect(worktreeKeepSet([], DISABLED_HISTORY)).toEqual(new Set())
  })
})
