import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { TaskStore } from '../../tasks/store.js'
import type { ProjectRegistry } from '../registry.js'
import type { Scheduler } from '../scheduler/index.js'
import type { LoopController } from '../scheduler/loop.js'

/** The smallest loop cadence: anything tighter is a runaway dispatcher. */
const MIN_REPEAT_MS = 60_000

/**
 * Reads an optional positive-integer field with a floor. Absent (undefined or
 * null) answers null; anything present but unusable answers an error string.
 */
function optionalInt(value: unknown, name: string, min: number): { value: number | null } | { error: string } {
  if (value === undefined || value === null) return { value: null }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    return { error: `${name} must be an integer >= ${min}` }
  }
  return { value }
}

export function registerScheduleRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  scheduler: Scheduler,
  loops?: LoopController,
): void {
  // Stopped loops ride along so a loop that ended by itself (max iterations,
  // too many failures) leaves a visible trace rather than just vanishing.
  app.get('/api/schedules', async () => ({
    schedules: scheduler.list(),
    stoppedLoops: loops?.stopped() ?? [],
  }))

  // Schedule a task dispatch for later. The task text is NOT captured here —
  // the fire handler re-reads TASKS.md, so edits made in the meantime count.
  // With `repeatEveryMs` the schedule is a loop: each finished run creates the
  // next iteration's job under the same loopId.
  app.post<{
    Params: { id: string; taskId: string }
    Body: { at?: unknown; repeatEveryMs?: unknown; maxIterations?: unknown; stopAfterFailures?: unknown } | null
  }>(
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

      const repeat = optionalInt(req.body?.repeatEveryMs, 'repeatEveryMs', MIN_REPEAT_MS)
      if ('error' in repeat) return reply.code(400).send({ error: repeat.error })
      const maxIterations = optionalInt(req.body?.maxIterations, 'maxIterations', 1)
      if ('error' in maxIterations) return reply.code(400).send({ error: maxIterations.error })
      const stopAfterFailures = optionalInt(req.body?.stopAfterFailures, 'stopAfterFailures', 1)
      if ('error' in stopAfterFailures) return reply.code(400).send({ error: stopAfterFailures.error })
      if (repeat.value === null && (maxIterations.value !== null || stopAfterFailures.value !== null)) {
        return reply.code(400).send({ error: 'maxIterations and stopAfterFailures need repeatEveryMs' })
      }

      const schedule = scheduler.add({
        kind: 'dispatch-task',
        projectId: project.id,
        taskId: task.id,
        sessionId: null,
        prompt: null,
        runAt: new Date(time).toISOString(),
        note: null,
        repeatEveryMs: repeat.value,
        loopId: repeat.value === null ? null : randomUUID(),
        iteration: 1,
        maxIterations: maxIterations.value,
        stopAfterFailures: stopAfterFailures.value,
      })
      return { schedule }
    })

  // On a loop job this cancels the whole loop: a loop only ever has this one
  // pending job, and nothing recreates it once it is gone.
  app.delete<{ Params: { scheduleId: string } }>('/api/schedules/:scheduleId', async (req, reply) => {
    if (!scheduler.cancel(req.params.scheduleId)) {
      return reply.code(404).send({ error: 'unknown schedule' })
    }
    return { ok: true }
  })
}
