import type { RateBucket, TokenTotals } from './types.js'

/**
 * Verified against https://platform.claude.com/docs/en/about-claude/pricing.md
 * on this date. Prices change; an unstamped table quietly becomes a lie, so this
 * date is displayed next to every figure derived from it.
 */
export const PRICES_VERIFIED_ON = '2026-08-12'

/** Cache prices are fixed multiples of base input, for every model. */
const CACHE_WRITE_5M = 1.25
const CACHE_WRITE_1H = 2
const CACHE_READ = 0.1

/** `inference_geo: "us"` multiplies every category. Claude 4.6 and later only. */
const US_GEO_MULTIPLIER = 1.1

/** $10 per 1,000 searches. Web fetch is free beyond its tokens. */
const WEB_SEARCH_USD = 10 / 1000

interface Rate {
  /** USD per million base input tokens. */
  input: number
  output: number
  contextWindow: number
}

const MILLION = 1_000_000

/**
 * Base list prices, USD per million tokens. Model ids are the transcript's own,
 * with any trailing release date stripped before lookup.
 *
 * A model missing from this table costs `null`, never zero. Unknown ids do ship:
 * `claude-fable-5` was already unrecognised by tables written weeks earlier.
 */
const RATES: Record<string, Rate> = {
  'claude-fable-5': { input: 10, output: 50, contextWindow: 1_000_000 },
  'claude-mythos-5': { input: 10, output: 50, contextWindow: 1_000_000 },
  'claude-opus-5': { input: 5, output: 25, contextWindow: 1_000_000 },
  'claude-opus-4-8': { input: 5, output: 25, contextWindow: 1_000_000 },
  'claude-opus-4-7': { input: 5, output: 25, contextWindow: 1_000_000 },
  'claude-opus-4-6': { input: 5, output: 25, contextWindow: 1_000_000 },
  'claude-opus-4-5': { input: 5, output: 25, contextWindow: 200_000 },
  'claude-sonnet-5': { input: 2, output: 10, contextWindow: 1_000_000 },
  'claude-sonnet-4-6': { input: 3, output: 15, contextWindow: 1_000_000 },
  'claude-sonnet-4-5': { input: 3, output: 15, contextWindow: 200_000 },
  'claude-haiku-4-5': { input: 1, output: 5, contextWindow: 200_000 },
}

/** Fast mode reprices Opus 5 and Opus 4.8 only. */
const FAST_RATES: Record<string, Pick<Rate, 'input' | 'output'>> = {
  'claude-opus-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 10, output: 50 },
}

/** `claude-haiku-4-5-20251001` and `claude-haiku-4-5` are the same model. */
export function normalizeModelId(model: string): string {
  return model.replace(/-\d{8}$/, '')
}

export function rateFor(model: string): Rate | null {
  return RATES[normalizeModelId(model)] ?? null
}

/**
 * The context window this model was given, or null if we do not recognise it.
 * Null must render as a raw token count: a percentage of an assumed window is
 * confidently wrong, which is worse than admitting we do not know.
 */
export function contextWindowFor(model: string | null): number | null {
  return model === null ? null : rateFor(model)?.contextWindow ?? null
}

export interface CostEstimate {
  /**
   * What this would cost on pay-as-you-go, at list prices, with the prompt
   * caching that actually happened. Null when nothing priceable was found.
   */
  usd: number | null
  /**
   * The same tokens with no caching at all — every cached token paid for at full
   * input price. The gap between the two is what caching saved.
   */
  withoutCacheUsd: number | null
  /** Models we hold no price for. Their tokens are in no figure above. */
  unpricedModels: string[]
}

function priceBucket(bucket: RateBucket): { usd: number; withoutCacheUsd: number } | null {
  const base = rateFor(bucket.model)
  if (!base) return null

  const fast = bucket.speed === 'fast' ? FAST_RATES[normalizeModelId(bucket.model)] : undefined
  const input = fast?.input ?? base.input
  const output = fast?.output ?? base.output
  const geo = bucket.inferenceGeo === 'us' ? US_GEO_MULTIPLIER : 1
  const t = bucket.totals

  // Price the two cache buckets, never the flat sum: it is their total, and
  // charging it as well would bill every cached token twice.
  const cached =
    t.inputTokens * input
    + t.cacheCreation5mInputTokens * input * CACHE_WRITE_5M
    + t.cacheCreation1hInputTokens * input * CACHE_WRITE_1H
    + t.cacheReadInputTokens * input * CACHE_READ
    + t.outputTokens * output

  // The counterfactual: the same conversation with caching switched off. Every
  // token that was written to or read from the cache is plain input instead.
  const uncached =
    (t.inputTokens + t.cacheCreationInputTokens + t.cacheReadInputTokens) * input
    + t.outputTokens * output

  const searches = t.webSearchRequests * WEB_SEARCH_USD
  return {
    usd: (cached * geo) / MILLION + searches,
    withoutCacheUsd: (uncached * geo) / MILLION + searches,
  }
}

/**
 * An estimate, not a bill. Anthropic's own documentation says the equivalent
 * figures in `/usage` and `total_cost_usd` are client-side estimates, and that
 * they are irrelevant to Max and Pro subscription billing.
 */
export function estimateCost(buckets: RateBucket[]): CostEstimate {
  let usd = 0
  let withoutCacheUsd = 0
  let priced = 0
  const unpricedModels: string[] = []

  for (const bucket of buckets) {
    if (bucket.totals.messages === 0) continue
    const cost = priceBucket(bucket)
    if (!cost) {
      if (!unpricedModels.includes(bucket.model)) unpricedModels.push(bucket.model)
      continue
    }
    usd += cost.usd
    withoutCacheUsd += cost.withoutCacheUsd
    priced++
  }

  return {
    usd: priced > 0 ? usd : null,
    withoutCacheUsd: priced > 0 ? withoutCacheUsd : null,
    unpricedModels,
  }
}

/** Fraction of the window in use, or null when the model or the window is unknown. */
export function occupancyFraction(contextTokens: number | null, model: string | null): number | null {
  const window = contextWindowFor(model)
  if (contextTokens === null || window === null || window <= 0) return null
  return Math.min(contextTokens / window, 1)
}

export function totalTokens(t: TokenTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens
}
