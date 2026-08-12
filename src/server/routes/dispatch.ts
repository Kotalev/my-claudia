import type { FastifyInstance } from 'fastify'
import { TaskStore } from '../../tasks/store.js'
import type { ProjectRegistry } from '../registry.js'
import type { Dispatcher } from '../dispatcher/index.js'
import { buildTaskPrompt } from '../dispatcher/prompt.js'

export function registerDispatchRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  dispatcher: Dispatcher,
  onTasksChanged: (projectId: string) => void,
): void {
  app.get('/api/runs', async () => ({ runs: dispatcher.list() }))

  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/dispatch', async (req, reply) => {
      const project = registry.byId(req.params.id)
      if (!project) return reply.code(404).send({ error: 'unknown project' })

      const store = new TaskStore(project.path)
      const doc = await store.read()
      const task = doc.tasks.find(t => t.id === req.params.taskId)
      if (!task) return reply.code(404).send({ error: `unknown task ${req.params.taskId}` })

      try {
        const run = dispatcher.start({
          projectId: project.id,
          projectPath: project.path,
          taskId: task.id,
          prompt: buildTaskPrompt(task),
        })
        // Reflect the run on the board straight away rather than waiting for the
        // agent to get round to editing TASKS.md itself.
        if (task.status === 'todo') {
          await store.updateTask(task.id, { status: 'in-progress' })
          onTasksChanged(project.id)
        }
        return { run }
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message })
      }
    })

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (req, reply) => {
    if (!dispatcher.cancel(req.params.runId)) {
      return reply.code(404).send({ error: 'no live run with that id' })
    }
    return { ok: true }
  })
}
