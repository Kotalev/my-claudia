import type { FastifyInstance } from 'fastify'
import { TaskStore } from '../../tasks/store.js'
import type { TaskStatus } from '../../tasks/types.js'
import type { ProjectRegistry } from '../registry.js'

const VALID_STATUS: TaskStatus[] = ['todo', 'in-progress', 'done']

export function registerTaskRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  onChange: (projectId: string) => void,
): void {
  const storeFor = (id: string) => {
    const project = registry.byId(id)
    return project ? new TaskStore(project.path) : null
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (req, reply) => {
    const store = storeFor(req.params.id)
    if (!store) return reply.code(404).send({ error: 'unknown project' })
    return { doc: await store.read() }
  })

  app.post<{ Params: { id: string }; Body: { title?: string; tags?: string[] } }>(
    '/api/projects/:id/tasks', async (req, reply) => {
      const store = storeFor(req.params.id)
      if (!store) return reply.code(404).send({ error: 'unknown project' })
      const title = req.body?.title
      if (typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send({ error: 'title is required' })
      }
      const task = await store.addTask({ title, tags: req.body?.tags ?? [] })
      onChange(req.params.id)
      return { task }
    })

  app.patch<{
    Params: { id: string; taskId: string }
    Body: { status?: string; title?: string; tags?: string[] }
  }>('/api/projects/:id/tasks/:taskId', async (req, reply) => {
    const store = storeFor(req.params.id)
    if (!store) return reply.code(404).send({ error: 'unknown project' })

    const status = req.body?.status
    if (status !== undefined && !VALID_STATUS.includes(status as TaskStatus)) {
      return reply.code(400).send({ error: `status must be one of ${VALID_STATUS.join(', ')}` })
    }

    try {
      const task = await store.updateTask(req.params.taskId, {
        ...(status !== undefined ? { status: status as TaskStatus } : {}),
        ...(req.body?.title !== undefined ? { title: req.body.title } : {}),
        ...(req.body?.tags !== undefined ? { tags: req.body.tags } : {}),
      })
      onChange(req.params.id)
      return { task }
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message })
    }
  })
}
