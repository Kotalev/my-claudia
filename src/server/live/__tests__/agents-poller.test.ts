import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { parseAgentsJson, mergeLive, AgentsPoller, isFresh, MAX_AGENT_AGE_MS } from '../agents-poller.js'
import type { LiveProcess } from '../../../shared/types.js'

const FAKE = fileURLToPath(new URL('../../../../test/fixtures/fake-agents.mjs', import.meta.url))

describe('parseAgentsJson', () => {
  it('reads a background agent, which has no pid', () => {
    const [a] = parseAgentsJson(JSON.stringify([{
      id: 'fc039f19', cwd: '/Users/dev/Projects/pable', kind: 'background',
      startedAt: Date.now() - 3_600_000, sessionId: 'fc039f19-e199', name: 'mobile-prp', state: 'blocked',
    }]))
    expect(a).toMatchObject({
      sessionId: 'fc039f19-e199', pid: null, kind: 'background',
      cwd: '/Users/dev/Projects/pable', name: 'mobile-prp', state: 'blocked',
    })
  })

  it('reads an interactive entry and its busy status', () => {
    const [a] = parseAgentsJson(JSON.stringify([{
      pid: 10478, kind: 'interactive', sessionId: 's', status: 'busy', startedAt: 1,
    }]))
    expect(a).toMatchObject({ pid: 10478, kind: 'interactive', state: 'busy' })
  })

  it('degrades to an empty list for anything that is not an array of objects', () => {
    expect(parseAgentsJson('')).toEqual([])
    expect(parseAgentsJson('not json')).toEqual([])
    expect(parseAgentsJson('{"agents":[]}')).toEqual([])
    expect(parseAgentsJson('null')).toEqual([])
    expect(parseAgentsJson('[null, 3, "x"]')).toEqual([])
  })

  it('skips only the unusable entry, not the whole poll', () => {
    const out = parseAgentsJson(JSON.stringify([{ kind: 'background' }, { sessionId: 'good' }]))
    expect(out.map(a => a.sessionId)).toEqual(['good'])
  })

  it('treats an unknown kind as interactive and an unknown state as no status', () => {
    const [a] = parseAgentsJson(JSON.stringify([{ sessionId: 's', kind: 'something-new', state: 'ruminating' }]))
    expect(a).toMatchObject({ kind: 'interactive', state: null })
  })

  it('handles an empty list', () => {
    expect(parseAgentsJson('[]')).toEqual([])
  })
})

function proc(over: Partial<LiveProcess>): LiveProcess {
  return {
    sessionId: 's', pid: null, cwd: null, name: null, kind: 'interactive', entrypoint: null,
    version: null, startedAt: new Date(0).toISOString(), state: 'idle', waitingFor: null, statusUpdatedAt: null, ...over,
  }
}

