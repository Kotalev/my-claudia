import type { FastifyInstance } from 'fastify'
import { dayBefore, type HistoryDb } from '../history/db.js'

/**
 * Read side of the persisted history. When SQLite is unavailable (Node 20)
 * both routes still answer 200 with `disabled: true` and empty rows, so the
 * History screen can say "disabled" instead of erroring.
 */
export function registerHistoryRoutes(app: FastifyInstance, history: HistoryDb): void {
  app.get<{ Querystring: { projectId?: string; limit?: string } }>(
    '/api/history/runs', async req => {
      if (!history.enabled) return { disabled: true, runs: [] }
      const parsed = Number(req.query.limit)
      const limit = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 100
      return {
        disabled: false,
        runs: history.listRuns({ projectId: req.query.projectId ?? null, limit }),
      }
    })

  app.get<{ Querystring: { q?: string; projectId?: string; limit?: string } }>(
    '/api/history/search', async req => {
      if (!history.enabled) return { disabled: true, runs: [] }
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const parsed = Number(req.query.limit)
      const limit = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 100
      return {
        disabled: false,
        runs: history.searchRuns(q, { projectId: req.query.projectId ?? null, limit }),
      }
    })

  app.get<{ Querystring: { days?: string } }>('/api/history/spend', async req => {
    if (!history.enabled) return { disabled: true, days: [] }
    const parsed = Number(req.query.days)
    const days = Number.isFinite(parsed) && parsed >= 1 ? Math.min(365, Math.floor(parsed)) : 90
    // `days` counts today, so 90 reaches back 89 calendar days.
    return { disabled: false, days: history.listSpendDays(dayBefore(new Date(), days - 1)) }
  })
}
