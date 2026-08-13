import { describe, expect, it } from 'vitest'
import type { SessionUsage, TokenTotals } from '../../shared/types.js'
import { CONTEXT_WARN_FRACTION, contextPressure } from '../../shared/ContextBar.js'

function zeros(): TokenTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0,
    webSearchRequests: 0, webFetchRequests: 0, messages: 0,
  }
}

/** claude-fable-5 has a 1M window, so contextTokens map directly to fractions. */
function usage(over: { contextTokens?: number | null, contextModel?: string | null } = {}): SessionUsage {
  return {
    main: zeros(),
    subagents: zeros(),
    total: zeros(),
    contextTokens: over.contextTokens ?? null,
    contextAt: null,
    contextModel: 'contextModel' in over ? over.contextModel ?? null : 'claude-fable-5',
    models: [],
    effort: null,
    compactions: 0,
    byRate: [],
  }
}

describe('contextPressure', () => {
  it('warns at exactly the threshold and above', () => {
    expect(contextPressure(usage({ contextTokens: CONTEXT_WARN_FRACTION * 1_000_000 }))).toBe(true)
    expect(contextPressure(usage({ contextTokens: 999_999 }))).toBe(true)
  })

  it('stays quiet just below the threshold', () => {
    expect(contextPressure(usage({ contextTokens: CONTEXT_WARN_FRACTION * 1_000_000 - 1 }))).toBe(false)
    expect(contextPressure(usage({ contextTokens: 0 }))).toBe(false)
  })

  it('never warns when occupancy is unknown', () => {
    // No assistant turn yet: no tokens to measure.
    expect(contextPressure(usage({ contextTokens: null }))).toBe(false)
    // A model we hold no window for: a fraction of an assumed window is wrong.
    expect(contextPressure(usage({ contextTokens: 950_000, contextModel: 'some-future-model' }))).toBe(false)
    expect(contextPressure(usage({ contextTokens: 950_000, contextModel: null }))).toBe(false)
  })
})
