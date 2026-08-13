/** One statusline reading of a plan window's consumption. */
export interface BurnSample {
  usedPercentage: number
  /** When the reading was taken, epoch ms. */
  atMs: number
}

export interface BurnProjection {
  /** Percentage points consumed per minute over the sampled span. */
  ratePerMinute: number
  /** When 100% is reached at this pace, ISO-8601. */
  projectedHitAt: string
}

/**
 * Linear burn rate from statusline samples, oldest first. Only the run since
 * the last reset counts: a drop in percentage means the window rolled over, and
 * mixing readings across a reset would average two unrelated slopes. Returns
 * null when fewer than two samples remain after the reset, when usage is flat
 * or falling, or when the span has no duration — a projection from any of
 * those would be a guess dressed as a fact.
 */
export function computeBurnRate(samples: readonly BurnSample[]): BurnProjection | null {
  let start = 0
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const cur = samples[i]
    if (prev && cur && cur.usedPercentage < prev.usedPercentage) start = i
  }
  const first = samples[start]
  const last = samples[samples.length - 1]
  if (!first || !last || samples.length - start < 2) return null

  const deltaPct = last.usedPercentage - first.usedPercentage
  const deltaMin = (last.atMs - first.atMs) / 60_000
  if (deltaPct <= 0 || deltaMin <= 0) return null

  const ratePerMinute = deltaPct / deltaMin
  const minutesToFull = (100 - last.usedPercentage) / ratePerMinute
  return {
    ratePerMinute,
    projectedHitAt: new Date(last.atMs + minutesToFull * 60_000).toISOString(),
  }
}
