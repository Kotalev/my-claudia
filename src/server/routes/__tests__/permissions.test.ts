import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { PermissionRequestInfo } from '../../../shared/types.js'
import { PermissionBroker, registerPermissionRoutes, summarizeToolInput } from '../permissions.js'

describe('summarizeToolInput', () => {
  it('summarises Bash by its command', () => {
    expect(summarizeToolInput('Bash', { command: 'npm test', description: 'run tests' }))
      .toBe('npm test')
  })

  it('summarises file tools by their path', () => {
    expect(summarizeToolInput('Edit', { file_path: '/tmp/a.ts', old_string: 'x'.repeat(5000) }))
      .toBe('/tmp/a.ts')
    expect(summarizeToolInput('Write', { file_path: '/tmp/b.ts', content: 'y'.repeat(5000) }))
      .toBe('/tmp/b.ts')
  })

  it('never exceeds ~120 chars, marking the cut', () => {
    const summary = summarizeToolInput('Bash', { command: 'x'.repeat(500) })
    expect(summary.length).toBe(120)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('collapses newlines so the card stays one line', () => {
    expect(summarizeToolInput('Bash', { command: 'echo a\n  && echo b' })).toBe('echo a && echo b')
  })

  it('falls back to compact JSON for an unknown tool shape', () => {
    expect(summarizeToolInput('Mystery', { alpha: 1 })).toBe('{"alpha":1}')
  })

  it('degrades to an empty string on malformed tool_input', () => {
    expect(summarizeToolInput('Bash', null)).toBe('')
    expect(summarizeToolInput('Bash', 'not an object')).toBe('')
    expect(summarizeToolInput('Bash', 42)).toBe('')
    expect(summarizeToolInput('Bash', [1, 2])).toBe('')
    expect(summarizeToolInput('Bash', { command: 7 })).toBe('{"command":7}')
    expect(summarizeToolInput(undefined, undefined)).toBe('')
  })
})

const PAYLOAD = {
  session_id: 's-1',
  cwd: '/tmp/proj',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf node_modules' },
  tool_use_id: 'tu-1',
}

async function makeApp(holdMs: number): Promise<{ app: FastifyInstance; broker: PermissionBroker }> {
  const app = Fastify()
  const broker = new PermissionBroker(holdMs)
  registerPermissionRoutes(app, broker)
  await app.ready()
  return { app, broker }
}

/** The sink holds its reply, so the request id must arrive via the broadcast callback. */
function nextRequest(broker: PermissionBroker): Promise<PermissionRequestInfo> {
  return new Promise(resolve => { broker.onRequested = resolve })
}

describe('POST /api/hooks/permission (sink)', () => {
  it('answers 200 {} immediately to a wrong-shape body', async () => {
    const { app } = await makeApp(10_000)
    for (const body of ['{}', '{"session_id":"s"}', '{"tool_name":"Bash"}', '[1,2]', '"text"', '12']) {
      const res = await app.inject({
        method: 'POST', url: '/api/hooks/permission',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({})
    }
    await app.close()
  })

  it('answers 200 {} even to a body that is not JSON at all', async () => {
    const { app } = await makeApp(10_000)
    const res = await app.inject({
      method: 'POST', url: '/api/hooks/permission',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({})
    await app.close()
  })

  it('holds the reply and resolves it with the documented decision payload', async () => {
    const { app, broker } = await makeApp(10_000)
    const requested = nextRequest(broker)
    const held = app.inject({ method: 'POST', url: '/api/hooks/permission', payload: PAYLOAD })

    const request = await requested
    expect(request.sessionId).toBe('s-1')
    expect(request.toolName).toBe('Bash')
    expect(request.toolInputSummary).toBe('rm -rf node_modules')
    expect(request.cwd).toBe('/tmp/proj')
    expect(broker.list()).toHaveLength(1)

    const decision = await app.inject({
      method: 'POST', url: `/api/permissions/${request.id}/decision`,
      payload: { behavior: 'allow' },
    })
    expect(decision.statusCode).toBe(200)

    const res = await held
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    expect(broker.list()).toHaveLength(0)   // answered means gone from the snapshot
    await app.close()
  })

  it('answers {} — no opinion — when the hold window lapses', async () => {
    const { app, broker } = await makeApp(40)
    const res = await app.inject({ method: 'POST', url: '/api/hooks/permission', payload: PAYLOAD })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({})
    expect(broker.list()).toHaveLength(0)
    await app.close()
  })
})

describe('POST /api/permissions/:id/decision', () => {
  it('404s a decision that arrives after the window lapsed', async () => {
    const { app, broker } = await makeApp(40)
    const requested = nextRequest(broker)
    await app.inject({ method: 'POST', url: '/api/hooks/permission', payload: PAYLOAD })
    const request = await requested

    const res = await app.inject({
      method: 'POST', url: `/api/permissions/${request.id}/decision`,
      payload: { behavior: 'deny' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('404s an id that never existed', async () => {
    const { app } = await makeApp(10_000)
    const res = await app.inject({
      method: 'POST', url: '/api/permissions/no-such-id/decision',
      payload: { behavior: 'allow' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('400s a behavior that is neither allow nor deny', async () => {
    const { app, broker } = await makeApp(10_000)
    const requested = nextRequest(broker)
    const held = app.inject({ method: 'POST', url: '/api/hooks/permission', payload: PAYLOAD })
    const request = await requested

    const res = await app.inject({
      method: 'POST', url: `/api/permissions/${request.id}/decision`,
      payload: { behavior: 'always' },
    })
    expect(res.statusCode).toBe(400)

    // Still pending: the bad request must not consume the prompt.
    expect(broker.list()).toHaveLength(1)
    broker.decide(request.id, 'deny')
    await held
    await app.close()
  })

  it('reports deny as deny in both the held reply and the broadcast', async () => {
    const { app, broker } = await makeApp(10_000)
    const requested = nextRequest(broker)
    const resolved: Array<[string, string]> = []
    broker.onResolved = (id, behavior) => resolved.push([id, behavior])
    const held = app.inject({ method: 'POST', url: '/api/hooks/permission', payload: PAYLOAD })
    const request = await requested

    await app.inject({
      method: 'POST', url: `/api/permissions/${request.id}/decision`,
      payload: { behavior: 'deny' },
    })
    const res = await held
    expect(res.json().hookSpecificOutput.decision.behavior).toBe('deny')
    expect(resolved).toEqual([[request.id, 'deny']])
    await app.close()
  })
})
