import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { ScheduleJob } from '../../shared/types.js'
import type { HistoryDb } from '../history/db.js'

/**
 * Holds pending scheduled jobs and fires them at their `runAt`.
 *
 * The in-memory map is the authority; the history db is only its mirror, so a
 * disabled db (Node without `node:sqlite`) leaves the scheduler fully working —
 * the jobs just die with the process. One timer covers the whole set: it is
 * armed for the nearest job and re-armed on every change, and it is unref'd so
 * a pending schedule never keeps the process alive.
 *
 * Events: `fire` with the job (already removed from the set — firing is
 * consumption; the listener re-adds a job if it wants a retry), and `changed`
 * with the full list after every mutation, ready to broadcast.
 */
export class Scheduler extends EventEmitter {
  #jobs = new Map<string, ScheduleJob>()
  #db: HistoryDb
  #timer: NodeJS.Timeout | null = null
  #now: () => number

  constructor(db: HistoryDb, opts: { now?: () => number } = {}) {
    super()
    this.#db = db
    this.#now = opts.now ?? Date.now
  }

  /**
   * Reloads persisted jobs. Anything overdue by less than 24h fires on the
   * next tick — the server was merely down when it was due. Older leftovers
   * (and rows whose `runAt` does not parse) are dropped with one log line:
   * firing a week-old "continue" into a project would be a surprise, not help.
   */
  start(): void {
    const now = this.#now()
    for (const job of this.#db.listSchedules()) {
      const at = Date.parse(job.runAt)
      if (Number.isNaN(at) || now - at > MAX_OVERDUE_MS) {
        console.warn(`dropping stale schedule ${job.id} (${job.kind}, runAt ${job.runAt})`)
        this.#db.deleteSchedule(job.id)
        continue
      }
      this.#jobs.set(job.id, withLoopDefaults(job))
    }
    this.#arm()
  }

  /** Pending jobs, soonest first. */
  list(): ScheduleJob[] {
    return [...this.#jobs.values()].sort((a, b) => this.#time(a) - this.#time(b))
  }

  add(input: ScheduleInput): ScheduleJob {
    const job: ScheduleJob = {
      ...input,
      repeatEveryMs: input.repeatEveryMs ?? null,
      loopId: input.loopId ?? null,
      iteration: input.iteration ?? 1,
      maxIterations: input.maxIterations ?? null,
      stopAfterFailures: input.stopAfterFailures ?? null,
      id: randomUUID(), createdAt: new Date(this.#now()).toISOString(),
    }
    this.#jobs.set(job.id, job)
    this.#db.insertSchedule(job)
    this.#arm()
    this.emit('changed', this.list())
    return job
  }

  cancel(id: string): boolean {
    if (!this.#jobs.delete(id)) return false
    this.#db.deleteSchedule(id)
    this.#arm()
    this.emit('changed', this.list())
    return true
  }

  stop(): void {
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
  }

  #time(job: ScheduleJob): number {
    const t = Date.parse(job.runAt)
    // A job that stops parsing (hand-edited db) counts as due now rather than
    // never: firing visibly beats sitting invisible forever.
    return Number.isNaN(t) ? this.#now() : t
  }

  #arm(): void {
    this.stop()
    const next = this.list()[0]
    if (next === undefined) return
    // Far-future jobs would overflow setTimeout's 32-bit delay; cap it and let
    // the tick re-arm — a no-op wake once every ~24.8 days costs nothing.
    const delay = Math.min(Math.max(0, this.#time(next) - this.#now()), MAX_TIMER_MS)
    this.#timer = setTimeout(() => this.#tick(), delay)
    this.#timer.unref()
  }

  #tick(): void {
    this.#timer = null
    const now = this.#now()
    const due = this.list().filter(job => this.#time(job) <= now)
    for (const job of due) {
      this.#jobs.delete(job.id)
      this.#db.deleteSchedule(job.id)
    }
    this.#arm()
    if (due.length === 0) return
    this.emit('changed', this.list())
    for (const job of due) this.emit('fire', job)
  }
}

const MAX_OVERDUE_MS = 24 * 60 * 60 * 1000
const MAX_TIMER_MS = 2 ** 31 - 1

/** Loop fields default (one-shot) so pre-loop callers keep their call shape. */
type LoopField = 'repeatEveryMs' | 'loopId' | 'iteration' | 'maxIterations' | 'stopAfterFailures'
export type ScheduleInput =
  Omit<ScheduleJob, 'id' | 'createdAt' | LoopField> & Partial<Pick<ScheduleJob, LoopField>>

/**
 * A row persisted before the loop columns existed (or hand-edited since) may
 * miss them at runtime whatever the type says; reload defaults it to one-shot.
 */
function withLoopDefaults(job: ScheduleJob): ScheduleJob {
  const raw: Partial<ScheduleJob> = job
  return {
    ...job,
    repeatEveryMs: raw.repeatEveryMs ?? null,
    loopId: raw.loopId ?? null,
    iteration: raw.iteration ?? 1,
    maxIterations: raw.maxIterations ?? null,
    stopAfterFailures: raw.stopAfterFailures ?? null,
  }
}
