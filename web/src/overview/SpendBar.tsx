import { DollarSign } from 'lucide-react'
import type { SpendSummary } from '../shared/types.js'
import { PRICES_VERIFIED_ON } from '@shared/pricing.js'

/** Two decimals under $10, whole dollars above: `$4.20`, `$31`, `$118`. */
function usd(v: number): string {
  return v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`
}

function Figure({ label, value }: { label: string; value: number | null }) {
  // Null is "nothing priceable", not zero (SPEC pricing policy): show n/a.
  return (
    <span className="text-xs text-muted">
      {label} <span className="text-neutral-100">{value === null ? 'n/a' : usd(value)}</span>
    </span>
  )
}

/**
 * Account spend across registered projects, priced from transcripts. An
 * estimate at list prices, never a bill — the tooltip says so. Hidden until
 * the ledger has priced anything at all.
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
      title={`list prices, verified ${PRICES_VERIFIED_ON}; estimate, not a bill`}
      className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-1"
    >
      <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted"><DollarSign aria-hidden="true" className="size-3.5" />Spend</h2>
      <Figure label="today" value={spend.todayUsd} />
      <span aria-hidden="true" className="text-xs text-faint">·</span>
      <Figure label="7d" value={spend.sevenDayUsd} />
      <span aria-hidden="true" className="text-xs text-faint">·</span>
      <Figure label="30d" value={spend.thirtyDayUsd} />
      {spend.unpricedModels.length > 0 && <span className="text-xs text-faint">+ unpriced</span>}
    </section>
  )
}
