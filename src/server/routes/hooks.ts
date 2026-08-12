import type { FastifyInstance } from 'fastify'
import { applyHookEvent, normalizeHookEvent } from '../hooks/ingest.js'
import type { ProjectRegistry } from '../registry.js'
import type { SessionStore } from '../watcher/session-store.js'
import type { SessionSummary } from '../../shared/types.js'

export function registerHookRoutes(
  app: FastifyInstance,
  store: SessionStore,
  registry: ProjectRegistry,
  onSession: (summary: SessionSummary) => void,
): void {
  // Always 200, even on garbage. A hook must never see an error that could slow
  // down or break the user's Claude Code session.
  app.post('/api/hooks', async (req, reply) => {
    const event = normalizeHookEvent(req.body)
    if (!event) return reply.code(200).send({ ok: false })
    const summary = applyHookEvent(store, registry, event)
    if (summary) onSession(summary)
    return { ok: true }
  })
}
