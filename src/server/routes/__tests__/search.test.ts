import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../index.js'
import { searchSessions, MAX_RESULTS, type SearchableSession } from '../search.js'
import type { TranscriptEntry } from '../../../transcript/types.js'

function entry(overrides: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    uuid: 'u', parentUuid: null, sessionId: 's', timestamp: '2026-08-12T10:00:00Z',
    role: 'user', isSidechain: false, cwd: null, gitBranch: null, version: null,
    text: null, toolCalls: [], isMeta: false, messageId: null, requestId: null,
    model: null, usage: null, effort: null, isApiError: false,
    isCompactBoundary: false, compact: null, isHumanPrompt: false,
    ...overrides,
  }
}

function session(id: string, entries: TranscriptEntry[]): SearchableSession {
  return { sessionId: id, projectId: 'p1', projectLabel: 'my-project', entries }
}

describe('searchSessions', () => {
  it('finds a match and returns a snippet with surrounding context', () => {
    const long = 'a'.repeat(100) + ' the chokidar watcher fired here ' + 'b'.repeat(100)
    const hits = searchSessions([session('s1', [entry({ text: long, role: 'assistant' })])], 'chokidar')
    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    expect(hit.sessionId).toBe('s1')
    expect(hit.projectId).toBe('p1')
    expect(hit.projectLabel).toBe('my-project')
    expect(hit.role).toBe('assistant')
    expect(hit.timestamp).toBe('2026-08-12T10:00:00Z')
    expect(hit.snippet).toContain('chokidar')
    // Truncated on both sides, marked as such.
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet.length).toBeLessThan(long.length)
  })

  it('matches case-insensitively in both query and text', () => {
    const s = session('s1', [entry({ text: 'Deployed the WATCHER today' })])
    expect(searchSessions([s], 'watcher')).toHaveLength(1)
    expect(searchSessions([s], 'DEPLOYED')).toHaveLength(1)
  })

  it('keeps a short text intact with no ellipses', () => {
    const hits = searchSessions([session('s1', [entry({ text: 'fix the bug' })])], 'bug')
    expect(hits[0]!.snippet).toBe('fix the bug')
  })

  it('collapses newlines so the snippet renders on one line', () => {
    const hits = searchSessions([session('s1', [entry({ text: 'first\nsecond\tmatch here' })])], 'match')
    expect(hits[0]!.snippet).toBe('first second match here')
  })

  it('caps results at MAX_RESULTS across sessions', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry({ uuid: `u${i}`, text: 'needle in text' }))
    const hits = searchSessions([session('s1', many), session('s2', many)], 'needle')
    expect(hits).toHaveLength(MAX_RESULTS)
  })

  it('skips malformed entries without throwing', () => {
    const malformed = [
      null,
      42,
      {},
      { text: 12345, timestamp: '2026-01-01T00:00:00Z' },
      { text: 'needle but no timestamp', timestamp: null },
    ] as unknown as TranscriptEntry[]
    const good = entry({ text: 'a real needle' })
    const hits = searchSessions([session('s1', [...malformed, good])], 'needle')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.snippet).toBe('a real needle')
  })

  it('tolerates a session whose entries are not an array', () => {
    const broken = { sessionId: 'sX', projectId: null, projectLabel: 'x', entries: null } as unknown as SearchableSession
    expect(searchSessions([broken], 'needle')).toEqual([])
  })

  it('returns [] for queries shorter than 2 chars, including after trimming', () => {
    const s = session('s1', [entry({ text: 'anything at all' })])
    expect(searchSessions([s], '')).toEqual([])
    expect(searchSessions([s], 'a')).toEqual([])
    expect(searchSessions([s], '  a  ')).toEqual([])
  })

  it('returns [] on no sessions', () => {
    expect(searchSessions([], 'needle')).toEqual([])
  })
})

describe('GET /api/search', () => {
  let app: FastifyInstance
  let token: string
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-search-'))
    // Keep the watcher and sessions registry off the real Claude data dir.
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
    await mkdir(join(dir, 'claude', 'projects'), { recursive: true })
    app = await buildServer(join(dir, 'projects.json'), join(dir, '.auth-token'),
      { worktreesRoot: join(dir, '.worktrees'), historyDbPath: join(dir, 'mc.db') })
    token = app.authToken
  })

  afterAll(async () => {
    await app.close()
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  })

  it('rejects a request with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=hello' })
    expect(res.statusCode).toBe(401)
  })

  it('answers with an empty match list for a short query', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/search?q=a',
      headers: { 'x-auth-token': token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ matches: [] })
  })

  it('answers the shape even with no query at all', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/search',
      headers: { 'x-auth-token': token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ matches: [] })
  })

  it('finds text from a session fed into the store', async () => {
    app.store.apply('11111111-aaaa-bbbb-cccc-000000000001', [
      entry({
        uuid: 'e1', sessionId: '11111111-aaaa-bbbb-cccc-000000000001',
        text: 'please refactor the dispatcher queue', isHumanPrompt: true,
      }),
    ], { parsed: 1, skippedUnknown: 0, skippedBookkeeping: 0, skippedInvalid: 0, versions: [] }, null)

    const res = await app.inject({
      method: 'GET', url: '/api/search?q=dispatcher%20queue',
      headers: { 'x-auth-token': token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].sessionId).toBe('11111111-aaaa-bbbb-cccc-000000000001')
    expect(body.matches[0].snippet).toContain('dispatcher queue')
    // No registered project and no cwd on the entry: the label falls back.
    expect(body.matches[0].projectLabel).toBe('unregistered')
  })
})
