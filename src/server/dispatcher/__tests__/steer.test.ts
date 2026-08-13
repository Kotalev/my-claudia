import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Dispatcher, type RunHandle } from '../index.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

const input = { projectId: 'p1', projectPath: tmpdir(), taskId: 'T-001', prompt: 'first turn' }

function makeDispatcher(opts: { timeoutMs?: number; idleMs?: number } = {}) {
  return new Dispatcher({
    claudeBin: process.execPath,
    extraArgs: [FAKE],
    timeoutMs: opts.timeoutMs ?? 5000,
    idleMs: opts.idleMs ?? 60_000,
  })
}

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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

describe('Dispatcher — steering', () => {
  it('flips to awaiting-input after the result, with the run still alive', async () => {
    const d = makeDispatcher()
    const handle = await d.start(input)
    await awaiting(d, handle.runId)
    const run = d.get(handle.runId)!
    expect(run.status).toBe('awaiting-input')
    expect(run.endedAt).toBeNull()
    expect(d.finishInput(handle.runId)).toBe(true)
    await ended(d, handle.runId)
  })

  it('steer starts a new turn in the same session and echoes the message into the feed', async () => {
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = await d.start(input)
    await awaiting(d, handle.runId)

    const next = awaiting(d, handle.runId)
    expect(d.steer(handle.runId, 'second turn')).toBe(true)
    expect(d.get(handle.runId)!.status).toBe('running')
    await next

    const out = chunks.join('')
    expect(out).toContain('> you: second turn')
    expect(out).toContain('echo:second turn')
    expect(d.get(handle.runId)!.sessionId).toBe('fake-session-123')

    d.finishInput(handle.runId)
    await ended(d, handle.runId)
    expect(d.get(handle.runId)!.status).toBe('succeeded')
  })

  it('finishInput ends stdin and the run concludes as succeeded', async () => {
    const d = makeDispatcher()
    const handle = await d.start(input)
    await awaiting(d, handle.runId)
    expect(d.finishInput(handle.runId)).toBe(true)
    await ended(d, handle.runId)
    const run = d.get(handle.runId)!
    expect(run.status).toBe('succeeded')
    expect(run.exitCode).toBe(0)
  })

  it('refuses to steer or finish a run that has ended', async () => {
    const d = makeDispatcher()
    const handle = await d.start(input)
    await awaiting(d, handle.runId)
    d.finishInput(handle.runId)
    await ended(d, handle.runId)
    expect(d.steer(handle.runId, 'too late')).toBe(false)
    expect(d.finishInput(handle.runId)).toBe(false)
    expect(d.steer('no-such-run', 'hello')).toBe(false)
    expect(d.finishInput('no-such-run')).toBe(false)
  })

  it('auto-finishes an awaiting-input run after the idle window', async () => {
    const d = makeDispatcher({ idleMs: 100 })
    const handle = await d.start(input)
    await ended(d, handle.runId)
    const run = d.get(handle.runId)!
    expect(run.status).toBe('succeeded')
    expect(run.exitCode).toBe(0)
  })

  it('a steer resets the overall supervisor timeout', async () => {
    const d = makeDispatcher({ timeoutMs: 700 })
    const handle = await d.start(input)
    await awaiting(d, handle.runId)
    await sleep(400)
    expect(d.steer(handle.runId, 'keep going')).toBe(true)
    // Without the reset the 700ms supervisor would have fired by now.
    await sleep(500)
    const run = d.get(handle.runId)!
    expect(run.status).toBe('awaiting-input')
    expect(run.endedAt).toBeNull()
    d.finishInput(handle.runId)
    await ended(d, handle.runId)
  }, 10_000)

  it('survives garbage, rate_limit_event and unknown lines in the stream', async () => {
    process.env.FAKE_CLAUDE_MODE = 'garbage'
    const d = makeDispatcher()
    const chunks: string[] = []
    d.on('output', (e: { chunk: string }) => chunks.push(e.chunk))
    const handle = await d.start(input)
    await awaiting(d, handle.runId)
    d.finishInput(handle.runId)
    await ended(d, handle.runId)
    const run = d.get(handle.runId)!
    expect(run.status).toBe('succeeded')
    // Structured noise is skipped, never rendered raw and never fatal.
    expect(chunks.join('')).not.toContain('rate_limit_info')
  })

  it('steering a cancelled run returns false', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const handle = await d.start(input)
    const done = ended(d, handle.runId)
    d.cancel(handle.runId)
    await done
    expect(d.steer(handle.runId, 'anyone there?')).toBe(false)
  })
})
