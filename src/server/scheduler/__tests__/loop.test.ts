import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { QueuedDispatch, RunHandle, ScheduleJob } from '../../../shared/types.js'
import { DISABLED_HISTORY } from '../../history/db.js'
import { Scheduler } from '../index.js'
import { LoopController } from '../loop.js'

const NOW = new Date('2026-08-13T10:00:00.000Z')
const HOUR = 3_600_000

/** A fired loop job as the fire handler would hold it. */
function loopJob(over: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'job-1', kind: 'dispatch-task', projectId: 'p1', taskId: 'T-001',
    sessionId: null, prompt: null,
    runAt: NOW.toISOString(), createdAt: new Date(NOW.getTime() - HOUR).toISOString(),
    note: null,
    repeatEveryMs: HOUR, loopId: 'loop-1', iteration: 1,
    maxIterations: null, stopAfterFailures: null,
    ...over,
  }
}

function endedRun(runId: string, status: 'succeeded' | 'failed' | 'cancelled'): RunHandle {
  return {
    runId, projectId: 'p1', taskId: 'T-001', sessionId: null, status,
    startedAt: NOW.toISOString(), endedAt: new Date().toISOString(),
    exitCode: status === 'succeeded' ? 0 : 1, costUsd: null, numTurns: null,
  }
}

function queuedItem(queueId: string): QueuedDispatch {
  return {
    queueId, projectId: 'p1',
    input: { projectId: 'p1', projectPath: '/tmp/p1', taskId: 'T-001', prompt: 'go' },
    queuedAt: NOW.toISOString(),
  }
}

