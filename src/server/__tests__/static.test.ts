import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerStatic } from '../static.js'

async function appWithApi(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.get('/api/health', async () => ({ ok: true }))
  return app
}

describe('registerStatic', () => {
  describe('with a built web/dist', () => {
    let app: FastifyInstance
    let dist: string

    beforeAll(async () => {
      dist = await mkdtemp(join(tmpdir(), 'mc-static-'))
      await writeFile(join(dist, 'index.html'), '<html>mc-shell</html>')
      await mkdir(join(dist, 'assets'))
      await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)')
      app = await appWithApi()
      await registerStatic(app, dist)
    })

    afterAll(async () => { await app.close() })

    it('serves index.html at the root', async () => {
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('mc-shell')
    })

    it('serves a real asset file', async () => {
      const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('console.log(1)')
    })

    it('falls back to index.html for an SPA route', async () => {
      const res = await app.inject({ method: 'GET', url: '/projects/some-id' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('mc-shell')
    })

    it('keeps API routes ahead of the fallback', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })

    it('404s unknown /api and /ws paths instead of serving HTML', async () => {
      for (const url of ['/api/nope', '/ws/extra']) {
        const res = await app.inject({ method: 'GET', url })
        expect(res.statusCode).toBe(404)
        expect(res.json()).toEqual({ error: 'not found' })
      }
    })
  })

  describe('without a build', () => {
    it('is inert when the dist dir does not exist', async () => {
      const app = await appWithApi()
      await registerStatic(app, join(tmpdir(), 'mc-static-does-not-exist'))
      const root = await app.inject({ method: 'GET', url: '/' })
      expect(root.statusCode).toBe(404)
      const api = await app.inject({ method: 'GET', url: '/api/health' })
      expect(api.statusCode).toBe(200)
      await app.close()
    })

    it('is inert when the dir exists but holds no index.html', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'mc-static-empty-'))
      const app = await appWithApi()
      await registerStatic(app, empty)
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })
})
