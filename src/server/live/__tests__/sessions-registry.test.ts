import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isSessionFile,
  parseSessionFile,
  processStartTimes,
  isLive,
  SessionsRegistry,
} from '../sessions-registry.js'
import type { LiveProcess } from '../../../shared/types.js'

const REAL = JSON.stringify({
  pid: 10478,
  sessionId: '13f5f648-f06d-47c9-b4ab-80730e9c0325',
  cwd: '/Users/dev/Projects/my-claudia',
  startedAt: 1786522794850,
  procStart: 'Wed Aug 12 08:19:53 2026',
  version: '2.1.228',
  peerProtocol: 1,
  kind: 'interactive',
  entrypoint: 'cli',
  messagingSocketPath: '/tmp/cc-socks/10478.sock',
  name: 'my-claudia',
  status: 'busy',
  updatedAt: 1786526868137,
})

describe('isSessionFile', () => {
  it('accepts <pid>.json', () => {
    expect(isSessionFile('10478.json')).toBe(true)
  })

  it('rejects the sibling key files, which are secrets', () => {
    expect(isSessionFile('10478.4196d4231d1dbfe764320c430692ce91.key')).toBe(false)
    expect(isSessionFile('10478.json.key')).toBe(false)
  })

  it('rejects anything not named after a pid', () => {
    expect(isSessionFile('settings.json')).toBe(false)
    expect(isSessionFile('.DS_Store')).toBe(false)
  })
})

describe('parseSessionFile', () => {
  it('reads a real registry entry', () => {
    const p = parseSessionFile(REAL)
    expect(p).toMatchObject({
      sessionId: '13f5f648-f06d-47c9-b4ab-80730e9c0325',
      pid: 10478,
      cwd: '/Users/dev/Projects/my-claudia',
      name: 'my-claudia',
      kind: 'interactive',
      entrypoint: 'cli',
      version: '2.1.228',
      state: 'busy',
    })
    expect(p?.startedAt).toBe(new Date(1786522794850).toISOString())
  })

  it('reads `waiting`, the state that means the agent is blocked on the user', () => {
    const p = parseSessionFile(JSON.stringify({ pid: 1, sessionId: 's', status: 'waiting', waitingFor: 'permission' }))
    expect(p?.state).toBe('waiting')
    expect(p?.waitingFor).toBe('permission')
  })

  it('treats a missing status as idle rather than inventing activity', () => {
    // sdk-cli entries genuinely have no status field.
    const p = parseSessionFile(JSON.stringify({ pid: 48483, sessionId: 's', entrypoint: 'sdk-cli' }))
    expect(p?.state).toBe('idle')
  })

  it('treats an unrecognised status as idle', () => {
    const p = parseSessionFile(JSON.stringify({ pid: 1, sessionId: 's', status: 'compacting-or-whatever-is-next' }))
    expect(p?.state).toBe('idle')
  })

  it('returns null for a half-written file rather than throwing', () => {
    expect(parseSessionFile('{"pid":10478,"sessionI')).toBeNull()
    expect(parseSessionFile('')).toBeNull()
    expect(parseSessionFile('null')).toBeNull()
    expect(parseSessionFile('[]')).toBeNull()
    expect(parseSessionFile('"a string"')).toBeNull()
  })

  it('returns null when the join key or pid is missing or the wrong type', () => {
    expect(parseSessionFile(JSON.stringify({ pid: 1 }))).toBeNull()
    expect(parseSessionFile(JSON.stringify({ sessionId: 's' }))).toBeNull()
    expect(parseSessionFile(JSON.stringify({ pid: '10478', sessionId: 's' }))).toBeNull()
    expect(parseSessionFile(JSON.stringify({ pid: 0, sessionId: 's' }))).toBeNull()
    expect(parseSessionFile(JSON.stringify({ pid: 1.5, sessionId: 's' }))).toBeNull()
  })

  it('survives a garbage startedAt instead of producing an invalid date', () => {
    const p = parseSessionFile(JSON.stringify({ pid: 1, sessionId: 's', startedAt: 'yesterday' }))
    expect(p?.startedAt).toBe(new Date(0).toISOString())
  })
})

