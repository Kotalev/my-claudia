/**
 * Claude Code's statusline payload. Documented at
 * https://code.claude.com/docs/en/statusline — the only supported source for a
 * subscriber's plan-limit consumption, which appears in no file on disk.
 *
 * Every field is optional here: `rate_limits` is present only for claude.ai auth
 * and absent entirely for API-key users, and the schema grows between releases.
 */
export interface RateLimitWindow {
  usedPercentage: number
  resetsAt: string | null
}

export interface PlanLimits {
  fiveHour: RateLimitWindow | null
  sevenDay: RateLimitWindow | null
  updatedAt: string
}

export interface StatuslineReport {
  sessionId: string | null
  model: string | null
  /** Claude Code's own cost figure for the session. Still a client-side estimate. */
  reportedCostUsd: number | null
  contextTokens: number | null
  contextWindow: number | null
  limits: PlanLimits | null
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function windowOf(v: unknown): RateLimitWindow | null {
  const o = obj(v)
  const used = num(o.used_percentage)
  if (used === null) return null
  return { usedPercentage: Math.max(0, Math.min(used, 100)), resetsAt: str(o.resets_at) }
}

export function parseStatusline(raw: unknown, now = new Date()): StatuslineReport | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return null }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>

  const ctx = obj(o.context_window)
  const rate = obj(o.rate_limits)
  const fiveHour = windowOf(rate.five_hour)
  const sevenDay = windowOf(rate.seven_day)

  return {
    sessionId: str(o.session_id),
    model: str(obj(o.model).id),
    reportedCostUsd: num(obj(o.cost).total_cost_usd),
    contextTokens: num(ctx.total_input_tokens),
    // Never derive a threshold from `exceeds_200k_tokens`: it is a fixed 200k
    // check regardless of the real window, so it is meaningless at 1M.
    contextWindow: num(ctx.context_window_size),
    limits: fiveHour || sevenDay
      ? { fiveHour, sevenDay, updatedAt: now.toISOString() }
      : null,
  }
}
