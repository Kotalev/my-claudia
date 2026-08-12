import type { FastifyInstance } from 'fastify'
import { parseStatusline } from '../live/statusline.js'
import type { SessionStore } from '../watcher/session-store.js'
import type { SessionSummary } from '../../shared/types.js'

export function registerStatuslineRoutes(
  app: FastifyInstance,
  store: SessionStore,
  onSession: (summary: SessionSummary) => void,
  onLimits: () => void,
): void {
  // Answers 200 to anything. This runs on every statusline refresh in every
  // session; an error here must never surface in the user's prompt.
  app.post('/api/statusline', async (req, reply) => {
    const report = parseStatusline(req.body)
    if (!report) return reply.code(200).send({ ok: false })
    const summary = store.applyStatusline(report)
    if (summary) onSession(summary)
    if (report.limits) onLimits()
    return { ok: true }
  })
}
