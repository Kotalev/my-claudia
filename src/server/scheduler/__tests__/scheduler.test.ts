import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ScheduleJob } from '../../../shared/types.js'
import { DISABLED_HISTORY, type HistoryDb } from '../../history/db.js'
import { Scheduler } from '../index.js'

/** A HistoryDb whose schedule store is a plain map — what persistence looks like to a test. */
function memoryDb(initial: ScheduleJob[] = []): HistoryDb & { schedules: Map<string, ScheduleJob> } {
  const schedules = new Map(initial.map(j => [j.id, j]))
  return {
    ...DISABLED_HISTORY,
    enabled: true,
    schedules,
    insertSchedule: job => { schedules.set(job.id, job) },
    deleteSchedule: id => { schedules.delete(id) },
    listSchedules: () => [...schedules.values()],
  }
}

function job(over: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'job-1', kind: 'resume-run', projectId: 'p1', taskId: null,
    sessionId: 'sess-1', prompt: 'continue',
    runAt: '2026-08-13T12:00:00.000Z', createdAt: '2026-08-13T10:00:00.000Z',
    note: null,
    repeatEveryMs: null, loopId: null, iteration: 1, maxIterations: null, stopAfterFailures: null,
    ...over,
  }
}

const NOW = new Date('2026-08-13T10:00:00.000Z')

