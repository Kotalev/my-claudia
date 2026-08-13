import type { QueuedDispatch, RunHandle, ScheduleJob } from '../../shared/types.js'
import type { Scheduler } from './index.js'
import { limitDeferral, type FiveHourWindow } from './limit-defer.js'

/**
 * Drives loop schedules (jobs with a `loopId`): a loop keeps exactly one
 * pending ScheduleJob at a time, and the NEXT one is only created once the
 * fired iteration's run has actually ended — iterations can never overlap.
 *
 * The fire handler reports what happened to a fired loop job (`started`,
 * `queued`, `startFailed`, `abort`); from there this controller follows the
 * dispatcher's public `update` events (and the queue's `started`/`changed`)
 * until the run ends, then replicates the job with `runAt = prev + repeat`
 * — or `finish + 60s` when that moment has already passed.
 *
 * Stop conditions: `maxIterations` reached, `stopAfterFailures` consecutive
 * failed runs (both leave a visible trace in `stopped()`), or a human
 * cancelling the run / the queued item / the pending job (silent).
 *
 * All state is in-memory: a loop whose iteration was mid-run at a restart is
 * lost, exactly like the run itself.
 */

/** Why a loop is no longer running, kept so the schedules list can say so. */
export interface LoopStopTrace {
  loopId: string
  projectId: string
  taskId: string | null
  iteration: number
  note: string
  stoppedAt: string
}

/** The dispatcher surface this controller needs — public events plus stdin close. */
interface RunEvents {
  on(event: 'update', listener: (run: RunHandle) => void): unknown
  finishInput(runId: string): void
}

interface QueueEvents {
  on(event: 'started', listener: (e: { queued: QueuedDispatch; run: RunHandle }) => void): unknown
  on(event: 'changed', listener: (items: QueuedDispatch[]) => void): unknown
}

/** Slack after a finish when the nominal next runAt is already in the past. */
const LATE_SLACK_MS = 60_000
const MAX_TRACES = 50

export class LoopController {
  #scheduler: Scheduler
  #now: () => number
  #getFiveHour: () => FiveHourWindow | null
  /** The fired loop job behind each run we are following, by runId. */
  #byRun = new Map<string, ScheduleJob>()
  /** Same, for iterations still waiting in the DispatchQueue, by queueId. */
  #byQueue = new Map<string, ScheduleJob>()
  /** Consecutive failed runs per loopId. Memory-only, resets on restart. */
  #failures = new Map<string, number>()
  /** Newest first, bounded. */
  #stopped: LoopStopTrace[] = []

  constructor(
    scheduler: Scheduler, dispatcher: RunEvents, queue: QueueEvents,
    opts: { now?: () => number; getFiveHour?: () => FiveHourWindow | null } = {},
  ) {
    this.#scheduler = scheduler
    this.#now = opts.now ?? Date.now
    this.#getFiveHour = opts.getFiveHour ?? (() => null)
    dispatcher.on('update', run => {
      if (run.endedAt === null) {
        // An autonomous iteration has nobody to steer it: once the result is
        // in and only the open stdin keeps the run alive, close it — otherwise
        // every iteration sits out the dispatcher's idle timer (~10 min) and a
        // short-cadence loop drifts by that much per iteration.
        if (run.status === 'awaiting-input' && this.#byRun.has(run.runId)) {
          dispatcher.finishInput(run.runId)
        }
        return
      }
      const job = this.#byRun.get(run.runId)
      if (job === undefined) return
      this.#byRun.delete(run.runId)
      this.#runEnded(job, run.status)
    })
    queue.on('started', ({ queued, run }) => {
      const job = this.#byQueue.get(queued.queueId)
      if (job === undefined) return
      this.#byQueue.delete(queued.queueId)
      this.#byRun.set(run.runId, job)
    })
    // A followed queueId vanishing from the queue without a 'started' means it
    // was cancelled (or dropped as unstartable): a human intervened, the loop
    // stops silently. The queue emits 'started' before the drain's 'changed',
    // so a normally-starting item has already moved to #byRun by then.
    queue.on('changed', items => {
      const present = new Set(items.map(i => i.queueId))
      for (const [queueId, job] of this.#byQueue) {
        if (present.has(queueId)) continue
        this.#byQueue.delete(queueId)
        this.#end(job)
      }
    })
  }

