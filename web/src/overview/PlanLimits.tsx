import type { PlanLimits as Limits, RateLimitWindow } from '../shared/types.js'

function resetLabel(iso: string | null): string {
  if (iso === null) return ''
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (!Number.isFinite(mins) || mins <= 0) return ''
  if (mins < 60) return `resets in ${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `resets in ${h}h ${mins % 60}m` : `resets in ${Math.floor(h / 24)}d`
}

function Window({ label, window: w }: { label: string; window: RateLimitWindow }) {
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
  return (
    <section data-testid="plan-limits" className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Plan</h2>
      {limits.fiveHour && <Window label="5h" window={limits.fiveHour} />}
      {limits.sevenDay && <Window label="7d" window={limits.sevenDay} />}
    </section>
  )
}
