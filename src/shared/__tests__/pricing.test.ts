import { describe, it, expect } from 'vitest'
import {
  estimateCost, rateFor, contextWindowFor, normalizeModelId, occupancyFraction, PRICES_VERIFIED_ON,
} from '../pricing.js'
import type { RateBucket, TokenTotals } from '../types.js'

function totals(over: Partial<TokenTotals> = {}): TokenTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
    webSearchRequests: 0, webFetchRequests: 0, messages: 1, ...over,
  }
}

function bucket(over: Partial<RateBucket> = {}): RateBucket {
  return { model: 'claude-opus-5', speed: 'standard', inferenceGeo: 'not_available', totals: totals(), ...over }
}

describe('rateFor', () => {
  it('prices the models that actually appear in transcripts', () => {
    expect(rateFor('claude-opus-5')).toMatchObject({ input: 5, output: 25 })
    expect(rateFor('claude-fable-5')).toMatchObject({ input: 10, output: 50 })
    expect(rateFor('claude-opus-4-8')).toMatchObject({ input: 5, output: 25 })
    expect(rateFor('claude-sonnet-5')).toMatchObject({ input: 2, output: 10 })
  })

  it('strips the release date suffix', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(rateFor('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 })
  })

  it('returns null for a model it does not know, rather than a made-up price', () => {
    expect(rateFor('claude-something-6')).toBeNull()
    expect(rateFor('<synthetic>')).toBeNull()
    expect(rateFor('')).toBeNull()
  })

  it('carries the date its prices were checked', () => {
    expect(PRICES_VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('contextWindowFor', () => {
  it('knows the 1M and 200k windows', () => {
    expect(contextWindowFor('claude-opus-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-haiku-4-5-20251001')).toBe(200_000)
  })

  it('is null for an unknown or absent model', () => {
    expect(contextWindowFor('claude-future-9')).toBeNull()
    expect(contextWindowFor(null)).toBeNull()
  })
})

describe('estimateCost', () => {
  it('prices plain input and output at list rates', () => {
    // 1M input at $5 + 1M output at $25.
    const c = estimateCost([bucket({ totals: totals({ inputTokens: 1_000_000, outputTokens: 1_000_000 }) })])
    expect(c.usd).toBeCloseTo(30, 6)
  })

  it('charges cache reads at a tenth and 5m writes at 1.25x', () => {
    const c = estimateCost([bucket({ totals: totals({
      cacheReadInputTokens: 1_000_000, cacheCreation5mInputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
    }) })])
    expect(c.usd).toBeCloseTo(5 * 0.1 + 5 * 1.25, 6)
  })

  it('charges 1h writes at 2x', () => {
    const c = estimateCost([bucket({ totals: totals({
      cacheCreation1hInputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000,
    }) })])
    expect(c.usd).toBeCloseTo(10, 6)
  })

  it('never bills the flat cache total on top of its own two buckets', () => {
    const split = estimateCost([bucket({ totals: totals({
      cacheCreation5mInputTokens: 400_000, cacheCreation1hInputTokens: 0,
      cacheCreationInputTokens: 400_000,
    }) })])
    expect(split.usd).toBeCloseTo(0.4 * 5 * 1.25, 6)
  })

  it('reports what caching saved', () => {
    const c = estimateCost([bucket({ totals: totals({
      cacheReadInputTokens: 1_000_000, cacheCreationInputTokens: 0,
    }) })])
    expect(c.usd).toBeCloseTo(0.5, 6)         // read at 0.1x
    expect(c.withoutCacheUsd).toBeCloseTo(5, 6)  // the same tokens as plain input
    expect(c.withoutCacheUsd!).toBeGreaterThan(c.usd!)
  })

  it('reprices opus under fast mode', () => {
    const standard = estimateCost([bucket({ totals: totals({ outputTokens: 1_000_000 }) })])
    const fast = estimateCost([bucket({ speed: 'fast', totals: totals({ outputTokens: 1_000_000 }) })])
    expect(standard.usd).toBeCloseTo(25, 6)
    expect(fast.usd).toBeCloseTo(50, 6)
  })

  it('leaves fast mode alone for a model it does not apply to', () => {
    const c = estimateCost([bucket({ model: 'claude-sonnet-5', speed: 'fast', totals: totals({ outputTokens: 1_000_000 }) })])
    expect(c.usd).toBeCloseTo(10, 6)
  })

  it('applies the us data-residency multiplier', () => {
    const c = estimateCost([bucket({ inferenceGeo: 'us', totals: totals({ outputTokens: 1_000_000 }) })])
    expect(c.usd).toBeCloseTo(27.5, 6)
  })

  it('charges web searches per thousand on top of tokens', () => {
    const c = estimateCost([bucket({ totals: totals({ webSearchRequests: 1000 }) })])
    expect(c.usd).toBeCloseTo(10, 6)
  })

  it('sums a session that switched models', () => {
    const c = estimateCost([
      bucket({ model: 'claude-opus-5', totals: totals({ outputTokens: 1_000_000 }) }),
      bucket({ model: 'claude-fable-5', totals: totals({ outputTokens: 1_000_000 }) }),
    ])
    expect(c.usd).toBeCloseTo(75, 6)
  })

  it('names the models it could not price and leaves their tokens out', () => {
    const c = estimateCost([
      bucket({ model: 'claude-opus-5', totals: totals({ outputTokens: 1_000_000 }) }),
      bucket({ model: 'claude-unreleased-7', totals: totals({ outputTokens: 1_000_000 }) }),
    ])
    expect(c.usd).toBeCloseTo(25, 6)
    expect(c.unpricedModels).toEqual(['claude-unreleased-7'])
  })

  it('is null, not zero, when nothing could be priced', () => {
    const c = estimateCost([bucket({ model: 'claude-unreleased-7', totals: totals({ outputTokens: 5 }) })])
    expect(c.usd).toBeNull()
    expect(c.withoutCacheUsd).toBeNull()
  })

  it('is null for a session with no usage at all', () => {
    expect(estimateCost([]).usd).toBeNull()
    expect(estimateCost([bucket({ totals: totals({ messages: 0 }) })]).usd).toBeNull()
  })
})

describe('occupancyFraction', () => {
  it('is a fraction of the model own window', () => {
    expect(occupancyFraction(500_000, 'claude-opus-5')).toBeCloseTo(0.5, 6)
    expect(occupancyFraction(100_000, 'claude-haiku-4-5')).toBeCloseTo(0.5, 6)
  })

  it('is null when the model is unknown, so no bar is drawn', () => {
    expect(occupancyFraction(500_000, 'claude-future-9')).toBeNull()
    expect(occupancyFraction(500_000, null)).toBeNull()
  })

  it('is null before the first assistant turn, which is not the same as zero', () => {
    expect(occupancyFraction(null, 'claude-opus-5')).toBeNull()
  })

  it('clamps rather than reporting more than a full window', () => {
    expect(occupancyFraction(2_000_000, 'claude-opus-5')).toBe(1)
  })
})
