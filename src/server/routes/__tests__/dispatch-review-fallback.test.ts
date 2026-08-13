import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import { Dispatcher } from '../../dispatcher/index.js'
import { DispatchQueue } from '../../dispatcher/queue.js'
import { createWorktree, runBranch } from '../../dispatcher/worktree.js'
import { openHistoryDb, type HistoryDb, type RunRow } from '../../history/db.js'
import { initRepo } from '../../dispatcher/__tests__/init-repo.js'
import { registerDispatchRoutes } from '../dispatch.js'

const exec = promisify(execFile)

/**
 * The historical review path: a runId the dispatcher has never heard of falls
 * back to the unresolved history row — a previous server process's run whose
 * branch (and sometimes worktree) survived the restart.
 */

interface Harness {
  app: FastifyInstance
  repo: string
  history: HistoryDb
  worktreesRoot: string
  onReviewsChanged: ReturnType<typeof vi.fn>
}

let harness: Harness

beforeEach(async () => {
  const repo = await initRepo()
  const worktreesRoot = await mkdtemp(join(tmpdir(), 'mc-review-wt-'))
  const dir = await mkdtemp(join(tmpdir(), 'mc-review-db-'))
  const history = await openHistoryDb(join(dir, 'history.db'))
  expect(history.enabled).toBe(true)

  const project: ProjectRecord = {
    id: 'p1', path: repo, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
  }
  const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
  // A dispatcher that never ran anything: every runId misses, as after a restart.
  const dispatcher = new Dispatcher({ claudeBin: process.execPath, worktreesRoot })
  const sessions = { get: () => undefined } as unknown as import('../../watcher/session-store.js').SessionStore
  const onReviewsChanged = vi.fn()
  const app = Fastify()
  registerDispatchRoutes(app, registry, dispatcher, new DispatchQueue(dispatcher), sessions, () => {},
    history, worktreesRoot, onReviewsChanged)
  await app.ready()
  harness = { app, repo, history, worktreesRoot, onReviewsChanged }
})

afterEach(async () => {
  await harness.app.close()
  harness.history.close()
})

function row(over: Partial<RunRow> = {}): RunRow {
  return {
    runId: 'prev0001-run', projectId: 'p1', taskId: 'T-009', sessionId: null,
    status: 'succeeded', isolation: 'worktree', branch: runBranch('prev0001-run'),
    merged: false, discarded: false,
    startedAt: '2026-08-12T02:00:00.000Z', endedAt: '2026-08-12T02:10:00.000Z',
    costUsd: null, numTurns: null, exitCode: 0, loopId: 'loop-1', baseCommit: null,
    ...over,
  }
}

/**
 * A previous process's run: worktree + branch created for `runId`, a change
 * committed on the branch, the unresolved row persisted. When `keepWorktree`
 * is false the worktree dir is destroyed the way a pre-T-069 prune did it.
 */
async function seedHistoricalRun(runId: string, opts: { keepWorktree: boolean }): Promise<RunRow> {
  const { repo, history, worktreesRoot } = harness
  const wt = await createWorktree(repo, worktreesRoot, runId)
  await writeFile(join(wt.dir, 'file.txt'), 'one\ntwo\nthree\n')
  await exec('git', ['-C', wt.dir, 'commit', '-q', '-am', 'run work'])
  if (!opts.keepWorktree) {
    await rm(wt.dir, { recursive: true, force: true })
    await exec('git', ['-C', repo, 'worktree', 'prune'])
  }
  const seeded = row({ runId, branch: wt.branch, baseCommit: wt.base })
  history.upsertRun(seeded)
  return seeded
}

describe('GET /api/reviews', () => {
  it('lists the unresolved historical run, and drops it once resolved', async () => {
    await seedHistoricalRun('prev0001-run', { keepWorktree: false })
    let res = await harness.app.inject({ method: 'GET', url: '/api/reviews' })
    expect(res.statusCode).toBe(200)
    expect(res.json().reviews).toMatchObject([{
      runId: 'prev0001-run', projectId: 'p1', taskId: 'T-009',
      branch: 'mc/run-prev0001', source: 'history', loopId: 'loop-1',
    }])

    harness.history.markRunResolved('prev0001-run', 'discarded')
    res = await harness.app.inject({ method: 'GET', url: '/api/reviews' })
    expect(res.json().reviews).toEqual([])
  })
})

