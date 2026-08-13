import type { SpendSummary } from '../shared/types.js'
import { PRICES_VERIFIED_ON } from '@shared/pricing.js'

/** Two decimals under $10, whole dollars above: `$4.20`, `$31`, `$118`. */
function usd(v: number): string {
  return v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-W33` → `W33`; `2026-08` → `Aug`. Unrecognized keys pass through untouched. */
function rollupLabel(key: string): string {
  const w = key.indexOf('W')
  if (w >= 0) return key.slice(w)
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key
}

function Rollups({ label, rollups }: { label: string; rollups: { key: string; usd: number | null }[] }) {
  return (
    <span className="flex gap-3">
      <span className="text-faint">{label}</span>
      {rollups.map(r => (
        <span key={r.key} className="tabular-nums">
          {rollupLabel(r.key)} {r.usd === null ? '—' : usd(r.usd)}
        </span>
      ))}
    </span>
  )
}

function Figure(
  { label, value, lead = false }: { label: string; value: number | null; lead?: boolean },
) {
  // Null is "nothing priceable", not zero (SPEC pricing policy): show n/a.
  return (
    <span className="flex flex-col gap-1 font-mono">
      <span className={`tabular-nums ${lead ? 'text-[22px] text-neutral-200' : 'text-[17px] text-muted'}`}>
        {value === null ? 'n/a' : usd(value)}
      </span>
      <span className="text-[11px] text-faint">{label}</span>
    </span>
  )
}

/**
 * Account spend across registered projects, priced from transcripts. An
 * estimate at list prices, never a bill — the ⓘ caption says so. Hidden until
 * the ledger has priced anything at all. Today leads at instrument size; the
 * longer windows follow smaller.
 */
export function SpendBar({ spend }: { spend: SpendSummary | null }) {
  if (!spend) return null
  // Unpriced-only spend still deserves the band: hiding it would present real
  // spend as "nothing", which the pricing policy forbids.
  const hasData = spend.todayUsd !== null || spend.sevenDayUsd !== null
    || spend.thirtyDayUsd !== null || spend.unpricedModels.length > 0
  if (!hasData) return null
  return (
    <section
      data-testid="spend-bar"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-925 p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono">
        <h2 className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">Spend</h2>
        <span
          className="cursor-help border-b border-dotted border-neutral-600 text-[11px] text-dim"
          title={`Estimated from tokens at API list prices (verified ${PRICES_VERIFIED_ON}). Subscription plans bill differently — this is not a bill.`}
        >
          list-price estimate ⓘ
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-8">
        <Figure label="today" value={spend.todayUsd} lead />
        <Figure label="7d" value={spend.sevenDayUsd} />
        <Figure label="30d" value={spend.thirtyDayUsd} />
        {spend.unpricedModels.length > 0 && (
          <span className="pb-0.5 font-mono text-[11px] text-faint">+ unpriced</span>
        )}
      </div>
      {(spend.weekly.some(r => r.usd !== null) || spend.monthly.some(r => r.usd !== null)) && (
        <div
          data-testid="spend-rollups"
          className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-dim"
        >
          <Rollups label="wk" rollups={spend.weekly} />
          <Rollups label="mo" rollups={spend.monthly} />
        </div>
      )}
    </section>
  )
}
