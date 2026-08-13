import type { ScheduleJob } from '../../shared/types.js'

/**
 * Rate-limit-aware loops: a loop iteration must not fire into a nearly
 * exhausted 5h window — the run would burn its budget just to die
 * rate-limited. At fire time (and when the LoopController replicates the next
 * iteration) the current window is consulted and the moment shifted past the
 * reset instead. One-shot jobs are never deferred: a human picked that exact
 * time.
 */

/** Same threshold the limit alert fires at (src/server/alerts LIMIT_FIRE_AT). */
export const LIMIT_DEFER_AT = 90
/** Per loop: after this many postponements in a row, dispatch anyway — the
 * run will die rate-limited and auto-continue (SPEC 8.12) takes over. */
export const MAX_CONSECUTIVE_DEFERRALS = 3
const RESET_SLACK_MS = 60_000
const FALLBACK_DELAY_MS = 30 * 60_000

/** The slice of PlanLimits.fiveHour this module reads. */
export interface FiveHourWindow {
  usedPercentage: number
  resetsAt: string | null
}

/**
 * The moment to wait for (plus a human-readable note) when the window is at or
 * past the threshold; null when firing now is fine.
 */
export function limitDeferral(
  fiveHour: FiveHourWindow | null,
  now: number,
): { atMs: number; note: string } | null {
  if (fiveHour === null) return null
  const pct = fiveHour.usedPercentage
  if (!Number.isFinite(pct) || pct < LIMIT_DEFER_AT) return null
  const reset = fiveHour.resetsAt !== null ? Date.parse(fiveHour.resetsAt) : NaN
  const atMs = !Number.isNaN(reset) && reset > now ? reset + RESET_SLACK_MS : now + FALLBACK_DELAY_MS
  return { atMs, note: `deferred: 5h window at ${Math.round(pct)}%` }
}

/**
 * Fire-time decision for one job: the runAt/note to postpone a loop iteration
 * to, or null to dispatch as planned (always null for one-shot jobs).
 */
export function deferLoopIteration(
  job: ScheduleJob,
  fiveHour: FiveHourWindow | null,
  now: number,
): { runAt: string; note: string } | null {
  if (job.loopId === null) return null
  const d = limitDeferral(fiveHour, now)
  if (d === null) return null
  return { runAt: new Date(d.atMs).toISOString(), note: d.note }
}

/** Caps consecutive postponements per loop so a window that never reads as
 * reset (stale statusline, clock skew) cannot defer a loop forever. */
export class DeferralTracker {
  #counts = new Map<string, number>()

  /** True when this deferral is allowed (and now counted); false past the cap. */
  defer(loopId: string): boolean {
    const n = this.#counts.get(loopId) ?? 0
    if (n >= MAX_CONSECUTIVE_DEFERRALS) return false
    this.#counts.set(loopId, n + 1)
    return true
  }

  /** A real dispatch happened: the consecutive count starts over. */
  dispatched(loopId: string): void {
    this.#counts.delete(loopId)
  }
}