describe('GET /api/runs/:runId/diff — history fallback', () => {
  it('diffs base..branch in the project checkout when the worktree is gone', async () => {
    const seeded = await seedHistoricalRun('prev0001-run', { keepWorktree: false })
    const res = await harness.app.inject({ method: 'GET', url: '/api/runs/prev0001-run/diff' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.branch).toBe(seeded.branch)
    expect(body.files).toContainEqual({ path: 'file.txt', additions: 1, deletions: 0 })
    expect(body.patch).toContain('+three')
  })

  it('uses the surviving worktree dir, so uncommitted changes still show', async () => {
    const seeded = await seedHistoricalRun('prev0001-run', { keepWorktree: true })
    await writeFile(join(harness.worktreesRoot, 'prev0001-run', 'file.txt'), 'one\ntwo\nthree\nfour\n')
    const res = await harness.app.inject({ method: 'GET', url: '/api/runs/prev0001-run/diff' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.branch).toBe(seeded.branch)
    expect(body.patch).toContain('+four')
  })

  it('falls back to the merge-base when the recorded base commit is unusable', async () => {
    await seedHistoricalRun('prev0001-run', { keepWorktree: false })
    harness.history.upsertRun(row({ runId: 'prev0001-run', branch: runBranch('prev0001-run'), baseCommit: 'not-a-commit' }))
    const res = await harness.app.inject({ method: 'GET', url: '/api/runs/prev0001-run/diff' })
    expect(res.statusCode).toBe(200)
    expect(res.json().patch).toContain('+three')
  })

  it('409s when the branch itself is gone — nothing left to review', async () => {
    harness.history.upsertRun(row())   // row only: no worktree, no branch was ever created
    const res = await harness.app.inject({ method: 'GET', url: '/api/runs/prev0001-run/diff' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/no longer exists/)
  })

  it('404s a runId that is in neither the dispatcher nor the unresolved rows', async () => {
    harness.history.upsertRun(row({ merged: true }))   // resolved: not reviewable
    expect((await harness.app.inject({ method: 'GET', url: '/api/runs/prev0001-run/diff' })).statusCode).toBe(404)
    expect((await harness.app.inject({ method: 'GET', url: '/api/runs/never-seen/diff' })).statusCode).toBe(404)
  })
})

describe('POST /api/runs/:runId/merge — history fallback', () => {
  it('merges the branch, flips the row, removes a surviving worktree, keeps the branch', async () => {
    const seeded = await seedHistoricalRun('prev0001-run', { keepWorktree: true })
    const dir = join(harness.worktreesRoot, 'prev0001-run')
    const res = await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/merge' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, branch: seeded.branch })
    const merged = await exec('git', ['-C', harness.repo, 'show', 'HEAD:file.txt'])
    expect(merged.stdout).toBe('one\ntwo\nthree\n')
    expect(existsSync(dir)).toBe(false)
    const branches = await exec('git', ['-C', harness.repo, 'branch', '--list', 'mc/run-*'])
    expect(branches.stdout).toContain(seeded.branch)
    expect(harness.history.listUnresolvedWorktreeRuns()).toEqual([])
    expect(harness.history.listRuns()[0]?.merged).toBe(true)
    expect(harness.onReviewsChanged).toHaveBeenCalled()

    // Resolved: the same merge again finds no unresolved row.
    expect((await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/merge' })).statusCode).toBe(404)
  })

  it('commits uncommitted changes in a surviving worktree so the merge delivers them', async () => {
    await seedHistoricalRun('prev0001-run', { keepWorktree: true })
    await writeFile(join(harness.worktreesRoot, 'prev0001-run', 'extra.txt'), 'uncommitted\n')
    const res = await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/merge' })
    expect(res.statusCode).toBe(200)
    // The review diff showed extra.txt; a merge that silently dropped it would
    // report "merged" while losing the run's work.
    const merged = await exec('git', ['-C', harness.repo, 'show', 'HEAD:extra.txt'])
    expect(merged.stdout).toBe('uncommitted\n')
    expect(harness.history.listRuns()[0]?.merged).toBe(true)
  })

  it('refuses while the project checkout is dirty, leaving the row unresolved', async () => {
    await seedHistoricalRun('prev0001-run', { keepWorktree: false })
    await writeFile(join(harness.repo, 'file.txt'), 'one\ntwo\nlocal edit\n')
    const res = await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/merge' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/uncommitted changes/)
    expect(harness.history.listUnresolvedWorktreeRuns()).toHaveLength(1)
  })

  it('aborts a conflicting merge and keeps the row pending', async () => {
    await seedHistoricalRun('prev0001-run', { keepWorktree: false })
    await writeFile(join(harness.repo, 'file.txt'), 'one\ntwo\nfrom-main\n')
    await exec('git', ['-C', harness.repo, 'commit', '-q', '-am', 'conflicting'])
    const res = await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/merge' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/merge failed and was aborted/)
    const status = await exec('git', ['-C', harness.repo, 'status', '--porcelain'])
    expect(status.stdout).toBe('')
    expect(harness.history.listUnresolvedWorktreeRuns()).toHaveLength(1)
  })
})

describe('POST /api/runs/:runId/discard — history fallback', () => {
  it('flips the row, removes a surviving worktree, and NEVER deletes the branch', async () => {
    const seeded = await seedHistoricalRun('prev0001-run', { keepWorktree: true })
    const dir = join(harness.worktreesRoot, 'prev0001-run')
    await writeFile(join(dir, 'file.txt'), 'dirty\n')   // discard must not care
    const res = await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/discard' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, branch: seeded.branch })
    expect(existsSync(dir)).toBe(false)
    const branches = await exec('git', ['-C', harness.repo, 'branch', '--list', 'mc/run-*'])
    expect(branches.stdout).toContain(seeded.branch)
    expect(harness.history.listRuns()[0]?.discarded).toBe(true)
    expect(harness.onReviewsChanged).toHaveBeenCalled()
  })

  it('discards a row whose worktree is already gone', async () => {
    await seedHistoricalRun('prev0001-run', { keepWorktree: false })
    const res = await harness.app.inject({ method: 'POST', url: '/api/runs/prev0001-run/discard' })
    expect(res.statusCode).toBe(200)
    expect(harness.history.listUnresolvedWorktreeRuns()).toEqual([])
  })
})
