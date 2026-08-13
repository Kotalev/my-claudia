import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { loadOrCreateToken, tokenMatches } from '../auth.js'
import { buildServer } from '../index.js'

describe('loadOrCreateToken', () => {
  it('creates a token file readable only by its owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-auth-'))
    const path = join(dir, '.auth-token')
    const token = await loadOrCreateToken(path)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('returns the same token across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-auth-'))
    const path = join(dir, '.auth-token')
    const first = await loadOrCreateToken(path)
    expect(await loadOrCreateToken(path)).toBe(first)
  })
})

describe('tokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abd', 'abc')).toBe(false)
    expect(tokenMatches('ab', 'abc')).toBe(false)
    expect(tokenMatches('', 'abc')).toBe(false)
    expect(tokenMatches(undefined, 'abc')).toBe(false)
  })
})

describe('API token requirement', () => {
  let app: FastifyInstance
  let token: string
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-auth-srv-'))
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

  it('rejects an API request with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: { 'x-auth-token': 'not-the-token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('accepts the token in a header', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: { 'x-auth-token': token },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts the token as a query parameter (the WebSocket path)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/projects?token=${token}`,
    })
    expect(res.statusCode).toBe(200)
  })

  it('leaves the hook sink open — forwarder curl carries no token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/hooks',
      payload: { anything: true },
    })
    expect(res.statusCode).toBe(200)
  })

  it('leaves the permission sink open — its forwarder carries no token either', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/hooks/permission',
      payload: { anything: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({})
  })

  it('requires the token on the permission decision endpoint', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/permissions/some-id/decision',
      payload: { behavior: 'allow' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('lets a tokened decision through the guard (404: unknown id, not 401)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/permissions/some-id/decision',
      headers: { 'x-auth-token': token },
      payload: { behavior: 'allow' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('leaves the statusline sink open', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/statusline',
      payload: { anything: true },
    })
    expect(res.statusCode).toBe(200)
  })

  it('leaves health open', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})
