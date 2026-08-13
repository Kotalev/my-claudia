import { describe, expect, it } from 'vitest'
import { computeBurnRate, type BurnSample } from '../burn-rate.js'

const T0 = Date.parse('2026-08-12T10:00:00Z')

function sample(minutes: number, usedPercentage: number): BurnSample {
  return { usedPercentage, atMs: T0 + minutes * 60_000 }
}

describe('computeBurnRate', () => {
  it('returns null for no samples and for a single sample', () => {
    expect(computeBurnRate([])).toBeNull()
    expect(computeBurnRate([sample(0, 40)])).toBeNull()
  })

  it('projects a linear hit time from rising samples', () => {
    // 40% → 50% over 10 minutes: 1%/min, so 100% lands 50 minutes after the last sample.
    const p = computeBurnRate([sample(0, 40), sample(5, 45), sample(10, 50)])
    expect(p).not.toBeNull()
    expect(p!.ratePerMinute).toBeCloseTo(1)
    expect(p!.projectedHitAt).toBe('2026-08-12T11:00:00.000Z')
  })

  it('projects nothing when usage is flat', () => {
    expect(computeBurnRate([sample(0, 40), sample(5, 40), sample(10, 40)])).toBeNull()
  })

  it('projects nothing when usage is falling', () => {
    expect(computeBurnRate([sample(0, 50), sample(5, 45)])).toBeNull()
  })

  it('measures only the run since a mid-series reset', () => {
    // 80% → 90%, reset to 2%, then 2% → 4% over 10 minutes: 0.2%/min.
    const p = computeBurnRate([
      sample(0, 80), sample(5, 90), sample(10, 2), sample(15, 3), sample(20, 4),
    ])
    expect(p).not.toBeNull()
    expect(p!.ratePerMinute).toBeCloseTo(0.2)
    // 96 points to go at 0.2%/min = 480 minutes after the last sample (10:20Z).
    expect(p!.projectedHitAt).toBe('2026-08-12T18:20:00.000Z')
  })

  it('projects nothing when only one sample remains after a reset', () => {
    expect(computeBurnRate([sample(0, 80), sample(5, 90), sample(10, 2)])).toBeNull()
  })

  it('projects nothing when the rising samples carry no time span', () => {
    expect(computeBurnRate([
      { usedPercentage: 40, atMs: T0 }, { usedPercentage: 50, atMs: T0 },
    ])).toBeNull()
  })
})
