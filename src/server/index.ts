import Fastify, { type FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { HOST, PORT } from '../shared/config.js'
import { ProjectRegistry } from './registry.js'
import { registerProjectRoutes } from './routes/projects.js'

declare module 'fastify' {
  interface FastifyInstance { registry: ProjectRegistry }
}

export async function buildServer(
  storePath = join(process.cwd(), 'projects.json'),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } })
  const registry = new ProjectRegistry(storePath)
  await registry.load()

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  registerProjectRoutes(app, registry)
  app.decorate('registry', registry)
  return app
}

// Only listen when run directly, so tests can import buildServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
}
