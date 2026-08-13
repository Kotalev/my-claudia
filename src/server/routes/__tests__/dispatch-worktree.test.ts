import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord, RunHandle } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import { Dispatcher } from '../../dispatcher/index.js'
import { registerDispatchRoutes } from '../dispatch.js'
import { initRepo } from '../../dispatcher/__tests__/init-repo.js'

const exec = promisify(execFile)
const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

async function makeHarness(projectPath: string): Promise<{
  app: FastifyInstance
  dispatcher: Dispatcher
  project: ProjectRecord
  start: () => Promise<RunHandle>
}> {
  const worktreesRoot = await mkdtemp(join(tmpdir(), 'mc-wtroot-'))
  const dispatcher = new Dispatcher({
    claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs: 5000, worktreesRoot,
  })
  const project: ProjectRecord = {
    id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
  }
  const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
  const app = Fastify()
  registerDispatchRoutes(app, registry, dispatcher, () => {})
  await app.ready()
  const start = async (): Promise<RunHandle> => {
    const handle = await dispatcher.start({
      projectId: project.id, projectPath, taskId: 'T-001', prompt: 'do the thing',
    })
    await ended(dispatcher, handle.runId)
    return dispatcher.get(handle.runId)!
  }
  return { app, dispatcher, project, start }
}

afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

describe('worktree-isolated dispatch', () => {
  it('runs in a fresh linked worktree on its own branch, not in the project', async () => {
    const repo = await initRepo()
    const { app, dispatcher } = await makeHarness(repo)
    const chunks: string[] = []
    dispatcher.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = await dispatcher.start({
      projectId: 'p1', projectPath: repo, taskId: 'T-001', prompt: 'go',
    })
    await ended(dispatcher, handle.runId)

    expect(handle.isolation).toBe('worktree')
    expect(handle.branch).toBe(`mc/run-${handle.runId.slice(0, 8)}`)
    expect(handle.worktreeDir).not.toBeNull()
    expect(handle.diffAvailable).toBe(true)
    // fake-claude echoes its cwd: the run really started inside the worktree.
    expect(chunks.join('')).toContain(`cwd:${realpathSync(handle.worktreeDir!)}`)
    const branches = await exec('git', ['-C', repo, 'branch', '--list', 'mc/run-*'])
    expect(branches.stdout).toContain(handle.branch)
    await app.close()
  })

  it('allows concurrent runs in the same git project', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const repo = await initRepo()
    const { app, dispatcher } = await makeHarness(repo)
    const input = { projectId: 'p1', projectPath: repo, taskId: 'T-001', prompt: 'go' }
    const a = await dispatcher.start(input)
    const b = await dispatcher.start(input)
    expect(dispatcher.list()).toHaveLength(2)
    expect(a.worktreeDir).not.toBe(b.worktreeDir)
    dispatcher.cancel(a.runId); dispatcher.cancel(b.runId)
    await Promise.all([ended(dispatcher, a.runId), ended(dispatcher, b.runId)])
    await app.close()
  })

  it('keeps the in-place behaviour and the 1-per-project guard for non-git projects', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const input = { projectId: 'p1', projectPath: plain, taskId: 'T-001', prompt: 'go' }
    const first = await dispatcher.start(input)
    expect(first.isolation).toBe('in-place')
    expect(first.branch).toBeNull()
    expect(first.worktreeDir).toBeNull()
    expect(first.diffAvailable).toBe(false)
    await expect(dispatcher.start(input)).rejects.toThrow(/already running/i)
    dispatcher.cancel(first.runId)
    await ended(dispatcher, first.runId)
    await app.close()
  })
})

