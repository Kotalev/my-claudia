import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetLabel } from '../PlanLimits.js'

const NOW = '2026-08-12T12:00:00.000Z'

function inMinutes(mins: number): string {
  return new Date(Date.parse(NOW) + mins * 60_000).toISOString()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('resetLabel', () => {
  it('renders hours and minutes for a reset over an hour away', () => {
    expect(resetLabel(inMinutes(150))).toBe('resets in 2h 30m')
  })

  it('renders minutes only under an hour', () => {
    expect(resetLabel(inMinutes(45))).toBe('resets in 45m')
  })

  it('renders days beyond 24 hours', () => {
    expect(resetLabel(inMinutes(3 * 24 * 60 + 5))).toBe('resets in 3d')
  })

  it('is empty for null', () => {
    expect(resetLabel(null)).toBe('')
  })

  it('is empty for a reset in the past', () => {
    expect(resetLabel(inMinutes(-5))).toBe('')
  })

  it('is empty at the exact reset instant', () => {
    expect(resetLabel(NOW)).toBe('')
  })

  it('degrades to empty on an unparseable timestamp', () => {
    expect(resetLabel('not-a-date')).toBe('')
  })

  it('advances as the clock ticks', () => {
    const at = inMinutes(61)
    expect(resetLabel(at)).toBe('resets in 1h 1m')
    vi.setSystemTime(new Date(Date.parse(NOW) + 2 * 60_000))
    expect(resetLabel(at)).toBe('resets in 59m')
  })
})