  /** The fired loop job's dispatch started as a run right away. */
  started(job: ScheduleJob, runId: string): void {
    if (job.loopId === null) return
    this.#byRun.set(runId, job)
  }

  /** The fired loop job's dispatch is waiting in the DispatchQueue. */
  queued(job: ScheduleJob, queueId: string): void {
    if (job.loopId === null) return
    this.#byQueue.set(queueId, job)
  }

  /** The dispatch could not start at all (spawn/worktree error). Counts as a failed run. */
  startFailed(job: ScheduleJob): void {
    if (job.loopId === null) return
    this.#runEnded(job, 'failed')
  }

  /** Ends a loop for a terminal reason (project gone, task gone), with a visible trace. */
  abort(job: ScheduleJob, note: string): void {
    if (job.loopId === null) return
    this.#end(job, note)
  }

  /** Loops that stopped on their own, newest first — the schedules list shows these. */
  stopped(): LoopStopTrace[] {
    return [...this.#stopped]
  }

  #runEnded(job: ScheduleJob, status: string): void {
    const loopId = job.loopId
    if (loopId === null) return
    if (status === 'cancelled') {
      // A human killed the run; keeping the loop alive would fight them.
      this.#end(job)
      return
    }
    if (status === 'failed') {
      const failures = (this.#failures.get(loopId) ?? 0) + 1
      this.#failures.set(loopId, failures)
      if (job.stopAfterFailures !== null && failures >= job.stopAfterFailures) {
        this.#end(job, `stopped after ${failures} consecutive failed run${failures === 1 ? '' : 's'}`)
        return
      }
    } else {
      this.#failures.delete(loopId)
    }
    this.#replicate(job)
  }

  #replicate(job: ScheduleJob): void {
    if (job.repeatEveryMs === null) {
      // A loop job without a cadence cannot compute its next moment; treat it
      // as complete rather than guessing one.
      this.#end(job, 'stopped: loop job has no repeatEveryMs')
      return
    }
    if (job.maxIterations !== null && job.iteration >= job.maxIterations) {
      this.#end(job, `completed all ${job.maxIterations} iteration${job.maxIterations === 1 ? '' : 's'}`)
      return
    }
    const now = this.#now()
    const prev = Date.parse(job.runAt)
    const nominal = Number.isNaN(prev) ? NaN : prev + job.repeatEveryMs
    let nextAt = Number.isNaN(nominal) || nominal <= now ? now + LATE_SLACK_MS : nominal
    // A nearly exhausted 5h window pushes the next iteration past the reset —
    // but never earlier than its nominal moment.
    let note = job.note
    const deferral = limitDeferral(this.#getFiveHour(), now)
    if (deferral !== null && deferral.atMs > nextAt) {
      nextAt = deferral.atMs
      note = deferral.note
    }
    this.#scheduler.add({
      kind: job.kind, projectId: job.projectId, taskId: job.taskId,
      sessionId: job.sessionId, prompt: job.prompt,
      runAt: new Date(nextAt).toISOString(), note,
      repeatEveryMs: job.repeatEveryMs, loopId: job.loopId,
      iteration: job.iteration + 1,
      maxIterations: job.maxIterations, stopAfterFailures: job.stopAfterFailures,
    })
  }

  #end(job: ScheduleJob, note?: string): void {
    if (job.loopId !== null) this.#failures.delete(job.loopId)
    if (note === undefined || job.loopId === null) return
    this.#stopped.unshift({
      loopId: job.loopId, projectId: job.projectId, taskId: job.taskId,
      iteration: job.iteration, note, stoppedAt: new Date(this.#now()).toISOString(),
    })
    if (this.#stopped.length > MAX_TRACES) this.#stopped.length = MAX_TRACES
  }
}
