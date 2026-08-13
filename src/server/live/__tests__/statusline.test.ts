import { describe, it, expect } from 'vitest'
import { parseStatusline } from '../statusline.js'

const REAL = {
  session_id: '13f5f648-f06d-47c9-b4ab-80730e9c0325',
  model: { id: 'claude-opus-5', display_name: 'Opus 5' },
  cost: { total_cost_usd: 4.2137, total_duration_ms: 1000 },
  context_window: {
    total_input_tokens: 221_000, context_window_size: 1_000_000, used_percentage: 22.1,
  },
  exceeds_200k_tokens: true,
  rate_limits: {
    five_hour: { used_percentage: 43.5, resets_at: '2026-08-12T15:00:00.000Z' },
    seven_day: { used_percentage: 12, resets_at: '2026-08-18T00:00:00.000Z' },
  },
}

describe('parseStatusline', () => {
  it('reads a real payload', () => {
    const r = parseStatusline(REAL)!
    expect(r).toMatchObject({
      sessionId: '13f5f648-f06d-47c9-b4ab-80730e9c0325',
      model: 'claude-opus-5',
      reportedCostUsd: 4.2137,
      contextTokens: 221_000,
      contextWindow: 1_000_000,
    })
    expect(r.limits?.fiveHour).toEqual({ usedPercentage: 43.5, resetsAt: '2026-08-12T15:00:00.000Z' })
    expect(r.limits?.sevenDay?.usedPercentage).toBe(12)
  })

  it('accepts a json string as well as an object', () => {
    expect(parseStatusline(JSON.stringify(REAL))?.sessionId).toBe(REAL.session_id)
  })

  it('reports no limits for an api-key user, where the block is absent', () => {
    const { rate_limits: _omitted, ...rest } = REAL
    const r = parseStatusline(rest)!
    expect(r.limits).toBeNull()
    expect(r.reportedCostUsd).toBe(4.2137)   // the rest still works
  })

  it('keeps a partial rate_limits block', () => {
    const r = parseStatusline({ ...REAL, rate_limits: { five_hour: { used_percentage: 90 } } })!
    expect(r.limits?.fiveHour).toEqual({ usedPercentage: 90, resetsAt: null })
    expect(r.limits?.sevenDay).toBeNull()
  })

  it('accepts resets_at as epoch seconds — the shape Claude Code actually sends', () => {
    // Observed live 2026-08-12: {"five_hour":{"used_percentage":6,"resets_at":1786581000}}
    const r = parseStatusline({ rate_limits: { five_hour: { used_percentage: 6, resets_at: 1786581000 } } })!
    expect(r.limits?.fiveHour?.resetsAt).toBe('2026-08-13T00:30:00.000Z')
  })

  it('accepts resets_at as epoch milliseconds', () => {
    const r = parseStatusline({ rate_limits: { five_hour: { used_percentage: 6, resets_at: 1786581000_000 } } })!
    expect(r.limits?.fiveHour?.resetsAt).toBe('2026-08-13T00:30:00.000Z')
  })

  it('drops an unusable resets_at number', () => {
    const r = parseStatusline({ rate_limits: { five_hour: { used_percentage: 6, resets_at: NaN } } })!
    expect(r.limits?.fiveHour?.resetsAt).toBeNull()
  })

  it('clamps a percentage outside 0..100', () => {
    const r = parseStatusline({ rate_limits: { five_hour: { used_percentage: 140 } } })!
    expect(r.limits?.fiveHour?.usedPercentage).toBe(100)
  })

  it('degrades to null for anything unusable', () => {
    expect(parseStatusline('not json')).toBeNull()
    expect(parseStatusline(null)).toBeNull()
    expect(parseStatusline([1, 2])).toBeNull()
    expect(parseStatusline(42)).toBeNull()
  })

  it('survives an empty object, reporting nothing rather than zeros', () => {
    const r = parseStatusline({})!
    expect(r).toMatchObject({
      sessionId: null, model: null, reportedCostUsd: null, contextTokens: null, limits: null,
    })
  })

  it('ignores wrong-typed fields instead of coercing them', () => {
    const r = parseStatusline({
      session_id: 42, cost: { total_cost_usd: 'free' }, context_window: 'wide',
      rate_limits: { five_hour: { used_percentage: 'lots' } },
    })!
    expect(r.sessionId).toBeNull()
    expect(r.reportedCostUsd).toBeNull()
    expect(r.contextTokens).toBeNull()
    expect(r.limits).toBeNull()
  })
})
