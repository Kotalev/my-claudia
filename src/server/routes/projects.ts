import type { FastifyInstance } from 'fastify'
import type { ProjectRegistry } from '../registry.js'

export function registerProjectRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  onChanged: () => Promise<void>,
): void {
  app.get('/api/projects', async () => ({ projects: registry.list() }))

  app.post<{ Body: { path?: string } }>('/api/projects', async (req, reply) => {
    const path = req.body?.path
    if (typeof path !== 'string' || path.length === 0) {
      return reply.code(400).send({ error: 'path is required' })
    }
    try {
      const project = await registry.add(path)
      await onChanged()   // the new project's TASKS.md must be watched too
      return { project }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  // Registrations outlive the directories they point at: a project can be moved,
  // deleted, or have been a scratch directory in the first place. Removal is
  // manual on purpose — a path that is merely unreachable right now, on an
  // unmounted volume, must not silently lose its registration.
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const removed = await registry.remove(req.params.id)
    if (!removed) return reply.code(404).send({ error: 'no such project' })
    await onChanged()   // stop watching its TASKS.md, and tell open tabs it is gone
    return { removed: req.params.id }
  })
}
