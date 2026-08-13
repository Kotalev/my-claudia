import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerHistoryRoutes } from '../history.js'
import { openHistoryDb, DISABLED_HISTORY, localDay, type HistoryDb } from '../../history/db.js'

describe('history routes', () => {
  describe('with a live db', () => {
    let app: FastifyInstance
    let db: HistoryDb

    beforeAll(async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mc-history-routes-'))
      db = await openHistoryDb(join(dir, 'history.db'))
      expect(db.enabled).toBe(true)
      db.upsertRun({
        runId: 'run-1', projectId: 'p1', taskId: 'T-001', sessionId: null,
        status: 'succeeded', isolation: 'worktree', branch: 'mc/run-1',
        merged: true, discarded: false,
        startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:05:00.000Z',
        costUsd: 0.5, numTurns: 3, exitCode: 0,
      })
      db.upsertRun({
        runId: 'run-2', projectId: 'p2', taskId: 'T-002', sessionId: null,
        status: 'failed', isolation: 'in-place', branch: null,
        merged: false, discarded: false,
        startedAt: '2026-08-13T11:00:00.000Z', endedAt: '2026-08-13T11:01:00.000Z',
        costUsd: null, numTurns: null, exitCode: 1,
      })
      db.upsertSpendDay({ day: localDay(new Date()), costUsd: 2.5, updatedAt: new Date().toISOString() })
      db.upsertSpendDay({ day: '1999-12-31', costUsd: 99, updatedAt: '1999-12-31T23:59:59Z' })
      app = Fastify()
      registerHistoryRoutes(app, db)
      await app.ready()
    })

    afterAll(async () => {
      await app.close()
      db.close()
    })

    it('lists runs newest first', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/history/runs' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.disabled).toBe(false)
      expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual(['run-2', 'run-1'])
    })

    it('filters by projectId and honours limit', async () => {
      const byProject = await app.inject({ method: 'GET', url: '/api/history/runs?projectId=p1' })
      expect(byProject.json().runs.map((r: { runId: string }) => r.runId)).toEqual(['run-1'])
      const limited = await app.inject({ method: 'GET', url: '/api/history/runs?limit=1' })
      expect(limited.json().runs).toHaveLength(1)
    })

    it('falls back to the default limit on a garbage limit', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/history/runs?limit=banana' })
      expect(res.statusCode).toBe(200)
      expect(res.json().runs).toHaveLength(2)
    })

    it('answers spend days inside the window only', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/history/spend?days=90' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.disabled).toBe(false)
      expect(body.days).toHaveLength(1)
      expect(body.days[0].costUsd).toBe(2.5)
    })

    it('falls back to 90 days on a garbage days param', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/history/spend?days=-3' })
      expect(res.statusCode).toBe(200)
      expect(res.json().days).toHaveLength(1)
    })
  })

  describe('with history disabled (Node 20 path)', () => {
    let app: FastifyInstance

    beforeAll(async () => {
      app = Fastify()
      registerHistoryRoutes(app, DISABLED_HISTORY)
      await app.ready()
    })

    afterAll(async () => {
      await app.close()
    })

    it('still answers 200 with disabled and empty runs', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/history/runs' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ disabled: true, runs: [] })
    })

    it('still answers 200 with disabled and empty spend days', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/history/spend' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ disabled: true, days: [] })
    })
  })
})
