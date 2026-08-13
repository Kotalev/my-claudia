import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord, ScheduleJob } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import { DISABLED_HISTORY } from '../../history/db.js'
import { Scheduler } from '../../scheduler/index.js'
import { registerScheduleRoutes } from '../schedules.js'

const TASKS = '# Tasks\n\n## Todo\n\n- [ ] **T-001** First thing\n\n## In progress\n\n## Done\n\n## Progress log\n'

describe('schedule routes', () => {
  let app: FastifyInstance
  let scheduler: Scheduler

  beforeEach(async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'mc-sched-'))
    await writeFile(join(projectPath, 'TASKS.md'), TASKS)
    const project: ProjectRecord = {
      id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
    }
    const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
    scheduler = new Scheduler(DISABLED_HISTORY)
    scheduler.start()
    app = Fastify()
    registerScheduleRoutes(app, registry, scheduler)
    await app.ready()
  })

  afterEach(async () => {
    scheduler.stop()
    await app.close()
  })

  const FUTURE = new Date(Date.now() + 3_600_000).toISOString()

  it('schedules a task for a future time and lists it', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload: { at: FUTURE },
    })
    expect(res.statusCode).toBe(200)
    const { schedule } = res.json() as { schedule: ScheduleJob }
    expect(schedule.kind).toBe('dispatch-task')
    expect(schedule.taskId).toBe('T-001')
    expect(schedule.runAt).toBe(FUTURE)

    const list = await app.inject({ method: 'GET', url: '/api/schedules' })
    expect((list.json() as { schedules: ScheduleJob[] }).schedules.map(s => s.id)).toEqual([schedule.id])
  })

  it('404s an unknown project and an unknown task', async () => {
    const project = await app.inject({
      method: 'POST', url: '/api/projects/nope/tasks/T-001/schedule', payload: { at: FUTURE },
    })
    expect(project.statusCode).toBe(404)

    const task = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-999/schedule', payload: { at: FUTURE },
    })
    expect(task.statusCode).toBe(404)
  })

  it('400s a past time, a garbage time, and a missing body', async () => {
    const past = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule',
      payload: { at: new Date(Date.now() - 60_000).toISOString() },
    })
    expect(past.statusCode).toBe(400)

    const garbage = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload: { at: 'half past never' },
    })
    expect(garbage.statusCode).toBe(400)

    const wrongType = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload: { at: 12345 },
    })
    expect(wrongType.statusCode).toBe(400)

    const absent = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload: {},
    })
    expect(absent.statusCode).toBe(400)
    expect(scheduler.list()).toEqual([])
  })

  it('cancels a schedule once, then 404s', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload: { at: FUTURE },
    })
    const { schedule } = created.json() as { schedule: ScheduleJob }

    const del = await app.inject({ method: 'DELETE', url: `/api/schedules/${schedule.id}` })
    expect(del.statusCode).toBe(200)
    expect(scheduler.list()).toEqual([])

    const again = await app.inject({ method: 'DELETE', url: `/api/schedules/${schedule.id}` })
    expect(again.statusCode).toBe(404)
  })
})
