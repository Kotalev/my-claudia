import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InterruptedRun, ProjectRecord, RunHandle } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import { Dispatcher } from '../../dispatcher/index.js'
import { DispatchQueue } from '../../dispatcher/queue.js'
import { InterruptedRunStore } from '../../dispatcher/interrupted.js'
import { registerInterruptedRoutes } from '../interrupted.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function leftover(over: Partial<InterruptedRun> = {}): InterruptedRun {
  return {
    runId: 'r1', projectId: 'p1', taskId: null, kind: 'prompt',
    prompt: 'carry on with the thing', sessionId: 'sess-1', status: 'running',
    startedAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:05:00Z',
    ...over,
  }
}

async function makeHarness(leftovers: InterruptedRun[]): Promise<{
  app: FastifyInstance
  dispatcher: Dispatcher
  store: InterruptedRunStore
  changes: number[]
}> {
  const projectPath = await mkdtemp(join(tmpdir(), 'mc-int-'))
  const worktreesRoot = await mkdtemp(join(tmpdir(), 'mc-int-wt-'))
  const storeDir = await mkdtemp(join(tmpdir(), 'mc-int-store-'))
  const storePath = join(storeDir, 'interrupted-runs.json')
  await writeFile(storePath, JSON.stringify({ runs: leftovers }), 'utf8')

  const store = new InterruptedRunStore(storePath)
  await store.load()
  const dispatcher = new Dispatcher({
    claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs: 5000, idleMs: 150, worktreesRoot,
  })
  const project: ProjectRecord = {
    id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
  }
  const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
  const changes: number[] = []
  const app = Fastify()
  registerInterruptedRoutes(app, registry, store, new DispatchQueue(dispatcher), () => changes.push(1))
  await app.ready()
  return { app, dispatcher, store, changes }
}

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

describe('GET /api/interrupted', () => {
  it('lists the leftovers', async () => {
    const { app } = await makeHarness([leftover()])
    const res = await app.inject({ method: 'GET', url: '/api/interrupted' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { interrupted: InterruptedRun[] }).interrupted).toHaveLength(1)
    await app.close()
  })
})

describe('POST /api/interrupted/:runId/resume', () => {
  it('resumes via --resume when a session id was seen, then drops the leftover', async () => {
    const { app, dispatcher, store, changes } = await makeHarness([leftover()])
    const chunks: string[] = []
    dispatcher.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const res = await app.inject({ method: 'POST', url: '/api/interrupted/r1/resume', payload: {} })
    expect(res.statusCode).toBe(200)
    const { run } = res.json() as { run: RunHandle }
    expect(run.kind).toBe('resume')
    expect(run.sessionId).toBe('sess-1')
    expect(store.list()).toHaveLength(0)
    expect(changes).toHaveLength(1)
    await ended(dispatcher, run.runId)
    expect(chunks.join('')).toContain('--resume sess-1')
    await app.close()
  })

  it('re-dispatches the original prompt when the run died nameless', async () => {
    const { app, store } = await makeHarness([leftover({ sessionId: null })])
    const res = await app.inject({ method: 'POST', url: '/api/interrupted/r1/resume', payload: {} })
    expect(res.statusCode).toBe(200)
    const { run } = res.json() as { run: RunHandle }
    expect(run.kind).toBe('prompt')
    expect(run.sessionId).toBeNull()
    expect(store.list()).toHaveLength(0)
    await app.close()
  })

  it('404s an unknown run and a run whose project is gone', async () => {
    const { app } = await makeHarness([leftover({ runId: 'r2', projectId: 'unregistered' })])
    const unknown = await app.inject({ method: 'POST', url: '/api/interrupted/nope/resume', payload: {} })
    expect(unknown.statusCode).toBe(404)
    const orphan = await app.inject({ method: 'POST', url: '/api/interrupted/r2/resume', payload: {} })
    expect(orphan.statusCode).toBe(404)
    await app.close()
  })

  it('400s a present-but-empty text body', async () => {
    const { app } = await makeHarness([leftover()])
    const res = await app.inject({
      method: 'POST', url: '/api/interrupted/r1/resume', payload: { text: '   ' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /api/interrupted/:runId/dismiss', () => {
  it('removes the leftover without starting anything', async () => {
    const { app, store, changes } = await makeHarness([leftover()])
    const res = await app.inject({ method: 'POST', url: '/api/interrupted/r1/dismiss' })
    expect(res.statusCode).toBe(200)
    expect(store.list()).toHaveLength(0)
    expect(changes).toHaveLength(1)

    const again = await app.inject({ method: 'POST', url: '/api/interrupted/r1/dismiss' })
    expect(again.statusCode).toBe(404)
    await app.close()
  })
})
