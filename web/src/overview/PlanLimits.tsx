import type { PlanLimits as Limits, RateLimitWindow } from '../shared/types.js'

function resetLabel(iso: string | null): string {
  if (iso === null) return ''
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (!Number.isFinite(mins) || mins <= 0) return ''
  if (mins < 60) return `resets in ${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `resets in ${h}h ${mins % 60}m` : `resets in ${Math.floor(h / 24)}d`
}

/** A window whose reset time has passed tells us nothing about now. */
function isExpired(w: RateLimitWindow): boolean {
  return w.resetsAt !== null && Date.parse(w.resetsAt) < Date.now()
}

function Window({ label, window: w }: { label: string; window: RateLimitWindow }) {
  if (isExpired(w)) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-10 shrink-0 text-neutral-500">{label}</span>
        <span className="text-neutral-600">window reset — no reading since</span>
      </div>
    )
  }
  const tight = w.usedPercentage > 80
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 text-neutral-500">{label}</span>
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-neutral-800">
        <span
          className={`block h-full rounded-full ${tight ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.max(w.usedPercentage, 1)}%` }}
        />
      </span>
      <span className={tight ? 'text-amber-400' : 'text-neutral-400'}>
        {Math.round(w.usedPercentage)}%
      </span>
      <span className="text-neutral-600">{resetLabel(w.resetsAt)}</span>
    </div>
  )
}

/**
 * Plan consumption, the number that actually constrains a subscriber. It exists
 * in no file: it arrives only through the statusline hook, so it is absent until
 * that is installed, and absent entirely for API-key users.
 */
export function PlanLimitsBar({ limits }: { limits: Limits | null }) {
  if (!limits || (!limits.fiveHour && !limits.sevenDay)) return null
  const age = Date.now() - Date.parse(limits.updatedAt)
  // These arrive only while a session is running. Once the statusline stops
  // refreshing, the last percentage freezes — saying when it was taken is the
  // difference between a reading and a guess.
  const stale = Number.isFinite(age) && age > 10 * 60_000
  return (
    <section data-testid="plan-limits" className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Plan</h2>
      {limits.fiveHour && <Window label="5h" window={limits.fiveHour} />}
      {limits.sevenDay && <Window label="7d" window={limits.sevenDay} />}
      <span data-testid="plan-age" className={`text-xs ${stale ? 'text-amber-500/80' : 'text-neutral-600'}`}>
        {stale ? `last measured ${measuredAgo(limits.updatedAt)} — no session reporting since` : `measured ${measuredAgo(limits.updatedAt)}`}
      </span>
    </section>
  )
}

function measuredAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return 'at an unknown time'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}
