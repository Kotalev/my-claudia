import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectRecord, ScheduleJob } from '../../../shared/types.js'
import type { ProjectRegistry } from '../../registry.js'
import { EventEmitter } from 'node:events'
import { DISABLED_HISTORY } from '../../history/db.js'
import { Scheduler } from '../../scheduler/index.js'
import { LoopController } from '../../scheduler/loop.js'
import { registerScheduleRoutes } from '../schedules.js'

const TASKS = '# Tasks\n\n## Todo\n\n- [ ] **T-001** First thing\n\n## In progress\n\n## Done\n\n## Progress log\n'

describe('schedule routes', () => {
  let app: FastifyInstance
  let scheduler: Scheduler
  let loops: LoopController

  beforeEach(async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'mc-sched-'))
    await writeFile(join(projectPath, 'TASKS.md'), TASKS)
    const project: ProjectRecord = {
      id: 'p1', path: projectPath, name: 'p1', escapedDir: '-tmp-p1', addedAt: '2026-01-01T00:00:00Z',
    }
    const registry = { byId: (id: string) => (id === project.id ? project : undefined) } as unknown as ProjectRegistry
    scheduler = new Scheduler(DISABLED_HISTORY)
    scheduler.start()
    loops = new LoopController(
      scheduler,
      Object.assign(new EventEmitter(), { finishInput: () => {} }),
      new EventEmitter(),
    )
    app = Fastify()
    registerScheduleRoutes(app, registry, scheduler, loops)
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

  it('a repeatEveryMs makes the schedule a loop: loopId set, iteration 1, limits carried', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule',
      payload: { at: FUTURE, repeatEveryMs: 3_600_000, maxIterations: 5, stopAfterFailures: 2 },
    })
    expect(res.statusCode).toBe(200)
    const { schedule } = res.json() as { schedule: ScheduleJob }
    expect(schedule.repeatEveryMs).toBe(3_600_000)
    expect(schedule.loopId).toEqual(expect.any(String))
    expect(schedule.iteration).toBe(1)
    expect(schedule.maxIterations).toBe(5)
    expect(schedule.stopAfterFailures).toBe(2)
  })

  it('without repeatEveryMs the schedule stays a one-shot', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload: { at: FUTURE },
    })
    const { schedule } = res.json() as { schedule: ScheduleJob }
    expect(schedule.repeatEveryMs).toBeNull()
    expect(schedule.loopId).toBeNull()
  })

  it('400s bad loop fields without creating anything', async () => {
    const payloads = [
      { at: FUTURE, repeatEveryMs: 59_999 },              // under the 60s floor
      { at: FUTURE, repeatEveryMs: 'hourly' },            // wrong type
      { at: FUTURE, repeatEveryMs: 90_000.5 },            // not an integer
      { at: FUTURE, repeatEveryMs: 60_000, maxIterations: 0 },
      { at: FUTURE, repeatEveryMs: 60_000, stopAfterFailures: 0 },
      { at: FUTURE, maxIterations: 3 },                   // limits without a cadence
      { at: FUTURE, stopAfterFailures: 3 },
    ]
    for (const payload of payloads) {
      const res = await app.inject({ method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule', payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(scheduler.list()).toEqual([])
  })

  it('lists stopped loops beside the pending schedules', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/schedules' })
    expect((empty.json() as { stoppedLoops: unknown[] }).stoppedLoops).toEqual([])

    const created = await app.inject({
      method: 'POST', url: '/api/projects/p1/tasks/T-001/schedule',
      payload: { at: FUTURE, repeatEveryMs: 60_000 },
    })
    const { schedule } = created.json() as { schedule: ScheduleJob }
    loops.abort(schedule, 'task T-001 no longer exists')

    const res = await app.inject({ method: 'GET', url: '/api/schedules' })
    const body = res.json() as { stoppedLoops: { loopId: string; note: string }[] }
    expect(body.stoppedLoops).toHaveLength(1)
    expect(body.stoppedLoops[0]).toMatchObject({ loopId: schedule.loopId, note: 'task T-001 no longer exists' })
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