describe('GET /api/runs/:id/diff', () => {
  it('reports changed and untracked files with the patch', async () => {
    const repo = await initRepo()
    const { app, start } = await makeHarness(repo)
    const run = await start()
    await writeFile(join(run.worktreeDir!, 'file.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(run.worktreeDir!, 'note.md'), 'hello\n')

    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.runId}/diff` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.branch).toBe(run.branch)
    expect(body.files).toContainEqual({ path: 'file.txt', additions: 1, deletions: 0 })
    expect(body.files).toContainEqual({ path: 'note.md', additions: 1, deletions: 0 })
    expect(body.patch).toContain('+three')
    expect(body.patch).toContain('+hello')
    await app.close()
  })

  it('answers an untouched worktree with empty arrays, not 404', async () => {
    const repo = await initRepo()
    const { app, start } = await makeHarness(repo)
    const run = await start()
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.runId}/diff` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ branch: run.branch, files: [], patch: '' })
    await app.close()
  })

  it('404s a run the dispatcher never tracked', async () => {
    const repo = await initRepo()
    const { app } = await makeHarness(repo)
    const res = await app.inject({ method: 'GET', url: '/api/runs/no-such-run/diff' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('POST /api/runs/:id/merge', () => {
  async function commitInWorktree(dir: string, content: string): Promise<void> {
    await writeFile(join(dir, 'file.txt'), content)
    await exec('git', ['-C', dir, 'commit', '-q', '-am', 'run work'])
  }

  it('refuses while the project checkout is dirty', async () => {
    const repo = await initRepo()
    const { app, start } = await makeHarness(repo)
    const run = await start()
    await commitInWorktree(run.worktreeDir!, 'one\ntwo\nthree\n')
    await writeFile(join(repo, 'file.txt'), 'one\ntwo\nlocal edit\n')   // dirty tree

    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/merge` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/uncommitted changes/)
    expect(existsSync(run.worktreeDir!)).toBe(true)   // nothing was destroyed
    await app.close()
  })

  it('refuses while the run is still going', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const repo = await initRepo()
    const { app, dispatcher } = await makeHarness(repo)
    const run = await dispatcher.start({ projectId: 'p1', projectPath: repo, taskId: 'T-001', prompt: 'go' })
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/merge` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/still going/)
    dispatcher.cancel(run.runId)
    await ended(dispatcher, run.runId)
    await app.close()
  })

  it('merges the branch, removes the worktree and keeps the branch', async () => {
    const repo = await initRepo()
    const { app, dispatcher, start } = await makeHarness(repo)
    const run = await start()
    await commitInWorktree(run.worktreeDir!, 'one\ntwo\nthree\n')

    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/merge` })
    expect(res.statusCode).toBe(200)
    const merged = await exec('git', ['-C', repo, 'show', 'HEAD:file.txt'])
    expect(merged.stdout).toBe('one\ntwo\nthree\n')
    expect(existsSync(run.worktreeDir!)).toBe(false)
    const branches = await exec('git', ['-C', repo, 'branch', '--list', 'mc/run-*'])
    expect(branches.stdout).toContain(run.branch)
    const after = dispatcher.get(run.runId)!
    expect(after.merged).toBe(true)
    expect(after.diffAvailable).toBe(false)

    // A second merge (and a diff) now have nothing to work on.
    expect((await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/merge` })).statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: `/api/runs/${run.runId}/diff` })).statusCode).toBe(409)
    await app.close()
  })

  it('aborts a conflicting merge, leaving the checkout clean and the worktree kept', async () => {
    const repo = await initRepo()
    const { app, dispatcher, start } = await makeHarness(repo)
    const run = await start()
    await commitInWorktree(run.worktreeDir!, 'one\ntwo\nfrom-run\n')
    // A committed conflicting edit: the project tree stays clean, the merge cannot.
    await writeFile(join(repo, 'file.txt'), 'one\ntwo\nfrom-main\n')
    await exec('git', ['-C', repo, 'commit', '-q', '-am', 'conflicting'])

    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/merge` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/merge failed and was aborted/)
    const status = await exec('git', ['-C', repo, 'status', '--porcelain'])
    expect(status.stdout).toBe('')                                   // abort left it clean
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false) // no half-done merge
    expect(existsSync(run.worktreeDir!)).toBe(true)                  // work survives
    expect(dispatcher.get(run.runId)!.diffAvailable).toBe(true)
    await app.close()
  })
})

describe('POST /api/runs/:id/discard', () => {
  it('removes the worktree but keeps the branch, and marks the run discarded', async () => {
    const repo = await initRepo()
    const { app, dispatcher, start } = await makeHarness(repo)
    const run = await start()
    await writeFile(join(run.worktreeDir!, 'file.txt'), 'dirty\n')   // discard must not care

    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/discard` })
    expect(res.statusCode).toBe(200)
    expect(existsSync(run.worktreeDir!)).toBe(false)
    const branches = await exec('git', ['-C', repo, 'branch', '--list', 'mc/run-*'])
    expect(branches.stdout).toContain(run.branch)
    const after = dispatcher.get(run.runId)!
    expect(after.discarded).toBe(true)
    expect(after.diffAvailable).toBe(false)
    expect((await app.inject({ method: 'GET', url: `/api/runs/${run.runId}/diff` })).statusCode).toBe(409)
    await app.close()
  })

  it('refuses to discard an in-place run', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const run = await dispatcher.start({ projectId: 'p1', projectPath: plain, taskId: 'T-001', prompt: 'go' })
    dispatcher.cancel(run.runId)
    await ended(dispatcher, run.runId)
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/discard` })
    expect(res.statusCode).toBe(409)
    await app.close()
  })
})
