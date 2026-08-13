import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../index.js'

describe('GET /api/export', () => {
  let app: FastifyInstance
  let token: string
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-export-'))
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
    const res = await app.inject({ method: 'GET', url: '/api/export' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the export document as an attachment', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/export',
      headers: { 'x-auth-token': token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="mission-control-export.json"')
    const body = res.json()
    expect(new Date(body.exportedAt).getTime()).not.toBeNaN()
    expect(Array.isArray(body.projects)).toBe(true)
    expect(Array.isArray(body.sessions)).toBe(true)
    // The spend summary mirrors what the snapshot carries — an empty ledger
    // still yields the shape, not an absence.
    expect(body.spend).toBeTypeOf('object')
    expect(body.spend).not.toBeNull()
  })
})
