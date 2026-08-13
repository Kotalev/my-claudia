import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Dispatcher, type RunHandle } from '../index.js'
import { DispatchQueue } from '../queue.js'
import { initRepo } from './init-repo.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

// A short idleMs so a run that answered its prompt concludes on its own.
function makeDispatcher(timeoutMs = 5000, idleMs = 150) {
  return new Dispatcher({ claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs, idleMs })
}

// tmpdir is not a git repo, so these dispatches are in-place — the only kind
// the 1-per-project guard (and therefore the queue) applies to.
const input = { projectId: 'p1', projectPath: tmpdir(), taskId: 'T-001', prompt: 'do the thing' }

function ended(d: Dispatcher, runId: string): Promise<void> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve() })
  })
}

function started(q: DispatchQueue): Promise<{ queued: { queueId: string }; run: RunHandle }> {
  return new Promise(resolve => q.once('started', resolve))
}

afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

describe('DispatchQueue', () => {
  it('starts immediately when the project is free', async () => {
    const d = makeDispatcher()
    const q = new DispatchQueue(d)
    const result = await q.start(input)
    expect('run' in result).toBe(true)
    expect(q.list()).toEqual([])
    if ('run' in result) await ended(d, result.run.runId)
  })

  it('queues instead of erroring when an in-place run already holds the project', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const q = new DispatchQueue(d)
    const changed = vi.fn()
    q.on('changed', changed)

    const first = await q.start(input)
    expect('run' in first).toBe(true)
    const second = await q.start({ ...input, prompt: 'second' })
    expect('queued' in second).toBe(true)
    if (!('queued' in second) || !('run' in first)) throw new Error('unreachable')

    expect(q.list().map(i => i.queueId)).toEqual([second.queued.queueId])
    expect(second.queued.projectId).toBe('p1')
    expect(second.queued.input.prompt).toBe('second')
    expect(changed).toHaveBeenCalledTimes(1)

    // Subscribed BEFORE the cancel: the drain fires in a microtask right after
    // the run's final 'update', earlier than this test would resume.
    const firedP = started(q)
    d.cancel(first.run.runId)
    const fired = await firedP
    expect(fired.queued.queueId).toBe(second.queued.queueId)
    expect(q.list()).toEqual([])
    d.cancel(fired.run.runId)
    await ended(d, fired.run.runId)
  })

  it('drains queued items in FIFO order, one per run end', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const q = new DispatchQueue(d)
    const first = await q.start(input)
    const a = await q.start({ ...input, prompt: 'a' })
    const b = await q.start({ ...input, prompt: 'b' })
    if (!('run' in first) || !('queued' in a) || !('queued' in b)) throw new Error('unreachable')
    expect(q.list().map(i => i.input.prompt)).toEqual(['a', 'b'])

    const firstDrainP = started(q)
    d.cancel(first.run.runId)
    const firstDrain = await firstDrainP
    expect(firstDrain.queued.queueId).toBe(a.queued.queueId)
    expect(q.list().map(i => i.queueId)).toEqual([b.queued.queueId])   // b waits for a's run to end

    const secondDrainP = started(q)
    d.cancel(firstDrain.run.runId)
    const secondDrain = await secondDrainP
    expect(secondDrain.queued.queueId).toBe(b.queued.queueId)
    expect(q.list()).toEqual([])
    d.cancel(secondDrain.run.runId)
    await ended(d, secondDrain.run.runId)
  })

  it('cancels a queued item; cancelling the unknown answers false', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const d = makeDispatcher()
    const q = new DispatchQueue(d)
    const first = await q.start(input)
    const queued = await q.start({ ...input, prompt: 'never runs' })
    if (!('run' in first) || !('queued' in queued)) throw new Error('unreachable')

    expect(q.cancel('no-such-id')).toBe(false)
    expect(q.cancel(queued.queued.queueId)).toBe(true)
    expect(q.list()).toEqual([])
    // Nothing left to drain: the run's end starts nothing.
    const fired = vi.fn()
    q.on('started', fired)
    d.cancel(first.run.runId)
    await ended(d, first.run.runId)
    await new Promise(r => setTimeout(r, 50))
    expect(fired).not.toHaveBeenCalled()
  })

  it('never queues worktree-isolated inputs — they run concurrently', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    const repo = await initRepo()
    const d = makeDispatcher()
    const q = new DispatchQueue(d)
    const a = await q.start({ ...input, projectPath: repo })
    const b = await q.start({ ...input, projectPath: repo })
    expect('run' in a && 'run' in b).toBe(true)
    expect(q.list()).toEqual([])
    if ('run' in a && 'run' in b) {
      d.cancel(a.run.runId); d.cancel(b.run.runId)
      await Promise.all([ended(d, a.run.runId), ended(d, b.run.runId)])
    }
  })

  it('still throws validation errors instead of queueing them', async () => {
    const d = makeDispatcher()
    const q = new DispatchQueue(d)
    await expect(q.start({ ...input, taskId: null, kind: 'resume' }))
      .rejects.toThrow(/resumeSessionId/i)
    expect(q.list()).toEqual([])
  })

  it('drops a queued item whose start fails at drain time rather than retrying forever', async () => {
    // A stub dispatcher: blocked at enqueue time, free but broken at drain time.
    const stub = new EventEmitter() as EventEmitter & {
      wouldBlock: () => boolean
      start: () => Promise<RunHandle>
    }
    let blocked = true
    stub.wouldBlock = () => blocked
    stub.start = () => Promise.reject(new Error('spawn exploded'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* keep output clean */ })

    const q = new DispatchQueue(stub as unknown as Dispatcher)
    const result = await q.start(input)
    expect('queued' in result).toBe(true)

    blocked = false
    const changed = new Promise(resolve => q.once('changed', resolve))
    stub.emit('update', { projectId: 'p1', endedAt: '2026-08-13T10:00:00Z' } as RunHandle)
    await changed
    expect(q.list()).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
