import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InterruptedRunStore } from '../interrupted.js'
import type { RunHandle } from '../../../shared/types.js'

async function tmpStore(): Promise<{ path: string; store: InterruptedRunStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-interrupted-'))
  const path = join(dir, 'interrupted-runs.json')
  return { path, store: new InterruptedRunStore(path) }
}

function handle(over: Partial<RunHandle> = {}): RunHandle {
  return {
    runId: 'r1', projectId: 'p1', taskId: null, kind: 'prompt', sessionId: null,
    status: 'running', startedAt: '2026-08-13T10:00:00Z', endedAt: null,
    exitCode: null, costUsd: null, numTurns: null,
    ...over,
  }
}

describe('InterruptedRunStore', () => {
  it('a mirrored live run becomes the next process\'s leftover', async () => {
    const { path, store } = await tmpStore()
    await store.load()
    store.record(handle({ sessionId: 'sess-1', status: 'awaiting-input' }), 'fix the tests')
    await store.flush()

    // A fresh store on the same file is "the next process".
    const next = new InterruptedRunStore(path)
    await next.load()
    expect(next.list()).toHaveLength(1)
    expect(next.list()[0]).toMatchObject({
      runId: 'r1', sessionId: 'sess-1', prompt: 'fix the tests', status: 'awaiting-input',
    })
    // The current process's own mirror entries are never in its offer list.
    expect(store.list()).toHaveLength(0)
  })

  it('a run that ended cleanly leaves no leftover', async () => {
    const { path, store } = await tmpStore()
    await store.load()
    store.record(handle(), 'do a thing')
    store.drop('r1')
    await store.flush()

    const next = new InterruptedRunStore(path)
    await next.load()
    expect(next.list()).toHaveLength(0)
  })

  it('record upserts by runId rather than duplicating', async () => {
    const { path, store } = await tmpStore()
    await store.load()
    store.record(handle(), 'p')
    store.record(handle({ sessionId: 'sess-9' }), 'p')
    await store.flush()

    const next = new InterruptedRunStore(path)
    await next.load()
    expect(next.list()).toHaveLength(1)
    expect(next.list()[0]!.sessionId).toBe('sess-9')
  })

  it('removeLeftover removes exactly once and persists', async () => {
    const { path, store } = await tmpStore()
    await store.load()
    store.record(handle(), 'p')
    await store.flush()

    const next = new InterruptedRunStore(path)
    await next.load()
    expect(next.removeLeftover('r1')).toBe(true)
    expect(next.removeLeftover('r1')).toBe(false)
    await next.flush()
    const raw = JSON.parse(await readFile(path, 'utf8')) as { runs: unknown[] }
    expect(raw.runs).toHaveLength(0)
  })

  it('leftovers survive alongside the current process\'s own mirror in the file', async () => {
    const { path, store } = await tmpStore()
    await store.load()
    store.record(handle(), 'old run')
    await store.flush()

    const next = new InterruptedRunStore(path)
    await next.load()
    next.record(handle({ runId: 'r2' }), 'new run')
    await next.flush()

    const third = new InterruptedRunStore(path)
    await third.load()
    expect(third.list().map(r => r.runId).sort()).toEqual(['r1', 'r2'])
  })

  it('starts empty on a missing, corrupt, or wrong-shaped file', async () => {
    const missing = new InterruptedRunStore(join(tmpdir(), 'nope', 'nothing.json'))
    await missing.load()
    expect(missing.list()).toEqual([])

    const { path, store } = await tmpStore()
    await writeFile(path, 'not json at all {{{', 'utf8')
    await store.load()
    expect(store.list()).toEqual([])

    await writeFile(path, JSON.stringify({ runs: [{ bogus: true }, 42, null] }), 'utf8')
    await store.load()
    expect(store.list()).toEqual([])
  })
})
