import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord, RunHandle, SessionSummary } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import type { SessionStore } from '../../watcher/session-store.js'
import { Dispatcher } from '../../dispatcher/index.js'
import { registerDispatchRoutes } from '../dispatch.js'
import { DispatchQueue } from '../../dispatcher/queue.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

/** Just enough of a SessionSummary for the resume route: id, project, liveness. */
function summaryOf(over: Partial<SessionSummary>): SessionSummary {
  return { sessionId: 'sess-1', projectId: 'p1', live: null, ...over } as SessionSummary
}

async function makeHarness(summaries: Record<string, SessionSummary> = {}): Promise<{
  app: FastifyInstance
  dispatcher: Dispatcher
}> {
  const projectPath = await mkdtemp(join(tmpdir(), 'mc-prompt-'))
  const worktreesRoot = await mkdtemp(join(tmpdir(), 'mc-prompt-wt-'))
  // Short idleMs so runs conclude on their own once the fake has answered.
  const dispatcher = new Dispatcher({
    claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs: 5000, idleMs: 150, worktreesRoot,
  })
  const project: ProjectRecord = {
    id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
  }
  const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
  const sessions = { get: (id: string) => summaries[id] } as unknown as SessionStore
  const app = Fastify()
  registerDispatchRoutes(app, registry, dispatcher, new DispatchQueue(dispatcher), sessions, () => {})
  await app.ready()
  return { app, dispatcher }
}

describe('POST /api/projects/:id/prompt', () => {
  it('starts a taskless prompt run', async () => {
    const { app, dispatcher } = await makeHarness()
    const res = await app.inject({
      method: 'POST', url: '/api/projects/p1/prompt', payload: { text: 'do a thing' },
    })
    expect(res.statusCode).toBe(200)
    const { run } = res.json() as { run: RunHandle }
    expect(run.kind).toBe('prompt')
    expect(run.taskId).toBeNull()
    await ended(dispatcher, run.runId)
    expect(dispatcher.get(run.runId)!.status).toBe('succeeded')
    await app.close()
  })

  it('404s an unknown project and 400s empty or missing text', async () => {
    const { app } = await makeHarness()
    const missing = await app.inject({
      method: 'POST', url: '/api/projects/nope/prompt', payload: { text: 'hello' },
    })
    expect(missing.statusCode).toBe(404)

    const empty = await app.inject({
      method: 'POST', url: '/api/projects/p1/prompt', payload: { text: '   ' },
    })
    expect(empty.statusCode).toBe(400)

    const absent = await app.inject({
      method: 'POST', url: '/api/projects/p1/prompt', payload: {},
    })
    expect(absent.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /api/sessions/:sessionId/resume', () => {
  it('dispatches a resume run for a known, non-live session', async () => {
    const { app, dispatcher } = await makeHarness({ 'sess-1': summaryOf({}) })
    const chunks: string[] = []
    dispatcher.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/sess-1/resume', payload: { text: 'carry on' },
    })
    expect(res.statusCode).toBe(200)
    const { run } = res.json() as { run: RunHandle }
    expect(run.kind).toBe('resume')
    expect(run.taskId).toBeNull()
    expect(run.sessionId).toBe('sess-1')
    await ended(dispatcher, run.runId)
    expect(chunks.join('')).toContain('--resume sess-1')
    await app.close()
  })

  it('404s an unknown session and a session without a registered project', async () => {
    const { app } = await makeHarness({
      'orphan': summaryOf({ sessionId: 'orphan', projectId: null }),
      'stray': summaryOf({ sessionId: 'stray', projectId: 'not-registered' }),
    })
    const unknown = await app.inject({
      method: 'POST', url: '/api/sessions/nope/resume', payload: { text: 'hi' },
    })
    expect(unknown.statusCode).toBe(404)

    const orphan = await app.inject({
      method: 'POST', url: '/api/sessions/orphan/resume', payload: { text: 'hi' },
    })
    expect(orphan.statusCode).toBe(404)

    const stray = await app.inject({
      method: 'POST', url: '/api/sessions/stray/resume', payload: { text: 'hi' },
    })
    expect(stray.statusCode).toBe(404)
    await app.close()
  })

  it('409s a session that is live in another terminal', async () => {
    const { app } = await makeHarness({
      'sess-1': summaryOf({ live: { sessionId: 'sess-1' } as SessionSummary['live'] }),
    })
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/sess-1/resume', payload: { text: 'hi' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toMatch(/live/i)
    await app.close()
  })

  it('400s empty text', async () => {
    const { app } = await makeHarness({ 'sess-1': summaryOf({}) })
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/sess-1/resume', payload: { text: '' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
