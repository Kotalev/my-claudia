import type { FastifyInstance } from 'fastify'
import type { ProjectRegistry } from '../registry.js'

export function registerProjectRoutes(app: FastifyInstance, registry: ProjectRegistry): void {
  app.get('/api/projects', async () => ({ projects: registry.list() }))

  app.post<{ Body: { path?: string } }>('/api/projects', async (req, reply) => {
    const path = req.body?.path
    if (typeof path !== 'string' || path.length === 0) {
      return reply.code(400).send({ error: 'path is required' })
    }
    try {
      return { project: await registry.add(path) }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
}
