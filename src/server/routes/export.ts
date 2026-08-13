import type { FastifyInstance } from 'fastify'
import type { ProjectRegistry } from '../registry.js'
import type { SessionStore } from '../watcher/session-store.js'
import type { SpendLedger } from '../usage/spend-ledger.js'

export function registerExportRoutes(
  app: FastifyInstance, registry: ProjectRegistry, store: SessionStore, spendLedger: SpendLedger,
): void {
  // A plain assembly of what the other routes already serve, shaped as a
  // downloadable document rather than a live view.
  app.get('/api/export', async (_req, reply) => {
    reply.header('content-disposition', 'attachment; filename="mission-control-export.json"')
    return {
      exportedAt: new Date().toISOString(),
      projects: registry.list(),
      sessions: store.all(),
      spend: spendLedger.summary(),
    }
  })
}
