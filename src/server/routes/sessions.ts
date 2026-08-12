import type { FastifyInstance } from 'fastify'
import type { SessionStore } from '../watcher/session-store.js'
import type { ProjectRegistry } from '../registry.js'

export function registerSessionRoutes(
  app: FastifyInstance, store: SessionStore, registry: ProjectRegistry,
): void {
  app.get('/api/sessions', async () => ({ sessions: store.all() }))

  app.get<{ Params: { id: string } }>('/api/projects/:id/sessions', async (req, reply) => {
    const project = registry.byId(req.params.id)
    if (!project) return reply.code(404).send({ error: 'unknown project' })
    return { sessions: store.all().filter(s => s.projectId === project.id) }
  })

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (req, reply) => {
    const summary = store.get(req.params.sessionId)
    if (!summary) return reply.code(404).send({ error: 'unknown session' })
    return { summary, entries: store.entries(req.params.sessionId) }
  })
}