describe('Scheduler', () => {
  let scheduler: Scheduler | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(console, 'warn').mockImplementation(() => { /* stale-drop log */ })
  })

  afterEach(() => {
    scheduler?.stop()
    scheduler = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fires a job at its runAt, removes it, and announces the change', () => {
    const db = memoryDb()
    scheduler = new Scheduler(db)
    const fired: ScheduleJob[] = []
    const changes: ScheduleJob[][] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j))
    scheduler.on('changed', (list: ScheduleJob[]) => changes.push(list))
    scheduler.start()

    const added = scheduler.add({
      kind: 'resume-run', projectId: 'p1', taskId: null,
      sessionId: 'sess-1', prompt: 'continue',
      runAt: new Date(NOW.getTime() + 60_000).toISOString(), note: null,
    })
    expect(db.schedules.has(added.id)).toBe(true)

    vi.advanceTimersByTime(59_000)
    expect(fired).toHaveLength(0)
    vi.advanceTimersByTime(2_000)
    expect(fired.map(j => j.id)).toEqual([added.id])
    expect(scheduler.list()).toEqual([])
    expect(db.schedules.size).toBe(0)
    // one 'changed' for the add, one for the fire
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual([])
  })

  it('re-arms when an earlier job arrives after a later one', () => {
    scheduler = new Scheduler(memoryDb())
    const fired: string[] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j.sessionId ?? ''))
    scheduler.start()

    scheduler.add({ ...job({ sessionId: 'late' }), runAt: new Date(NOW.getTime() + 10 * 60_000).toISOString() })
    scheduler.add({ ...job({ sessionId: 'early' }), runAt: new Date(NOW.getTime() + 60_000).toISOString() })

    vi.advanceTimersByTime(61_000)
    expect(fired).toEqual(['early'])
    vi.advanceTimersByTime(10 * 60_000)
    expect(fired).toEqual(['early', 'late'])
  })

  it('a cancelled job never fires and leaves the store', () => {
    const db = memoryDb()
    scheduler = new Scheduler(db)
    const fired: ScheduleJob[] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j))
    scheduler.start()

    const added = scheduler.add({
      kind: 'dispatch-task', projectId: 'p1', taskId: 'T-001',
      sessionId: null, prompt: null,
      runAt: new Date(NOW.getTime() + 60_000).toISOString(), note: null,
    })
    expect(scheduler.cancel(added.id)).toBe(true)
    expect(scheduler.cancel(added.id)).toBe(false)
    expect(db.schedules.size).toBe(0)

    vi.advanceTimersByTime(120_000)
    expect(fired).toHaveLength(0)
  })

  it('on start: fires jobs overdue by less than 24h, drops older ones with a log', () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 3_600_000).toISOString()
    const twoDaysAgo = new Date(NOW.getTime() - 48 * 3_600_000).toISOString()
    const db = memoryDb([
      job({ id: 'recent', sessionId: 'recent', runAt: twoHoursAgo }),
      job({ id: 'ancient', sessionId: 'ancient', runAt: twoDaysAgo }),
    ])
    scheduler = new Scheduler(db)
    const fired: string[] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j.id))
    scheduler.start()

    expect(scheduler.list().map(j => j.id)).toEqual(['recent'])
    expect(db.schedules.has('ancient')).toBe(false)
    expect(console.warn).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(1)
    expect(fired).toEqual(['recent'])
    expect(db.schedules.size).toBe(0)
  })

  it('drops a persisted job whose runAt does not parse, instead of crashing or looping', () => {
    const db = memoryDb([job({ id: 'garbage', runAt: 'not a date at all' })])
    scheduler = new Scheduler(db)
    const fired: ScheduleJob[] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j))
    scheduler.start()

    expect(scheduler.list()).toEqual([])
    expect(db.schedules.size).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(fired).toHaveLength(0)
  })

  it('caps the timer for a far-future job and still does not fire early', () => {
    scheduler = new Scheduler(memoryDb())
    const fired: ScheduleJob[] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j))
    scheduler.start()

    // 60 days out: beyond the 32-bit setTimeout limit.
    scheduler.add({ ...job(), runAt: new Date(NOW.getTime() + 60 * 86_400_000).toISOString() })
    vi.advanceTimersByTime(30 * 86_400_000)
    expect(fired).toHaveLength(0)
    vi.advanceTimersByTime(31 * 86_400_000)
    expect(fired).toHaveLength(1)
  })

  it('works fully in memory on the disabled db handle', () => {
    scheduler = new Scheduler(DISABLED_HISTORY)
    const fired: ScheduleJob[] = []
    scheduler.on('fire', (j: ScheduleJob) => fired.push(j))
    scheduler.start()

    const added = scheduler.add({
      kind: 'resume-run', projectId: 'p1', taskId: null, sessionId: 's',
      prompt: 'continue', runAt: new Date(NOW.getTime() + 1_000).toISOString(), note: null,
    })
    expect(scheduler.list().map(j => j.id)).toEqual([added.id])
    vi.advanceTimersByTime(1_001)
    expect(fired.map(j => j.id)).toEqual([added.id])
  })

  it('add() defaults the loop fields to a one-shot and carries explicit ones', () => {
    scheduler = new Scheduler(memoryDb())
    scheduler.start()
    const oneShot = scheduler.add({
      kind: 'dispatch-task', projectId: 'p1', taskId: 'T-001', sessionId: null,
      prompt: null, runAt: new Date(NOW.getTime() + 60_000).toISOString(), note: null,
    })
    expect(oneShot).toMatchObject({
      repeatEveryMs: null, loopId: null, iteration: 1, maxIterations: null, stopAfterFailures: null,
    })

    const loop = scheduler.add({
      kind: 'dispatch-task', projectId: 'p1', taskId: 'T-001', sessionId: null,
      prompt: null, runAt: new Date(NOW.getTime() + 60_000).toISOString(), note: null,
      repeatEveryMs: 120_000, loopId: 'loop-1', iteration: 3, maxIterations: 5, stopAfterFailures: 2,
    })
    expect(loop).toMatchObject({
      repeatEveryMs: 120_000, loopId: 'loop-1', iteration: 3, maxIterations: 5, stopAfterFailures: 2,
    })
  })

  it('defaults loop fields missing from a persisted row (pre-loop db) on reload', () => {
    const legacy = job({ id: 'legacy', runAt: new Date(NOW.getTime() + 60_000).toISOString() })
    // A row written before the loop columns existed carries none of them.
    delete (legacy as Partial<ScheduleJob>).repeatEveryMs
    delete (legacy as Partial<ScheduleJob>).loopId
    delete (legacy as Partial<ScheduleJob>).iteration
    delete (legacy as Partial<ScheduleJob>).maxIterations
    delete (legacy as Partial<ScheduleJob>).stopAfterFailures
    scheduler = new Scheduler(memoryDb([legacy]))
    scheduler.start()
    expect(scheduler.list()[0]).toMatchObject({
      id: 'legacy',
      repeatEveryMs: null, loopId: null, iteration: 1, maxIterations: null, stopAfterFailures: null,
    })
  })

  it('lists soonest first', () => {
    scheduler = new Scheduler(memoryDb())
    scheduler.start()
    scheduler.add({ ...job({ sessionId: 'b' }), runAt: new Date(NOW.getTime() + 2_000).toISOString() })
    scheduler.add({ ...job({ sessionId: 'a' }), runAt: new Date(NOW.getTime() + 1_000).toISOString() })
    expect(scheduler.list().map(j => j.sessionId)).toEqual(['a', 'b'])
  })
})