describe('mergeLive', () => {
  it('keeps background agents, which the registry cannot see at all', () => {
    const merged = mergeLive([], [proc({ sessionId: 'bg', kind: 'background' })])
    expect(merged.map(p => p.sessionId)).toEqual(['bg'])
  })

  it('prefers the registry entry, which knows the version and was liveness-checked', () => {
    const merged = mergeLive(
      [proc({ sessionId: 'dup', version: '2.1.228', state: 'waiting' })],
      [proc({ sessionId: 'dup', version: null, state: 'busy' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ version: '2.1.228', state: 'waiting' })
  })

  it('is empty when nothing is live', () => {
    expect(mergeLive([], [])).toEqual([])
  })
})

describe('AgentsPoller', () => {
  it('polls a real subprocess and parses its output', async () => {
    const poller = new AgentsPoller(FAKE)
    const agents = await poller.poll()
    expect(agents.map(a => a.kind).sort()).toEqual(['background', 'interactive'])
    expect(poller.list()).toHaveLength(2)
  })

  it('keeps the last good answer when the binary starts failing', async () => {
    const poller = new AgentsPoller(FAKE)
    await poller.poll()
    process.env.FAKE_AGENTS_MODE = 'crash'
    try {
      expect(await poller.poll()).toHaveLength(2)
    } finally {
      delete process.env.FAKE_AGENTS_MODE
    }
  })

  it('reports nothing rather than throwing when the binary does not exist', async () => {
    const poller = new AgentsPoller('/nonexistent/claude-binary')
    expect(await poller.poll()).toEqual([])
  })

  it('reports nothing when the output is not json', async () => {
    process.env.FAKE_AGENTS_MODE = 'garbage'
    try {
      expect(await new AgentsPoller(FAKE).poll()).toEqual([])
    } finally {
      delete process.env.FAKE_AGENTS_MODE
    }
  })
})

describe('AgentsPoller — when the binary stops answering', () => {
  it('gives up on the last good answer rather than pinning finished agents forever', async () => {
    const poller = new AgentsPoller(FAKE)
    expect(await poller.poll()).toHaveLength(2)
    process.env.FAKE_AGENTS_MODE = 'crash'
    try {
      expect(await poller.poll()).toHaveLength(2)   // ride out one hiccup
      expect(await poller.poll()).toHaveLength(2)
      expect(await poller.poll()).toEqual([])       // three in a row: admit we do not know
      expect(poller.list()).toEqual([])
    } finally {
      delete process.env.FAKE_AGENTS_MODE
    }
  })

  it('recovers once the binary answers again', async () => {
    const poller = new AgentsPoller(FAKE)
    process.env.FAKE_AGENTS_MODE = 'crash'
    try {
      for (let i = 0; i < 4; i++) await poller.poll()
    } finally {
      delete process.env.FAKE_AGENTS_MODE
    }
    expect(await poller.poll()).toHaveLength(2)
  })

  it('does not leave an interval running when stopped mid-poll', async () => {
    const poller = new AgentsPoller(FAKE)
    const starting = poller.start()
    poller.stop()
    await starting
    // A leaked interval would keep shelling out to `claude` for the process lifetime.
    expect(poller.pollingStarted()).toBe(false)
  })
})

describe('isFresh — abandoned background agents', () => {
  const NOW = Date.parse('2026-08-12T12:00:00.000Z')
  const bg = (startedAt: string | null) =>
    proc({ kind: 'background', pid: null, startedAt })

  it('drops a background agent blocked for months', () => {
    // Nobody is going to answer it; it is litter, not a live process.
    expect(isFresh(bg('2026-05-24T09:00:00.000Z'), NOW)).toBe(false)
    expect(isFresh(bg('2026-07-22T09:00:00.000Z'), NOW)).toBe(false)
  })

  it('keeps a background agent from today', () => {
    expect(isFresh(bg('2026-08-12T09:00:00.000Z'), NOW)).toBe(true)
  })

  it('keeps one right on the boundary', () => {
    expect(isFresh(bg(new Date(NOW - MAX_AGENT_AGE_MS + 1000).toISOString()), NOW)).toBe(true)
    expect(isFresh(bg(new Date(NOW - MAX_AGENT_AGE_MS - 1000).toISOString()), NOW)).toBe(false)
  })

  it('never ages out an interactive process, whose pid already proves it is alive', () => {
    expect(isFresh(proc({ kind: 'interactive', pid: 10478, startedAt: '2025-01-01T00:00:00.000Z' }), NOW)).toBe(true)
  })

  it('keeps an entry with no start time rather than guessing it is stale', () => {
    expect(isFresh(bg(null), NOW)).toBe(true)
  })

  it('filters them out of the parsed list', () => {
    const raw = JSON.stringify([
      { sessionId: 'old', kind: 'background', startedAt: Date.parse('2026-05-24T09:00:00.000Z'), state: 'blocked' },
      { sessionId: 'new', kind: 'background', startedAt: Date.parse('2026-08-12T09:00:00.000Z'), state: 'blocked' },
    ])
    expect(parseAgentsJson(raw, NOW).map(a => a.sessionId)).toEqual(['new'])
  })
})
