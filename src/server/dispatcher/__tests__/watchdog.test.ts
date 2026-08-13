import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Dispatcher, type RunHandle } from '../index.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

// Real short timers rather than vi.useFakeTimers: these tests wait on real
// child-process I/O, which fake timers cannot advance. Thresholds are far
// apart so a slow CI machine cannot blur which flag fired.
function makeDispatcher(opts: { stallAfterMs?: number; warnAfterMs?: number; idleMs?: number } = {}) {
  return new Dispatcher({
    claudeBin: process.execPath,
    extraArgs: [FAKE],
    timeoutMs: 30_000,
    idleMs: opts.idleMs ?? 30_000,
    stallAfterMs: opts.stallAfterMs ?? 30_000,
    warnAfterMs: opts.warnAfterMs ?? 30_000,
    watchdogIntervalMs: 25,
  })
}

const input = { projectId: 'p1', projectPath: tmpdir(), taskId: 'T-001', prompt: 'do the thing' }

function until(d: Dispatcher, runId: string, pred: (h: RunHandle) => boolean, ms = 5000): Promise<RunHandle> {
  return new Promise((resolve, reject) => {
    const existing = d.get(runId)
    if (existing && pred(existing)) { resolve(existing); return }
    const timer = setTimeout(() => reject(new Error('condition never held')), ms)
    d.on('update', (h: RunHandle) => {
      if (h.runId === runId && pred(h)) { clearTimeout(timer); resolve(h) }
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function cleanup(d: Dispatcher, runId: string): Promise<void> {
  const done = until(d, runId, h => h.endedAt !== null)
  if (!d.cancel(runId)) return
  await done
}

afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

describe('Dispatcher — watchdog', () => {
  it('flags a quiet running run as stalled, via an update', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher({ stallAfterMs: 150 })
    const handle = await d.start(input)
    expect(handle.stalled).toBe(false)
    const flagged = await until(d, handle.runId, h => h.stalled === true)
    expect(flagged.status).toBe('running')
    await cleanup(d, handle.runId)
  })

  it('clears the stalled flag as soon as output resumes', async () => {
    process.env.FAKE_CLAUDE_MODE = 'echo-only'
    const d = makeDispatcher({ stallAfterMs: 150 })
    const handle = await d.start(input)
    const stalledAt = (await until(d, handle.runId, h => h.stalled === true)).lastOutputAt
    d.steer(handle.runId, 'still there?')   // the fake echoes but sends no result
    const cleared = await until(d, handle.runId, h => h.stalled === false)
    expect(cleared.status).toBe('running')
    expect(cleared.lastOutputAt).not.toBe(stalledAt)
    await cleanup(d, handle.runId)
  })

  it('never stalls an awaiting-input run — it is waiting for us', async () => {
    const d = makeDispatcher({ stallAfterMs: 100 })
    const handle = await d.start(input)
    await until(d, handle.runId, h => h.status === 'awaiting-input')
    await sleep(300)   // several sweeps past the stall threshold
    expect(d.get(handle.runId)!.stalled).toBe(false)
    await cleanup(d, handle.runId)
  })

  it('flags a long run once and does not re-announce it', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher({ warnAfterMs: 150 })
    const handle = await d.start(input)
    await until(d, handle.runId, h => h.longRunning === true)
    let updates = 0
    d.on('update', (h: RunHandle) => { if (h.runId === handle.runId) updates += 1 })
    await sleep(200)   // several more sweeps
    expect(updates).toBe(0)
    expect(d.get(handle.runId)!.longRunning).toBe(true)
    await cleanup(d, handle.runId)
  })

  it('leaves finished runs alone', async () => {
    const d = makeDispatcher({ stallAfterMs: 100, warnAfterMs: 100, idleMs: 50 })
    const handle = await d.start(input)
    await until(d, handle.runId, h => h.endedAt !== null)
    let updates = 0
    d.on('update', (h: RunHandle) => { if (h.runId === handle.runId) updates += 1 })
    await sleep(300)   // well past both thresholds
    expect(updates).toBe(0)
    const run = d.get(handle.runId)!
    expect(run.stalled).toBe(false)
    expect(run.longRunning).toBe(false)
  })
})
