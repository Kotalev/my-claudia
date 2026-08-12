import { useState } from 'react'
import { ChevronRight, CircleDollarSign, Gauge } from 'lucide-react'
import type { SessionUsage, TokenTotals } from '@shared/types.js'
import { estimateCost, PRICES_VERIFIED_ON } from '@shared/pricing.js'
import { ContextBar } from '../shared/ContextBar.js'
import { compactTokens, money, shortModel } from '../shared/usage-format.js'

const ROWS: { label: string; pick: (u: SessionUsage) => TokenTotals }[] = [
  { label: 'main thread', pick: u => u.main },
  { label: 'subagents', pick: u => u.subagents },
  { label: 'total', pick: u => u.total },
]

function Cell({ value }: { value: number }) {
  return <td className="px-2 py-1 text-right tabular-nums sm:px-3">{value === 0 ? '—' : compactTokens(value)}</td>
}

function Cost({ usage }: { usage: SessionUsage }) {
  const cost = estimateCost(usage.byRate)
  if (cost.usd === null) {
    return (
      <p className="text-xs text-faint">
        No cost estimate: {cost.unpricedModels.length > 0
          ? `no price on file for ${cost.unpricedModels.map(shortModel).join(', ')}`
          : 'nothing priceable in this session yet'}
      </p>
    )
  }

  const saved = cost.withoutCacheUsd !== null ? cost.withoutCacheUsd - cost.usd : null
  return (
    <div className="space-y-1">
      <p className="text-sm">
        <span data-testid="cost-usd" className="font-medium text-neutral-100">{money(cost.usd)}</span>
        <span className="ml-2 text-xs text-faint">pay-as-you-go equivalent</span>
      </p>
      {cost.withoutCacheUsd !== null && (
        <p className="text-xs text-faint">
          {money(cost.withoutCacheUsd)} without prompt caching
          {saved !== null && saved > 0 && ` — caching saved ${money(saved).replace('≈ ', '')}`}
        </p>
      )}
      {/*
        Not a footnote and not a tooltip. Anthropic's own documentation says this
        figure is irrelevant to Max and Pro billing, and the user is on a
        subscription: a bare dollar amount here would be read as a bill.
      */}
      <p className="text-xs leading-snug text-faint">
        Estimated from tokens at API list prices (checked {PRICES_VERIFIED_ON}). Subscription plans
        bill differently — this is what these tokens would cost pay-as-you-go, not what you were charged.
      </p>
      {cost.unpricedModels.length > 0 && (
        <p className="text-xs text-amber-500/80">
          Excludes {cost.unpricedModels.map(shortModel).join(', ')} — no price on file.
        </p>
      )}
    </div>
  )
}

export function TelemetryPanel(
  { usage, truncated, reportedCostUsd }:
  { usage: SessionUsage; truncated: boolean; reportedCostUsd: number | null },
) {
  // This panel sits in the non-scrolling part of the screen, so on a narrow
  // viewport an always-open one leaves the transcript about three visible
  // lines. Read once at mount rather than on resize: reopening a panel the
  // reader has just closed because the window changed width is worse than
  // being one breakpoint stale.
  const [openByDefault] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches,
  )

  return (
    // Collapsible because it now lives in the non-scrolling part of the screen:
    // on a 390px viewport an always-open panel would leave the transcript a
    // couple of visible lines.
    <details
      data-testid="telemetry"
      open={openByDefault}
      className="group mb-4 rounded-lg border border-neutral-800 bg-neutral-900/40"
    >
      <summary className="flex items-center gap-2 px-4 py-2 text-xs font-semibold tracking-wide uppercase text-muted">
        <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
        Context and cost
      </summary>
      <div className="grid min-w-0 grid-cols-1 gap-4 px-4 pt-1 pb-3 md:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted"><Gauge aria-hidden="true" className="size-3.5" />Context</h2>
        <ContextBar usage={usage} detailed />
        {usage.compactions > 0 && (
          <p className="text-xs text-faint">
            {usage.compactions} compaction{usage.compactions === 1 ? '' : 's'} — earlier turns were
            summarised away, which is why the bar can fall.
          </p>
        )}
        {usage.models.length > 1 && (
          <p className="text-xs text-faint">
            Models used: {usage.models.map(shortModel).join(' → ')}
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-muted"><CircleDollarSign aria-hidden="true" className="size-3.5" />Cost</h2>
        <Cost usage={usage} />
        {reportedCostUsd !== null && (
          <p className="text-xs text-faint">
            {money(reportedCostUsd)} is Claude Code's own figure for this session —
            also an estimate at list prices, and also not what a subscription is charged.
          </p>
        )}
      </div>

      <div className="min-w-0 md:col-span-2">
        {/* The table's min-content is wider than a 390px viewport, and w-full
            cannot shrink a table below that — so it used to widen the document
            itself. It scrolls in its own box; the page does not. */}
        <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-xs text-muted">
          <thead className="text-faint">
            <tr>
              <th className="px-2 py-1 text-left font-normal whitespace-nowrap sm:px-3">tokens</th>
              <th className="px-2 py-1 text-right font-normal whitespace-nowrap sm:px-3">input</th>
              <th className="px-2 py-1 text-right font-normal whitespace-nowrap sm:px-3">output</th>
              <th className="px-2 py-1 text-right font-normal whitespace-nowrap sm:px-3">cache read</th>
              <th className="px-2 py-1 text-right font-normal whitespace-nowrap sm:px-3">cache write</th>
              <th className="px-2 py-1 text-right font-normal whitespace-nowrap sm:px-3">msgs</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ label, pick }) => {
              const t = pick(usage)
              return (
                <tr key={label} className={label === 'total' ? 'border-t border-neutral-800 text-neutral-200' : ''}>
                  <td className="px-2 py-1 text-left sm:px-3">{label}</td>
                  <Cell value={t.inputTokens} />
                  <Cell value={t.outputTokens} />
                  <Cell value={t.cacheReadInputTokens} />
                  <Cell value={t.cacheCreationInputTokens} />
                  <Cell value={t.messages} />
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        {/* Outside the scroll box on purpose: a caveat that can scroll out of
            sight is a caveat that was not made. */}
        {truncated && (
          <p className="mt-1 px-2 text-xs text-faint sm:px-3">
            Counts cover only the part of the transcript that was loaded.
          </p>
        )}
      </div>
      </div>
    </details>
  )
}
