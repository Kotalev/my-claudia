import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord, RunHandle } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import { Dispatcher } from '../../dispatcher/index.js'
import { registerDispatchRoutes } from '../dispatch.js'
import { DispatchQueue } from '../../dispatcher/queue.js'
import { initRepo } from '../../dispatcher/__tests__/init-repo.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

function awaiting(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => {
      if (h.runId === runId && h.status === 'awaiting-input') resolve()
    })
  })
}

async function makeHarness(projectPath: string): Promise<{ app: FastifyInstance; dispatcher: Dispatcher }> {
  const worktreesRoot = await mkdtemp(join(tmpdir(), 'mc-steer-wt-'))
  const dispatcher = new Dispatcher({
    claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs: 5000, idleMs: 60_000, worktreesRoot,
  })
  const project: ProjectRecord = {
    id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
  }
  const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
  const app = Fastify()
  const sessions = { get: () => undefined } as unknown as import('../../watcher/session-store.js').SessionStore
  registerDispatchRoutes(app, registry, dispatcher, new DispatchQueue(dispatcher), sessions, () => {})
  await app.ready()
  return { app, dispatcher }
}

const start = async (dispatcher: Dispatcher, projectPath: string): Promise<RunHandle> => {
  const handle = await dispatcher.start({
    projectId: 'p1', projectPath, taskId: 'T-001', prompt: 'do the thing',
  })
  await awaiting(dispatcher, handle.runId)
  return dispatcher.get(handle.runId)!
}

describe('POST /api/runs/:runId/input', () => {
  it('steers an awaiting run and shows the message in the feed', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const chunks: string[] = []
    dispatcher.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const run = await start(dispatcher, plain)

    const next = awaiting(dispatcher, run.runId)
    const res = await app.inject({
      method: 'POST', url: `/api/runs/${run.runId}/input`, payload: { text: 'follow up' },
    })
    expect(res.statusCode).toBe(200)
    await next
    expect(chunks.join('')).toContain('> you: follow up')
    expect(chunks.join('')).toContain('echo:follow up')

    dispatcher.finishInput(run.runId)
    await ended(dispatcher, run.runId)
    await app.close()
  })

  it('404s an unknown run and 400s empty text', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const missing = await app.inject({
      method: 'POST', url: '/api/runs/no-such-run/input', payload: { text: 'hello' },
    })
    expect(missing.statusCode).toBe(404)

    const run = await start(dispatcher, plain)
    const empty = await app.inject({
      method: 'POST', url: `/api/runs/${run.runId}/input`, payload: { text: '   ' },
    })
    expect(empty.statusCode).toBe(400)

    dispatcher.finishInput(run.runId)
    await ended(dispatcher, run.runId)
    await app.close()
  })

  it('409s a run that has already ended', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const run = await start(dispatcher, plain)
    dispatcher.finishInput(run.runId)
    await ended(dispatcher, run.runId)

    const res = await app.inject({
      method: 'POST', url: `/api/runs/${run.runId}/input`, payload: { text: 'too late' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })
})

describe('POST /api/runs/:runId/finish', () => {
  it('concludes an awaiting run as succeeded', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const run = await start(dispatcher, plain)

    const done = ended(dispatcher, run.runId)
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/finish` })
    expect(res.statusCode).toBe(200)
    await done
    expect(dispatcher.get(run.runId)!.status).toBe('succeeded')
    await app.close()
  })

  it('404s unknown runs and 409s a second finish', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'mc-plain-'))
    const { app, dispatcher } = await makeHarness(plain)
    const missing = await app.inject({ method: 'POST', url: '/api/runs/no-such-run/finish' })
    expect(missing.statusCode).toBe(404)

    const run = await start(dispatcher, plain)
    const done = ended(dispatcher, run.runId)
    await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/finish` })
    await done
    const again = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/finish` })
    expect(again.statusCode).toBe(409)
    await app.close()
  })
})

describe('merge guard vs awaiting-input', () => {
  it('refuses to merge an awaiting-input worktree run and says it must be finished', async () => {
    const repo = await initRepo()
    const { app, dispatcher } = await makeHarness(repo)
    const run = await start(dispatcher, repo)
    expect(run.status).toBe('awaiting-input')

    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/merge` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/finish/i)

    dispatcher.finishInput(run.runId)
    await ended(dispatcher, run.runId)
    await app.close()
  })
})
