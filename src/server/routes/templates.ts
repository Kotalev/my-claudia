import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { PromptTemplate } from '../../shared/types.js'
import type { HistoryDb } from '../history/db.js'

/**
 * Saved prompt templates for the "new run" box. The in-memory map is the
 * authority and the history db only its mirror (the scheduler pattern), so a
 * disabled db still gives working templates — they just die with the process.
 */
export function registerTemplateRoutes(app: FastifyInstance, history: HistoryDb): void {
  const templates = new Map<string, PromptTemplate>(
    history.listTemplates().map(t => [t.id, t]),
  )
  const list = (): PromptTemplate[] =>
    [...templates.values()].sort((a, b) => a.name.localeCompare(b.name))

  app.get('/api/templates', async () => ({ templates: list() }))

  app.post<{ Body: { name?: unknown; text?: unknown } | null }>(
    '/api/templates', async (req, reply) => {
      const name = req.body?.name
      const text = req.body?.text
      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name must be a non-empty string' })
      }
      if (typeof text !== 'string' || text.trim() === '') {
        return reply.code(400).send({ error: 'text must be a non-empty string' })
      }
      const template: PromptTemplate = {
        id: randomUUID(),
        name: name.trim(),
        text,
        createdAt: new Date().toISOString(),
      }
      templates.set(template.id, template)
      history.insertTemplate(template)
      return { template }
    })

  app.delete<{ Params: { templateId: string } }>(
    '/api/templates/:templateId', async (req, reply) => {
      if (!templates.delete(req.params.templateId)) {
        return reply.code(404).send({ error: 'unknown template' })
      }
      history.deleteTemplate(req.params.templateId)
      return { ok: true }
    })
}
