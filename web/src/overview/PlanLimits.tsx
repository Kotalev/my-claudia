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

/**
 * One plan window as an instrument: the percentage is the big tabular figure,
 * the meter beneath it carries threshold ticks at 75% and 90%, and the fill
 * turns amber once usage crosses 80%.
 */
function Window({ label, window: w }: { label: string; window: RateLimitWindow }) {
  if (isExpired(w)) {
    return (
      <div className="flex flex-1 flex-col gap-2 font-mono">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] text-dim">—</span>
          <span className="text-[11px] text-faint">{label} window</span>
        </div>
        <span className="text-[11px] text-dim">window reset — no reading since</span>
      </div>
    )
  }
  const tight = w.usedPercentage > 80
  return (
    <div className="flex flex-1 flex-col gap-2 font-mono">
      <div className="flex items-baseline gap-2">
        <span className={`text-[22px] tabular-nums ${tight ? 'text-alarm' : 'text-neutral-200'}`}>
          {Math.round(w.usedPercentage)}%
        </span>
        <span className="text-[11px] text-faint">{label} window</span>
        <span className="text-[11px] text-dim">{resetLabel(w.resetsAt)}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-neutral-875">
        <div
          className={`h-full rounded-full ${tight ? 'bg-alarm' : 'bg-info'}`}
          style={{ width: `${Math.min(Math.max(w.usedPercentage, 1), 100)}%` }}
        />
        <span aria-hidden="true" className="absolute inset-y-0 left-3/4 w-px bg-neutral-700" />
        <span aria-hidden="true" className="absolute inset-y-0 left-[90%] w-px bg-neutral-700" />
      </div>
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
    <section data-testid="plan-limits" className="flex min-w-0 flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-925 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono">
        <h2 className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">Plan</h2>
        <span data-testid="plan-age" className={`text-[11px] ${stale ? 'text-alarm/80' : 'text-dim'}`}>
          {stale ? `last measured ${measuredAgo(limits.updatedAt)} — no session reporting since` : `measured ${measuredAgo(limits.updatedAt)}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-8">
        {limits.fiveHour && <Window label="5h" window={limits.fiveHour} />}
        {limits.sevenDay && <Window label="7d" window={limits.sevenDay} />}
      </div>
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
