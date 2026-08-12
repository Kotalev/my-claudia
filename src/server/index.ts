import Fastify, { type FastifyInstance } from 'fastify'
import { HOST, PORT } from '../shared/config.js'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } })
  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))
  return app
}

// Only listen when run directly, so tests can import buildServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ host: HOST, port: PORT })
}