describe('LoopController', () => {
  let scheduler: Scheduler
  let dispatcher: EventEmitter & { finishInput: (runId: string) => void; finished: string[] }
  let queue: EventEmitter
  let loops: LoopController

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    scheduler = new Scheduler(DISABLED_HISTORY)
    scheduler.start()
    const finished: string[] = []
    dispatcher = Object.assign(new EventEmitter(), {
      finished,
      finishInput: (runId: string) => { finished.push(runId) },
    })
    queue = new EventEmitter()
    loops = new LoopController(scheduler, dispatcher, queue)
  })

  afterEach(() => {
    scheduler.stop()
    vi.useRealTimers()
  })

  it('replicates the job when the run finishes: runAt = prev + repeat, iteration + 1', () => {
    loops.started(loopJob(), 'r1')
    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000)) // the run took 10 minutes
    dispatcher.emit('update', endedRun('r1', 'succeeded'))

    const next = scheduler.list()
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      kind: 'dispatch-task', taskId: 'T-001', loopId: 'loop-1',
      iteration: 2, repeatEveryMs: HOUR,
      runAt: new Date(NOW.getTime() + HOUR).toISOString(),
    })
  })

  it("closes a loop run's stdin the moment it goes awaiting-input", () => {
    // An autonomous iteration has nobody to steer it; left alone it would sit
    // on the dispatcher's idle timer (~10 min) before ending, so a short-cadence
    // loop would drift by that much every iteration.
    loops.started(loopJob(), 'r1')
    dispatcher.emit('update', { ...endedRun('r1', 'succeeded'), status: 'awaiting-input', endedAt: null })
    expect(dispatcher.finished).toEqual(['r1'])
    // Still following: the run has not ended yet.
    expect(scheduler.list()).toHaveLength(0)
  })

  it('leaves non-loop awaiting-input runs alone', () => {
    dispatcher.emit('update', { ...endedRun('untracked', 'succeeded'), status: 'awaiting-input', endedAt: null })
    expect(dispatcher.finished).toEqual([])
  })

  it('does not replicate on a mid-run update (endedAt still null)', () => {
    loops.started(loopJob(), 'r1')
    dispatcher.emit('update', { ...endedRun('r1', 'succeeded'), status: 'running', endedAt: null })
    expect(scheduler.list()).toHaveLength(0)
  })

  it('falls back to finish + 60s when the nominal next runAt is already past', () => {
    loops.started(loopJob(), 'r1')
    const finish = NOW.getTime() + 2 * HOUR // the run outlived a whole period
    vi.setSystemTime(new Date(finish))
    dispatcher.emit('update', endedRun('r1', 'succeeded'))

    expect(scheduler.list()[0]?.runAt).toBe(new Date(finish + 60_000).toISOString())
  })

  it('stops at maxIterations with a visible trace', () => {
    loops.started(loopJob({ iteration: 3, maxIterations: 3 }), 'r1')
    dispatcher.emit('update', endedRun('r1', 'succeeded'))

    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()).toHaveLength(1)
    expect(loops.stopped()[0]).toMatchObject({ loopId: 'loop-1', iteration: 3 })
    expect(loops.stopped()[0]?.note).toContain('3 iterations')
  })

  it('stops after stopAfterFailures consecutive failed runs, with a trace', () => {
    loops.started(loopJob({ stopAfterFailures: 2 }), 'r1')
    dispatcher.emit('update', endedRun('r1', 'failed'))
    // First failure: the loop carries on.
    expect(scheduler.list()).toHaveLength(1)
    const second = scheduler.list()[0]!
    scheduler.cancel(second.id) // simulate the fire consuming it

    loops.started(second, 'r2')
    dispatcher.emit('update', endedRun('r2', 'failed'))
    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()[0]?.note).toContain('2 consecutive failed runs')
  })

  it('a success resets the consecutive-failure count', () => {
    loops.started(loopJob({ stopAfterFailures: 2 }), 'r1')
    dispatcher.emit('update', endedRun('r1', 'failed'))
    const second = scheduler.list()[0]!
    scheduler.cancel(second.id)

    loops.started(second, 'r2')
    dispatcher.emit('update', endedRun('r2', 'succeeded'))
    const third = scheduler.list()[0]!
    scheduler.cancel(third.id)

    // One more failure would have stopped the loop had the success not reset it.
    loops.started(third, 'r3')
    dispatcher.emit('update', endedRun('r3', 'failed'))
    expect(scheduler.list()).toHaveLength(1)
    expect(loops.stopped()).toHaveLength(0)
  })

  it('a cancelled run stops the loop silently — no next job, no trace', () => {
    loops.started(loopJob(), 'r1')
    dispatcher.emit('update', endedRun('r1', 'cancelled'))
    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()).toHaveLength(0)
  })

  it('follows a queued dispatch to its run and replicates when that run ends', () => {
    const job = loopJob()
    loops.queued(job, 'q1')
    queue.emit('started', { queued: queuedItem('q1'), run: { ...endedRun('r1', 'succeeded'), status: 'running', endedAt: null } })
    // The drain's trailing 'changed' (item gone because it started) must not stop the loop.
    queue.emit('changed', [])
    expect(scheduler.list()).toHaveLength(0)

    dispatcher.emit('update', endedRun('r1', 'succeeded'))
    expect(scheduler.list()[0]).toMatchObject({ loopId: 'loop-1', iteration: 2 })
  })

  it('a dispatch cancelled from the queue stops the loop silently', () => {
    loops.queued(loopJob(), 'q1')
    queue.emit('changed', []) // the item vanished without ever starting
    dispatcher.emit('update', endedRun('r1', 'succeeded'))
    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()).toHaveLength(0)
  })

  it('startFailed counts as a failed run', () => {
    const job = loopJob({ stopAfterFailures: 1 })
    loops.startFailed(job)
    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()[0]?.note).toContain('1 consecutive failed run')
  })

  it('abort stops the loop with the given trace', () => {
    loops.abort(loopJob(), 'task T-001 no longer exists')
    expect(loops.stopped()[0]?.note).toBe('task T-001 no longer exists')
  })

  it('a malformed loop job (loopId without repeatEveryMs) ends instead of looping or crashing', () => {
    loops.started(loopJob({ repeatEveryMs: null }), 'r1')
    dispatcher.emit('update', endedRun('r1', 'succeeded'))
    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()[0]?.note).toContain('no repeatEveryMs')
  })

  it('ignores one-shot jobs and unknown runs entirely', () => {
    loops.started(loopJob({ loopId: null, repeatEveryMs: null }), 'r1')
    dispatcher.emit('update', endedRun('r1', 'succeeded'))
    dispatcher.emit('update', endedRun('never-tracked', 'failed'))
    expect(scheduler.list()).toHaveLength(0)
    expect(loops.stopped()).toHaveLength(0)
  })

  it('a job whose runAt does not parse replicates from finish + 60s', () => {
    loops.started(loopJob({ runAt: 'garbage' }), 'r1')
    dispatcher.emit('update', endedRun('r1', 'succeeded'))
    expect(scheduler.list()[0]?.runAt).toBe(new Date(NOW.getTime() + 60_000).toISOString())
  })

  describe('5h-window deferral on replication', () => {
    function loopsWith(fiveHour: { usedPercentage: number; resetsAt: string | null } | null): LoopController {
      return new LoopController(scheduler, dispatcher, queue, { getFiveHour: () => fiveHour })
    }

    it('shifts the next iteration past the reset when the window is nearly exhausted', () => {
      const reset = new Date(NOW.getTime() + 2 * HOUR).toISOString() // beyond the nominal next runAt
      loopsWith({ usedPercentage: 95, resetsAt: reset }).started(loopJob(), 'r1')
      dispatcher.emit('update', endedRun('r1', 'succeeded'))

      const next = scheduler.list()[0]
      expect(next?.runAt).toBe(new Date(Date.parse(reset) + 60_000).toISOString())
      expect(next?.note).toBe('deferred: 5h window at 95%')
      expect(next?.iteration).toBe(2)
    })

    it('keeps the nominal runAt when it already lies past the reset', () => {
      const reset = new Date(NOW.getTime() + 10 * 60_000).toISOString() // resets well before prev + repeat
      loopsWith({ usedPercentage: 95, resetsAt: reset }).started(loopJob(), 'r1')
      dispatcher.emit('update', endedRun('r1', 'succeeded'))

      const next = scheduler.list()[0]
      expect(next?.runAt).toBe(new Date(NOW.getTime() + HOUR).toISOString())
      expect(next?.note).toBeNull()
    })

    it('does not shift below the threshold', () => {
      loopsWith({ usedPercentage: 89, resetsAt: new Date(NOW.getTime() + 2 * HOUR).toISOString() })
        .started(loopJob(), 'r1')
      dispatcher.emit('update', endedRun('r1', 'succeeded'))
      expect(scheduler.list()[0]?.runAt).toBe(new Date(NOW.getTime() + HOUR).toISOString())
    })
  })
})
