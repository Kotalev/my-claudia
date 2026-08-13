import type { FastifyInstance } from 'fastify'
import type { ProjectRegistry } from '../registry.js'
import type { DispatchQueue } from '../dispatcher/queue.js'
import type { InterruptedRunStore } from '../dispatcher/interrupted.js'

/**
 * Runs a previous server process abandoned. Resume continues the session in
 * place (`--resume`) when a session id was seen; a run that died nameless is
 * re-dispatched from its original prompt instead — new run, same work.
 */
export function registerInterruptedRoutes(
  app: FastifyInstance,
  registry: ProjectRegistry,
  store: InterruptedRunStore,
  queue: DispatchQueue,
  onChanged: () => void,
): void {
  app.get('/api/interrupted', async () => ({ interrupted: store.list() }))

  app.post<{ Params: { runId: string }; Body: { text?: unknown } | null }>(
    '/api/interrupted/:runId/resume', async (req, reply) => {
      const entry = store.list().find(r => r.runId === req.params.runId)
      if (!entry) return reply.code(404).send({ error: 'unknown interrupted run' })
      const project = registry.byId(entry.projectId)
      if (!project) return reply.code(404).send({ error: 'the run\'s project is no longer registered' })

      const text = req.body?.text
      if (text !== undefined && (typeof text !== 'string' || text.trim() === '')) {
        return reply.code(400).send({ error: 'text must be a non-empty string when given' })
      }

      try {
        const started = entry.sessionId !== null
          ? await queue.start({
              projectId: project.id, projectPath: project.path, taskId: null,
              prompt: typeof text === 'string' ? text : 'continue',
              kind: 'resume', resumeSessionId: entry.sessionId,
            })
          : await queue.start({
              // No session id ever reached the mirror: nothing to --resume, so
              // replay the original prompt as a fresh run of the same kind.
              projectId: project.id, projectPath: project.path, taskId: entry.taskId,
              prompt: entry.prompt, kind: entry.kind === 'resume' ? 'prompt' : entry.kind,
            })
        store.removeLeftover(entry.runId)
        onChanged()
        return started
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message })
      }
    })

  app.post<{ Params: { runId: string } }>(
    '/api/interrupted/:runId/dismiss', async (req, reply) => {
      if (!store.removeLeftover(req.params.runId)) {
        return reply.code(404).send({ error: 'unknown interrupted run' })
      }
      onChanged()
      return { ok: true }
    })
}
