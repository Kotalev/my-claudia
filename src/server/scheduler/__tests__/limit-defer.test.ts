import { describe, it, expect } from 'vitest'
import type { ScheduleJob } from '../../../shared/types.js'
import {
  limitDeferral, deferLoopIteration, DeferralTracker,
  LIMIT_DEFER_AT, MAX_CONSECUTIVE_DEFERRALS,
} from '../limit-defer.js'

const NOW = Date.parse('2026-08-13T10:00:00.000Z')
const RESET = new Date(NOW + 40 * 60_000).toISOString() // window resets in 40 min

function job(over: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'job-1', kind: 'dispatch-task', projectId: 'p1', taskId: 'T-001',
    sessionId: null, prompt: null,
    runAt: new Date(NOW).toISOString(), createdAt: new Date(NOW).toISOString(),
    note: null,
    repeatEveryMs: 3_600_000, loopId: 'loop-1', iteration: 2,
    maxIterations: null, stopAfterFailures: null,
    ...over,
  }
}

describe('limitDeferral', () => {
  it('is null when there is no window data at all', () => {
    expect(limitDeferral(null, NOW)).toBeNull()
  })

  it('is null below the threshold', () => {
    expect(limitDeferral({ usedPercentage: LIMIT_DEFER_AT - 1, resetsAt: RESET }, NOW)).toBeNull()
    expect(limitDeferral({ usedPercentage: 0, resetsAt: RESET }, NOW)).toBeNull()
  })

  it('defers to resetsAt + 60s at the threshold, with a percentage note', () => {
    const d = limitDeferral({ usedPercentage: LIMIT_DEFER_AT, resetsAt: RESET }, NOW)
    expect(d).toEqual({ atMs: Date.parse(RESET) + 60_000, note: `deferred: 5h window at ${LIMIT_DEFER_AT}%` })
  })

  it('rounds the percentage in the note', () => {
    const d = limitDeferral({ usedPercentage: 97.6, resetsAt: RESET }, NOW)
    expect(d?.note).toBe('deferred: 5h window at 98%')
  })

  it('falls back to now + 30min when resetsAt is missing, past, or garbage', () => {
    const fallback = NOW + 30 * 60_000
    expect(limitDeferral({ usedPercentage: 95, resetsAt: null }, NOW)?.atMs).toBe(fallback)
    expect(limitDeferral({ usedPercentage: 95, resetsAt: new Date(NOW - 1).toISOString() }, NOW)?.atMs).toBe(fallback)
    expect(limitDeferral({ usedPercentage: 95, resetsAt: 'garbage' }, NOW)?.atMs).toBe(fallback)
  })

  it('a non-finite percentage never defers', () => {
    expect(limitDeferral({ usedPercentage: NaN, resetsAt: RESET }, NOW)).toBeNull()
  })
})

describe('deferLoopIteration', () => {
  it('postpones a loop job past the reset', () => {
    const shift = deferLoopIteration(job(), { usedPercentage: 95, resetsAt: RESET }, NOW)
    expect(shift).toEqual({
      runAt: new Date(Date.parse(RESET) + 60_000).toISOString(),
      note: 'deferred: 5h window at 95%',
    })
  })

  it('never touches a one-shot job, however exhausted the window', () => {
    expect(deferLoopIteration(job({ loopId: null }), { usedPercentage: 100, resetsAt: RESET }, NOW)).toBeNull()
  })

  it('lets a loop job through under the threshold or without window data', () => {
    expect(deferLoopIteration(job(), { usedPercentage: 50, resetsAt: RESET }, NOW)).toBeNull()
    expect(deferLoopIteration(job(), null, NOW)).toBeNull()
  })
})

describe('DeferralTracker', () => {
  it('allows the cap, then refuses', () => {
    const t = new DeferralTracker()
    for (let i = 0; i < MAX_CONSECUTIVE_DEFERRALS; i++) expect(t.defer('loop-1')).toBe(true)
    expect(t.defer('loop-1')).toBe(false)
    expect(t.defer('loop-1')).toBe(false)
  })

  it('a dispatch resets the consecutive count', () => {
    const t = new DeferralTracker()
    for (let i = 0; i < MAX_CONSECUTIVE_DEFERRALS; i++) t.defer('loop-1')
    t.dispatched('loop-1')
    expect(t.defer('loop-1')).toBe(true)
  })

  it('counts per loop, not globally', () => {
    const t = new DeferralTracker()
    for (let i = 0; i < MAX_CONSECUTIVE_DEFERRALS; i++) t.defer('loop-1')
    expect(t.defer('loop-2')).toBe(true)
  })
})
