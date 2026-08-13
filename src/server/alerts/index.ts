import type { SessionSummary } from '../../shared/types.js'

/**
 * Injected accessors rather than store imports: the module must be testable
 * with plain functions and must not couple to SessionStore's lifecycle.
 */
export interface AlertDeps {
  getSessions: () => SessionSummary[]
  getFiveHour: () => { usedPercentage: number } | null
}

export interface AlertPayload {
  type: 'waiting' | 'limit'
  /** Human one-liner, so a bare Slack/Discord webhook renders something readable. */
  text: string
  sessionId?: string
  project?: string
  usedPercentage?: number
  at: string
}

export const CHECK_INTERVAL_MS = 30_000
const FETCH_TIMEOUT_MS = 5_000
/** After a failed POST, no attempt of any kind for this long — never retry-storm. */
const FAILURE_COOLDOWN_MS = 60_000
const LIMIT_FIRE_AT = 90
const LIMIT_REARM_BELOW = 80
const DEFAULT_WAITING_MIN = 5

function waitingThresholdMs(): number {
  const raw = Number(process.env.MC_ALERT_WAITING_MIN)
  const min = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WAITING_MIN
  return min * 60_000
}

/** A deps call must never take the alerter down; garbage degrades to "nothing". */
function safeSessions(deps: AlertDeps): SessionSummary[] {
  try {
    const s = deps.getSessions()
    return Array.isArray(s) ? s : []
  } catch {
    return []
  }
}

function safeFiveHour(deps: AlertDeps): number | null {
  try {
    const f = deps.getFiveHour()
    return f && typeof f.usedPercentage === 'number' && Number.isFinite(f.usedPercentage)
      ? f.usedPercentage
      : null
  } catch {
    return null
  }
}

/**
 * Outbound alert webhook. Without MC_WEBHOOK_URL the module is inert: no timer,
 * no state, zero cost. With it, a 30s check fires one alert per waiting episode
 * per session and one per 5h-window crossing, re-arming when the condition
 * clears. Failures are logged once and never thrown.
 */
export function startAlerts(deps: AlertDeps): { stop(): void } {
  const url = process.env.MC_WEBHOOK_URL
  if (!url) return { stop() {} }

  /** Sessions already alerted for their current waiting episode. */
  const alertedWaiting = new Set<string>()
  let limitAlerted = false
  let failedAt = 0

  const post = async (payload: AlertPayload): Promise<boolean> => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      return true
    } catch (err) {
      failedAt = Date.now()
      console.warn(`alerts: webhook POST failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  const check = async (): Promise<void> => {
    const now = Date.now()
    const thresholdMs = waitingThresholdMs()
    // A due alert is marked as sent only after a successful POST, so a failed
    // send does not consume the episode's one alert — it retries after cooldown.
    const due: { payload: AlertPayload; markSent: () => void }[] = []

    for (const session of safeSessions(deps)) {
      if (session.status !== 'waiting') {
        alertedWaiting.delete(session.sessionId)   // episode over — re-arm
        continue
      }
      if (alertedWaiting.has(session.sessionId)) continue
      const since = session.live?.statusUpdatedAt
      if (!since || now - Date.parse(since) < thresholdMs) continue
      const minutes = Math.round((now - Date.parse(since)) / 60_000)
      due.push({
        payload: {
          type: 'waiting',
          text: `Session ${session.sessionId.slice(0, 8)}${session.projectPath ? ` in ${session.projectPath}` : ''} has been waiting for you for ${minutes} min`,
          sessionId: session.sessionId,
          ...(session.projectPath ? { project: session.projectPath } : {}),
          at: new Date(now).toISOString(),
        },
        markSent: () => alertedWaiting.add(session.sessionId),
      })
    }

    const pct = safeFiveHour(deps)
    if (pct !== null) {
      if (pct < LIMIT_REARM_BELOW) limitAlerted = false   // window rolled over — re-arm
      if (pct >= LIMIT_FIRE_AT && !limitAlerted) {
        due.push({
          payload: {
            type: 'limit',
            text: `5h usage window at ${Math.round(pct)}%`,
            usedPercentage: pct,
            at: new Date(now).toISOString(),
          },
          markSent: () => { limitAlerted = true },
        })
      }
    }

    if (failedAt && now - failedAt < FAILURE_COOLDOWN_MS) return
    for (const { payload, markSent } of due) {
      if (!await post(payload)) return   // cooldown started — drop the rest of this batch
      markSent()
    }
  }

  const timer = setInterval(() => { void check() }, CHECK_INTERVAL_MS)
  timer.unref()
  return { stop: () => clearInterval(timer) }
}
