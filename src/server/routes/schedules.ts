import type { FastifyInstance } from 'fastify'
import { TaskStore } from '../../tasks/store.js'
import type { ProjectRegistry } from '../registry.js'
import type { Scheduler } from '../scheduler/index.js'

export function registerScheduleRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  scheduler: Scheduler,
): void {
  app.get('/api/schedules', async () => ({ schedules: scheduler.list() }))

  // Schedule a task dispatch for later. The task text is NOT captured here —
  // the fire handler re-reads TASKS.md, so edits made in the meantime count.
  app.post<{ Params: { id: string; taskId: string }; Body: { at?: unknown } | null }>(
    '/api/projects/:id/tasks/:taskId/schedule', async (req, reply) => {
      const project = registry.byId(req.params.id)
      if (!project) return reply.code(404).send({ error: 'unknown project' })

      const doc = await new TaskStore(project.path).read()
      const task = doc.tasks.find(t => t.id === req.params.taskId)
      if (!task) return reply.code(404).send({ error: `unknown task ${req.params.taskId}` })

      const at = req.body?.at
      const time = typeof at === 'string' ? Date.parse(at) : NaN
      if (Number.isNaN(time)) {
        return reply.code(400).send({ error: 'at must be an ISO date-time string' })
      }
      if (time <= Date.now()) {
        return reply.code(400).send({ error: 'at must be in the future' })
      }

      const schedule = scheduler.add({
        kind: 'dispatch-task',
        projectId: project.id,
        taskId: task.id,
        sessionId: null,
        prompt: null,
        runAt: new Date(time).toISOString(),
        note: null,
      })
      return { schedule }
    })

  app.delete<{ Params: { scheduleId: string } }>('/api/schedules/:scheduleId', async (req, reply) => {
    if (!scheduler.cancel(req.params.scheduleId)) {
      return reply.code(404).send({ error: 'unknown schedule' })
    }
    return { ok: true }
  })
}
