import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Dispatcher, type RunHandle } from '../index.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-claude.mjs', import.meta.url))

function ended(d: Dispatcher, runId: string): Promise<RunHandle> {
  return new Promise(resolve => {
    d.on('update', (h: RunHandle) => { if (h.runId === runId && h.endedAt !== null) resolve(h) })
  })
}

async function startRun(mode: string): Promise<{ dispatcher: Dispatcher; run: RunHandle; rateLimited: RunHandle[] }> {
  const projectPath = await mkdtemp(join(tmpdir(), 'mc-rl-'))   // not a git repo → in-place
  process.env.FAKE_CLAUDE_MODE = mode
  try {
    const dispatcher = new Dispatcher({ claudeBin: process.execPath, extraArgs: [FAKE], timeoutMs: 5000, idleMs: 150 })
    const rateLimited: RunHandle[] = []
    dispatcher.on('rate-limited', (h: RunHandle) => rateLimited.push(h))
    const run = await dispatcher.start({ projectId: 'p1', projectPath, taskId: null, prompt: 'go', kind: 'prompt' })
    return { dispatcher, run, rateLimited }
  } finally {
    delete process.env.FAKE_CLAUDE_MODE
  }
}

describe('dispatcher rate-limit capture', () => {
  it('captures the last rate_limit_info and emits rate-limited when a run fails under it', async () => {
    const { dispatcher, run, rateLimited } = await startRun('rate-limited')
    const final = await ended(dispatcher, run.runId)

    expect(final.status).toBe('failed')
    expect(final.lastRateLimit).toEqual({
      status: 'rejected',
      resetsAt: 1786607400,          // epoch seconds, exactly as the stream said
      rateLimitType: 'five_hour',
    })
    expect(rateLimited).toHaveLength(1)
    expect(rateLimited[0]?.runId).toBe(run.runId)
    expect(rateLimited[0]?.sessionId).toBe('fake-session-123')
  })

  it('ignores a garbage rate_limit_info: the run just fails, no rate-limited event', async () => {
    const { dispatcher, run, rateLimited } = await startRun('rate-limited-garbage')
    const final = await ended(dispatcher, run.runId)

    expect(final.status).toBe('failed')
    expect(final.lastRateLimit).toBeNull()
    expect(rateLimited).toHaveLength(0)
  })

  it('an allowed rate_limit_event on a successful run emits nothing', async () => {
    // mode 'garbage' answers the turn normally but sprays a rate_limit_event
    // with status 'allowed' plus non-JSON noise into the stream first.
    const { dispatcher, run, rateLimited } = await startRun('garbage')
    const final = await ended(dispatcher, run.runId)

    expect(final.status).toBe('succeeded')
    expect(final.lastRateLimit).toEqual({ status: 'allowed', resetsAt: null, rateLimitType: null })
    expect(rateLimited).toHaveLength(0)
  })

  it('a plain failure with no rate_limit_event stays a plain failure', async () => {
    const { dispatcher, run, rateLimited } = await startRun('crash')
    const final = await ended(dispatcher, run.runId)

    expect(final.status).toBe('failed')
    expect(final.lastRateLimit).toBeNull()
    expect(rateLimited).toHaveLength(0)
  })
})
