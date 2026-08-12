import { SYNTHETIC_MODEL } from '../../transcript/parse.js'
import type { EntryUsage, TranscriptEntry } from '../../transcript/types.js'
import type { RateBucket, SessionUsage, TokenTotals } from '../../shared/types.js'

export function emptyTotals(): TokenTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
    webSearchRequests: 0, webFetchRequests: 0, messages: 0,
  }
}

/**
 * Whether this entry's usage should be counted at all. `<synthetic>` is not a
 * model and an API error is not a turn — both carry usage blocks that would
 * otherwise be billed to the user.
 */
export function isCountable(entry: TranscriptEntry): boolean {
  return entry.usage !== null && !entry.isApiError && entry.model !== SYNTHETIC_MODEL
}

/**
 * Merges two reports of the same message. Real transcripts almost always repeat
 * a message's usage byte-identically, but not always — 6 of ~50k duplicate pairs
 * on this machine disagreed. Taking the maximum is a no-op for the identical
 * case and correct for the rest, where a later line reports the finished total.
 */
export function maxUsage(a: EntryUsage, b: EntryUsage): EntryUsage {
  return {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    cacheReadInputTokens: Math.max(a.cacheReadInputTokens, b.cacheReadInputTokens),
    cacheCreationInputTokens: Math.max(a.cacheCreationInputTokens, b.cacheCreationInputTokens),
    cacheCreation5mInputTokens: Math.max(a.cacheCreation5mInputTokens, b.cacheCreation5mInputTokens),
    cacheCreation1hInputTokens: Math.max(a.cacheCreation1hInputTokens, b.cacheCreation1hInputTokens),
    thinkingTokens: Math.max(a.thinkingTokens ?? 0, b.thinkingTokens ?? 0) || null,
    webSearchRequests: Math.max(a.webSearchRequests, b.webSearchRequests),
    webFetchRequests: Math.max(a.webFetchRequests, b.webFetchRequests),
    serviceTier: b.serviceTier ?? a.serviceTier,
    inferenceGeo: b.inferenceGeo ?? a.inferenceGeo,
    speed: b.speed ?? a.speed,
  }
}

export function addInto(totals: TokenTotals, u: EntryUsage, sign: 1 | -1): void {
  totals.inputTokens += sign * u.inputTokens
  totals.outputTokens += sign * u.outputTokens
  totals.cacheReadInputTokens += sign * u.cacheReadInputTokens
  totals.cacheCreationInputTokens += sign * u.cacheCreationInputTokens
  totals.cacheCreation5mInputTokens += sign * u.cacheCreation5mInputTokens
  totals.cacheCreation1hInputTokens += sign * u.cacheCreation1hInputTokens
  totals.webSearchRequests += sign * u.webSearchRequests
  totals.webFetchRequests += sign * u.webFetchRequests
  totals.messages += sign
}

/** Everything the session's context window held on the turn this usage describes. */
export function contextTokensOf(u: EntryUsage): number {
  return u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens + u.outputTokens
}

interface Counted { usage: EntryUsage; sidechain: boolean; rate: string }

const SEP = '\u0000'

function rateKeyOf(model: string, u: EntryUsage): string {
  return [model, u.speed ?? '', u.inferenceGeo ?? ''].join(SEP)
}

/**
 * Running usage totals for one session, updated as entries arrive.
 *
 * Accumulating rather than re-summing matters: a long session holds thousands of
 * entries and every transcript write would otherwise re-add all of them. The
 * per-message map is what makes re-reading a line idempotent — the same message
 * seen twice replaces its own contribution instead of doubling it.
 */
export class UsageAccumulator {
  #main = emptyTotals()
  #subagents = emptyTotals()
  #seen = new Map<string, Counted>()
  #models: string[] = []
  #effort: string | null = null
  #byRate = new Map<string, TokenTotals>()
  #contextTokens: number | null = null
  #contextAt: string | null = null
  #contextModel: string | null = null
  #compactions = 0

  add(entry: TranscriptEntry): void {
    if (entry.isCompactBoundary) this.#compactions++
    if (!isCountable(entry) || !entry.usage) return

    if (entry.model && entry.model !== SYNTHETIC_MODEL && !this.#models.includes(entry.model)) {
      this.#models.push(entry.model)
    }
    if (entry.effort) this.#effort = entry.effort

    // The main thread's own last turn is what defines occupancy; a subagent runs
    // in a context window of its own and says nothing about this one.
    if (!entry.isSidechain && entry.role === 'assistant') {
      this.#contextTokens = contextTokensOf(entry.usage)
      this.#contextAt = entry.timestamp
      this.#contextModel = entry.model
    }

    // A line with no message id cannot collide with another; its uuid is unique
    // and the store has already rejected repeats of it.
    const key = entry.messageId ?? entry.uuid
    const rate = rateKeyOf(entry.model ?? 'unknown', entry.usage)
    const prior = this.#seen.get(key)

    if (!prior) {
      this.#seen.set(key, { usage: entry.usage, sidechain: entry.isSidechain, rate })
      addInto(entry.isSidechain ? this.#subagents : this.#main, entry.usage, 1)
      addInto(this.#rateBucket(rate), entry.usage, 1)
      return
    }
    const merged = maxUsage(prior.usage, entry.usage)
    addInto(prior.sidechain ? this.#subagents : this.#main, prior.usage, -1)
    addInto(prior.sidechain ? this.#subagents : this.#main, merged, 1)
    addInto(this.#rateBucket(prior.rate), prior.usage, -1)
    addInto(this.#rateBucket(prior.rate), merged, 1)
    this.#seen.set(key, { usage: merged, sidechain: prior.sidechain, rate: prior.rate })
  }

  #rateBucket(key: string): TokenTotals {
    let bucket = this.#byRate.get(key)
    if (!bucket) { bucket = emptyTotals(); this.#byRate.set(key, bucket) }
    return bucket
  }

  snapshot(): SessionUsage {
    const total = emptyTotals()
    for (const [k, v] of Object.entries(this.#main) as [keyof TokenTotals, number][]) {
      total[k] = v + this.#subagents[k]
    }
    return {
      main: { ...this.#main },
      subagents: { ...this.#subagents },
      total,
      contextTokens: this.#contextTokens,
      contextAt: this.#contextAt,
      contextModel: this.#contextModel,
      models: [...this.#models],
      effort: this.#effort,
      compactions: this.#compactions,
      byRate: [...this.#byRate.entries()].map(([key, totals]): RateBucket => {
        const [model = 'unknown', speed = '', geo = ''] = key.split(SEP)
        return {
          model,
          speed: speed === '' ? null : speed,
          inferenceGeo: geo === '' ? null : geo,
          totals: { ...totals },
        }
      }),
    }
  }
}