describe('processStartTimes', () => {
  it('finds this process own start time', async () => {
    const starts = await processStartTimes([process.pid])
    const at = starts.get(process.pid)
    expect(at).toBeDefined()
    // Started in the past, and not before this machine was built.
    expect(at!).toBeLessThanOrEqual(Date.now() + 1000)
    expect(at!).toBeGreaterThan(Date.parse('2020-01-01'))
  })

  it('returns an empty map for no pids without invoking ps', async () => {
    expect((await processStartTimes([])).size).toBe(0)
  })

  it('degrades to an empty map when every pid is gone', async () => {
    const starts = await processStartTimes([2 ** 22])
    expect(starts.size).toBe(0)
  })
})

function proc(over: Partial<LiveProcess> = {}): LiveProcess {
  return {
    sessionId: 's', pid: process.pid, cwd: null, name: null, kind: 'interactive',
    entrypoint: 'cli', version: null, startedAt: new Date().toISOString(),
    state: 'idle', waitingFor: null, ...over,
  }
}

describe('isLive', () => {
  it('trusts a background agent, which has no pid of its own', () => {
    expect(isLive(proc({ pid: null }), new Map())).toBe(true)
  })

  it('rejects a stale entry whose process is gone', () => {
    expect(isLive(proc({ pid: 2 ** 22 }), new Map())).toBe(false)
  })

  it('accepts a live pid whose start time matches the session', async () => {
    const starts = await processStartTimes([process.pid])
    const started = starts.get(process.pid)!
    expect(isLive(proc({ startedAt: new Date(started + 1500).toISOString() }), starts)).toBe(true)
  })

  it('rejects a recycled pid: alive, but started long after that session did', async () => {
    const starts = await processStartTimes([process.pid])
    expect(isLive(proc({ startedAt: new Date(Date.now() - 86_400_000).toISOString() }), starts)).toBe(false)
  })

  it('falls back to kill(pid,0) when ps told us nothing', () => {
    expect(isLive(proc(), new Map())).toBe(true)
  })
})

describe('SessionsRegistry', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mc-sessions-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports nothing and does not throw when the directory does not exist', async () => {
    const reg = new SessionsRegistry(join(dir, 'nope'))
    expect(await reg.refresh()).toEqual([])
  })

  it('reports nothing for an empty directory', async () => {
    const reg = new SessionsRegistry(dir)
    expect(await reg.refresh()).toEqual([])
  })

  it('picks up a live session and ignores key files and garbage', async () => {
    await writeFile(join(dir, `${process.pid}.json`), JSON.stringify({
      pid: process.pid, sessionId: 'live-one', cwd: '/tmp/x', name: 'x', status: 'waiting',
      startedAt: Date.now(),
    }))
    await writeFile(join(dir, `${process.pid}.abc.key`), 'SECRET')
    await writeFile(join(dir, '999999999.json'), '{ truncated')
    await mkdir(join(dir, 'a-directory.json'))

    const live = await new SessionsRegistry(dir).refresh()
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ sessionId: 'live-one', state: 'waiting' })
  })

  it('drops an entry whose process has died', async () => {
    await writeFile(join(dir, '4194304.json'), JSON.stringify({
      pid: 4194304, sessionId: 'ghost', startedAt: Date.now(),
    }))
    expect(await new SessionsRegistry(dir).refresh()).toEqual([])
  })

  it('emits change when a session file appears', async () => {
    const reg = new SessionsRegistry(dir)
    await reg.start()
    try {
      const seen = new Promise<LiveProcess[]>(resolve => reg.once('change', resolve))
      await writeFile(join(dir, `${process.pid}.json`), JSON.stringify({
        pid: process.pid, sessionId: 'appeared', startedAt: Date.now(),
      }))
      const live = await seen
      expect(live.map(p => p.sessionId)).toContain('appeared')
      expect(reg.list().map(p => p.sessionId)).toContain('appeared')
    } finally {
      await reg.stop()
    }
  }, 10_000)
})
