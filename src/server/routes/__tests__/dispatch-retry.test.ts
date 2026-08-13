import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord, QueuedDispatch, RunHandle } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import type { SessionStore } from '../../watcher/session-store.js'
import { Dispatcher } from '../../dispatcher/index.js'
import { DispatchQueue } from '../../dispatcher/queue.js'
import { registerDispatchRoutes } from '../dispatch.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

const TASKS = '# Tasks\n\n## Todo\n\n- [ ] **T-001** First thing\n\n## In progress\n\n## Done\n\n## Progress log\n'

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

async function makeHarness(): Promise<{
  app: FastifyInstance
  dispatcher: Dispatcher
  projectPath: string
}> {
  // A plain tmpdir, not a git repo: runs are in-place, so the queue applies.
  const projectPath = await mkdtemp(join(tmpdir(), 'mc-retry-'))
  await writeFile(join(projectPath, 'TASKS.md'), TASKS)
  const dispatcher = new Dispatcher({
    claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs: 5000, idleMs: 150,
  })
  const project: ProjectRecord = {
    id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
  }
  const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
  const sessions = { get: () => undefined } as unknown as SessionStore
  const app = Fastify()
  registerDispatchRoutes(app, registry, dispatcher, new DispatchQueue(dispatcher), sessions, () => {})
  await app.ready()
  return { app, dispatcher, projectPath }
}

/** Dispatches a prompt run in crash mode and waits for it to fail. */
async function failedPromptRun(app: FastifyInstance, dispatcher: Dispatcher, text = 'original prompt'): Promise<RunHandle> {
  process.env.FAKE_CLAUDE_MODE = 'crash'
  const res = await app.inject({ method: 'POST', url: '/api/projects/p1/prompt', payload: { text } })
  expect(res.statusCode).toBe(200)
  const { run } = res.json() as { run: RunHandle }
  await ended(dispatcher, run.runId)
  expect(dispatcher.get(run.runId)!.status).toBe('failed')
  delete process.env.FAKE_CLAUDE_MODE
  return run
}

afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

describe('POST /api/runs/:runId/retry', () => {
  it('re-dispatches a failed prompt run with its original prompt', async () => {
    const { app, dispatcher } = await makeHarness()
    const failed = await failedPromptRun(app, dispatcher, 'the very same words')

    const chunks: string[] = []
    dispatcher.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const res = await app.inject({ method: 'POST', url: `/api/runs/${failed.runId}/retry` })
    expect(res.statusCode).toBe(200)
    const { run } = res.json() as { run: RunHandle }
    expect(run.runId).not.toBe(failed.runId)
    expect(run.kind).toBe('prompt')
    await ended(dispatcher, run.runId)
    expect(chunks.join('')).toContain('echo:the very same words')
    expect(dispatcher.get(run.runId)!.status).toBe('succeeded')
    await app.close()
  })

  it('re-reads the task for fresh text, like the original dispatch', async () => {
    const { app, dispatcher, projectPath } = await makeHarness()
    process.env.FAKE_CLAUDE_MODE = 'crash'
    const dispatched = await app.inject({ method: 'POST', url: '/api/projects/p1/tasks/T-001/dispatch' })
    expect(dispatched.statusCode).toBe(200)
    const { run: taskRun } = dispatched.json() as { run: RunHandle }
    await ended(dispatcher, taskRun.runId)
    delete process.env.FAKE_CLAUDE_MODE

    // The task is edited between the failure and the retry — the retry must
    // carry the new title, not the text captured at dispatch time.
    await writeFile(join(projectPath, 'TASKS.md'),
      TASKS.replace('First thing', 'Completely rewritten thing'))

    const chunks: string[] = []
    dispatcher.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const res = await app.inject({ method: 'POST', url: `/api/runs/${taskRun.runId}/retry` })
    expect(res.statusCode).toBe(200)
    const { run } = res.json() as { run: RunHandle }
    expect(run.taskId).toBe('T-001')
    await ended(dispatcher, run.runId)
    expect(chunks.join('')).toContain('Completely rewritten thing')
    expect(chunks.join('')).not.toContain('First thing')
    await app.close()
  })

  it('404s when the task behind the run no longer exists', async () => {
    const { app, dispatcher, projectPath } = await makeHarness()
    process.env.FAKE_CLAUDE_MODE = 'crash'
    const dispatched = await app.inject({ method: 'POST', url: '/api/projects/p1/tasks/T-001/dispatch' })
    const { run } = dispatched.json() as { run: RunHandle }
    await ended(dispatcher, run.runId)
    delete process.env.FAKE_CLAUDE_MODE

    await writeFile(join(projectPath, 'TASKS.md'), TASKS.replace('- [ ] **T-001** First thing\n', ''))
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/retry` })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('409s a run that is still going, and one that succeeded', async () => {
    const { app, dispatcher } = await makeHarness()
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const started = await app.inject({ method: 'POST', url: '/api/projects/p1/prompt', payload: { text: 'hi' } })
    const { run } = started.json() as { run: RunHandle }

    const running = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/retry` })
    expect(running.statusCode).toBe(409)

    delete process.env.FAKE_CLAUDE_MODE
    dispatcher.cancel(run.runId)
    await ended(dispatcher, run.runId)

    // A cancelled run may be retried; let it succeed this time, then a retry
    // of the SUCCEEDED run must 409.
    const retried = await app.inject({ method: 'POST', url: `/api/runs/${run.runId}/retry` })
    expect(retried.statusCode).toBe(200)
    const { run: second } = retried.json() as { run: RunHandle }
    await ended(dispatcher, second.runId)
    expect(dispatcher.get(second.runId)!.status).toBe('succeeded')

    const ofSucceeded = await app.inject({ method: 'POST', url: `/api/runs/${second.runId}/retry` })
    expect(ofSucceeded.statusCode).toBe(409)
    await app.close()
  })

  it('404s an unknown run', async () => {
    const { app } = await makeHarness()
    const res = await app.inject({ method: 'POST', url: '/api/runs/nope/retry' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('queues the retry when another run holds the project, and the queue can be listed and cancelled', async () => {
    const { app, dispatcher } = await makeHarness()
    const failed = await failedPromptRun(app, dispatcher)

    process.env.FAKE_CLAUDE_MODE = 'hang'
    const blocker = await app.inject({ method: 'POST', url: '/api/projects/p1/prompt', payload: { text: 'blocker' } })
    const { run: liveRun } = blocker.json() as { run: RunHandle }

    const res = await app.inject({ method: 'POST', url: `/api/runs/${failed.runId}/retry` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { queued?: QueuedDispatch }
    expect(body.queued).toBeDefined()
    expect(body.queued!.input.prompt).toBe('original prompt')

    const list = await app.inject({ method: 'GET', url: '/api/queue' })
    expect((list.json() as { queue: QueuedDispatch[] }).queue.map(q => q.queueId)).toEqual([body.queued!.queueId])

    const gone = await app.inject({ method: 'DELETE', url: `/api/queue/${body.queued!.queueId}` })
    expect(gone.statusCode).toBe(200)
    const unknown = await app.inject({ method: 'DELETE', url: `/api/queue/${body.queued!.queueId}` })
    expect(unknown.statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/queue' })).json()).toEqual({ queue: [] })

    dispatcher.cancel(liveRun.runId)
    await ended(dispatcher, liveRun.runId)
    await app.close()
  })
})
