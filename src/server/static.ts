import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The built frontend, resolved relative to this module so the compiled copy in dist/ finds it too. */
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url))

/**
 * Serve the built UI so one process on one port is the whole dashboard.
 * Inert when web/dist has no build (dev: Vite owns the UI and proxies here).
 * Registered after the API routes, so /api and /ws keep priority; unknown
 * non-API paths fall through to index.html for the SPA router.
 */
export async function registerStatic(app: FastifyInstance, root = DEFAULT_WEB_DIST): Promise<void> {
  if (!existsSync(join(root, 'index.html'))) return
  await app.register(fastifyStatic, { root })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' })
    }
    return reply.sendFile('index.html')
  })
}
