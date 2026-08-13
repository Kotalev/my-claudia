import { describe, it, expect, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptTemplate } from '../../../shared/types.js'
import { DISABLED_HISTORY, openHistoryDb, type HistoryDb } from '../../history/db.js'
import { registerTemplateRoutes } from '../templates.js'

async function makeApp(history: HistoryDb): Promise<FastifyInstance> {
  const app = Fastify()
  registerTemplateRoutes(app, history)
  await app.ready()
  return app
}

describe('template routes', () => {
  let db: HistoryDb | null = null
  let app: FastifyInstance | null = null

  afterEach(async () => {
    await app?.close()
    db?.close()
    app = null
    db = null
    vi.restoreAllMocks()
  })

  async function sqliteApp(): Promise<FastifyInstance> {
    const dir = await mkdtemp(join(tmpdir(), 'mc-templates-'))
    db = await openHistoryDb(join(dir, 'history.db'))
    expect(db.enabled).toBe(true)
    app = await makeApp(db)
    return app
  }

  it('creates, lists (by name) and deletes templates', async () => {
    const app = await sqliteApp()
    const b = await app.inject({ method: 'POST', url: '/api/templates', payload: { name: 'beta', text: 'do b' } })
    const a = await app.inject({ method: 'POST', url: '/api/templates', payload: { name: 'alpha', text: 'do a' } })
    expect(b.statusCode).toBe(200)
    expect(a.statusCode).toBe(200)
    const { template } = a.json() as { template: PromptTemplate }
    expect(template.name).toBe('alpha')
    expect(template.text).toBe('do a')

    const list = await app.inject({ method: 'GET', url: '/api/templates' })
    const { templates } = list.json() as { templates: PromptTemplate[] }
    expect(templates.map(t => t.name)).toEqual(['alpha', 'beta'])

    const gone = await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}` })
    expect(gone.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: '/api/templates' })
    expect((after.json() as { templates: PromptTemplate[] }).templates.map(t => t.name)).toEqual(['beta'])
  })

  it('400s a missing, empty or non-string name or text', async () => {
    const app = await sqliteApp()
    for (const payload of [
      {}, { name: 'x' }, { text: 'y' },
      { name: '   ', text: 'y' }, { name: 'x', text: '' },
      { name: 42, text: 'y' }, { name: 'x', text: ['not', 'a', 'string'] },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/templates', payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    const list = await app.inject({ method: 'GET', url: '/api/templates' })
    expect((list.json() as { templates: PromptTemplate[] }).templates).toEqual([])
  })

  it('404s deleting an unknown template', async () => {
    const app = await sqliteApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/templates/no-such-id' })
    expect(res.statusCode).toBe(404)
  })

  it('persists across a restart when SQLite is available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-templates-'))
    const first = await openHistoryDb(join(dir, 'history.db'))
    const firstApp = await makeApp(first)
    await firstApp.inject({ method: 'POST', url: '/api/templates', payload: { name: 'kept', text: 'still here' } })
    await firstApp.close()
    first.close()

    db = await openHistoryDb(join(dir, 'history.db'))
    app = await makeApp(db)
    const list = await app.inject({ method: 'GET', url: '/api/templates' })
    const { templates } = list.json() as { templates: PromptTemplate[] }
    expect(templates.map(t => t.name)).toEqual(['kept'])
    expect(templates[0]?.text).toBe('still here')
  })

  it('works fully in memory on the disabled history handle', async () => {
    app = await makeApp(DISABLED_HISTORY)
    const created = await app.inject({ method: 'POST', url: '/api/templates', payload: { name: 'ephemeral', text: 'gone on restart' } })
    expect(created.statusCode).toBe(200)
    const { template } = created.json() as { template: PromptTemplate }

    const list = await app.inject({ method: 'GET', url: '/api/templates' })
    expect((list.json() as { templates: PromptTemplate[] }).templates).toHaveLength(1)

    const gone = await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}` })
    expect(gone.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/templates' })).json()).toEqual({ templates: [] })
  })
})
