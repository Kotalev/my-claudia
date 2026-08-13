import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Dispatcher, type RunHandle } from '../index.js'
import { initRepo } from './init-repo.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

// A short idleMs: after the fake answers the prompt the run sits in
// 'awaiting-input', and these lifecycle tests want it to conclude on its own.
function makeDispatcher(timeoutMs = 5000, idleMs = 150) {
  return new Dispatcher({ claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs, idleMs })
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

  it('sends the prompt over stdin as stream-json, never through argv or a shell', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const nasty = 'rm -rf / ; echo pwned && cat /etc/passwd'
    const handle = await d.start({ ...input, prompt: nasty })
    await ended(d, handle.runId)

    const out = chunks.join('')
    // fake-claude echoes its argv: only the six flags, no prompt element.
    expect(out).toContain('args:6')
    // fake-claude echoes each stdin user message: the prompt arrived intact,
    // not split on spaces or interpreted by a shell.
    expect(out).toContain(`echo:${nasty}`)
    expect(d.get(handle.runId)!.status).toBe('succeeded')
  })

  it('reports a run that could not be spawned as failed', async () => {
    const d = new Dispatcher({ claudeBin: '/nonexistent/claude-binary', timeoutMs: 5000 })
    const handle = await d.start(input)
    await ended(d, handle.runId)
    expect(d.list()[0]!.status).toBe('failed')
  })
})

describe('Dispatcher — run kinds', () => {
  it('a prompt run carries kind and a null taskId, and completes normally', async () => {
    const d = makeDispatcher()
    const handle = await d.start({ ...input, taskId: null, kind: 'prompt' })
    await ended(d, handle.runId)
    const run = d.get(handle.runId)!
    expect(run.kind).toBe('prompt')
    expect(run.taskId).toBeNull()
    expect(run.status).toBe('succeeded')
  })

  it('a resume run puts --resume <id> in argv and knows its session id up front', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = await d.start({
      ...input, taskId: null, kind: 'resume', resumeSessionId: 'sess-abc-def',
    })
    expect(handle.sessionId).toBe('sess-abc-def')
    await ended(d, handle.runId)
    expect(chunks.join('')).toContain('--resume sess-abc-def')
    // The preset id survives the fake's own init event.
    expect(d.get(handle.runId)!.sessionId).toBe('sess-abc-def')
  })

  it('refuses a resume run without a session id', async () => {
    const d = makeDispatcher()
    await expect(d.start({ ...input, taskId: null, kind: 'resume' }))
      .rejects.toThrow(/resumeSessionId/i)
  })

  it('a resume run stays in place even in a git repo and keeps the 1-per-project guard', async () => {
    const repo = await initRepo()
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const first = await d.start({
      projectId: 'pr', projectPath: repo, taskId: null, prompt: 'go',
      kind: 'resume', resumeSessionId: 's1',
    })
    expect(first.isolation).toBe('in-place')
    await expect(d.start({
      projectId: 'pr', projectPath: repo, taskId: null, prompt: 'go',
      kind: 'resume', resumeSessionId: 's2',
    })).rejects.toThrow(/already running/i)
    d.cancel(first.runId)
    await ended(d, first.runId)
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
