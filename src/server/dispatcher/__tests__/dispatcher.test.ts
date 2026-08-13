import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Dispatcher, type RunHandle } from '../index.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function makeDispatcher(timeoutMs = 5000) {
  return new Dispatcher({ claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs })
}

const input = { projectId: 'p1', projectPath: tmpdir(), taskId: 'T-001', prompt: 'do the thing' }

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

describe('Dispatcher', () => {
  it('captures the session id from the init event, not the first line', async () => {
    const d = makeDispatcher()
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.sessionId).toBe('fake-session-123')
  })

  it('streams readable output rather than raw stream-json', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = await d.start(input)
    await ended(d, handle.runId)
    const out = chunks.join('')
    expect(out).toContain('session fake-session-123')
    expect(out).not.toContain('"subtype"')     // no raw json leaks through
  })

  it('marks a clean exit as succeeded', async () => {
    const d = makeDispatcher()
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('succeeded')
    expect(d.list()[0]!.exitCode).toBe(0)
  })

  it('marks a non-zero exit as failed', async () => {
    process.env.FAKE_CLAUDE_MODE = 'crash'
    const d = makeDispatcher()
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('failed')
  })

  it('refuses a second concurrent run for the same project', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const first = await d.start(input)
    await expect(d.start(input)).rejects.toThrow(/already running/i)
    d.cancel(first.runId)
    await ended(d, first.runId)
  })

  it('allows a run in a different project at the same time', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const a = await d.start(input)
    const b = await d.start({ ...input, projectId: 'p2' })
    expect(d.list()).toHaveLength(2)
    d.cancel(a.runId); d.cancel(b.runId)
    await Promise.all([ended(d, a.runId), ended(d, b.runId)])
  })

  it('cancels a hanging run', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const handle = await d.start(input)
    const done = ended(d, handle.runId)
    expect(d.cancel(handle.runId)).toBe(true)
    await done
    expect(d.list()[0]!.status).toBe('cancelled')
  })

  it('kills a run that exceeds the supervisor timeout', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher(300)
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('cancelled')
  }, 10_000)

  it('passes the prompt as a single argv element, never through a shell', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const nasty = 'rm -rf / ; echo pwned && cat /etc/passwd'
    const handle = await d.start({ ...input, prompt: nasty })
    await ended(d, handle.runId)

    // fake-claude echoes its own argv: the whole prompt must arrive intact as
    // ONE element, not split on spaces or interpreted by a shell.
    // fake-claude echoes its argv as assistant text, so the rendered stream shows
    // the whole prompt as one piece rather than split on spaces by a shell.
    expect(chunks.join('')).toContain(`args:5`)
    expect(d.get(handle.runId)!.status).toBe('succeeded')
  })

  it('reports a run that could not be spawned as failed', async () => {
    const d = new Dispatcher({ claudeBin: '/nonexistent/claude-binary', timeoutMs: 5000 })
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('failed')
  })
})

describe('Dispatcher — what claude reported', () => {
  it('keeps the run cost and turn count from the result event', async () => {
    const d = makeDispatcher()
    const handle = await d.start(input)
    await ended(d, handle.runId)
    const run = d.get(handle.runId)!
    expect(run.costUsd).toBe(0.01)
    expect(run.numTurns).toBe(6)
  })

  it('reports null rather than zero when the run never said', async () => {
    process.env.FAKE_CLAUDE_MODE = 'crash'
    const d = makeDispatcher()
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.get(handle.runId)!.costUsd).toBeNull()
  })
})
