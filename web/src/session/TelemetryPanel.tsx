import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
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
  return <td className="px-2 py-1.5 text-right tabular-nums sm:px-3">{value === 0 ? '—' : compactTokens(value)}</td>
}

/*
 * The honesty stays, the legalese moves into the ⓘ tooltip: Anthropic's own
 * documentation says this figure is irrelevant to Max and Pro billing, so the
 * qualifier must exist — but as a hover, not three lines of body copy.
 */
const COST_QUALIFIER =
  `Estimated from tokens at API list prices (checked ${PRICES_VERIFIED_ON}). `
  + 'Subscription plans bill differently — this is what these tokens would cost '
  + 'pay-as-you-go, not what you were charged.'

function Cost({ usage, reportedCostUsd }: { usage: SessionUsage; reportedCostUsd: number | null }) {
  const cost = estimateCost(usage.byRate)
  if (cost.usd === null) {
    return (
      <p className="font-mono text-[11.5px] text-faint">
        No cost estimate: {cost.unpricedModels.length > 0
          ? `no price on file for ${cost.unpricedModels.map(shortModel).join(', ')}`
          : 'nothing priceable in this session yet'}
      </p>
    )
  }

  const saved = cost.withoutCacheUsd !== null ? cost.withoutCacheUsd - cost.usd : null
  return (
    <div className="space-y-2.5 font-mono">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span data-testid="cost-usd" className="text-xl tabular-nums text-neutral-200">{money(cost.usd)}</span>
        <span className="text-[11.5px] text-faint">pay-as-you-go equivalent</span>
        <span
          className="cursor-help border-b border-dotted border-neutral-600 text-[11px] text-dim"
          title={COST_QUALIFIER}
        >
          how this is estimated ⓘ
        </span>
      </p>
      {cost.withoutCacheUsd !== null && (
        <p className="flex flex-wrap items-center gap-2.5 text-[11.5px]">
          {saved !== null && saved > 0 && (
            <>
              <span className="text-work">caching saved {money(saved).replace('≈ ', '')}</span>
              <span aria-hidden="true" className="text-neutral-600">·</span>
            </>
          )}
          <span className="text-muted">{money(cost.withoutCacheUsd)} without prompt caching</span>
        </p>
      )}
      {cost.withoutCacheUsd !== null && cost.withoutCacheUsd > 0 && (
        // The counterfactual as a meter: the filled span is what was paid, the
        // rest is what caching absorbed.
        <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-neutral-875">
          <span
            className="h-full bg-info"
            style={{ width: `${Math.max(Math.min(cost.usd / cost.withoutCacheUsd, 1) * 100, 2)}%` }}
          />
          <span className="h-full flex-1 bg-info/20" />
        </div>
      )}
      {reportedCostUsd !== null && (
        <p className="text-[11px] text-dim">
          {money(reportedCostUsd)} is Claude Code's own figure for this session — also an estimate.
        </p>
      )}
      {cost.unpricedModels.length > 0 && (
        <p className="text-[11px] text-alarm/80">
          Excludes {cost.unpricedModels.map(shortModel).join(', ')} — no price on file.
        </p>
      )}
    </div>
  )
}

export function TelemetryPanel(
  { usage, truncated, reportedCostUsd, working = false }:
  { usage: SessionUsage; truncated: boolean; reportedCostUsd: number | null; working?: boolean },
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
    <details
      data-testid="telemetry"
      open={openByDefault}
      className="group mb-4 rounded-[10px] border border-neutral-800 bg-neutral-925"
    >
      <summary className="flex items-center gap-2.5 px-4 py-2.5 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
        <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
        Context and cost
      </summary>
      <div className="grid min-w-0 grid-cols-1 gap-x-7 gap-y-5 px-4 pt-2 pb-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2.5">
          <ContextBar usage={usage} detailed working={working} />
          {usage.compactions > 0 && (
            <p className="font-mono text-[11px] text-dim">
              {usage.compactions} compaction{usage.compactions === 1 ? '' : 's'} — earlier turns were
              summarised away, which is why the bar can fall.
            </p>
          )}
          {usage.models.length > 1 && (
            <p className="font-mono text-[11px] text-dim">
              Models used: {usage.models.map(shortModel).join(' → ')}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <Cost usage={usage} reportedCostUsd={reportedCostUsd} />
        </div>

        <div className="min-w-0 border-t border-neutral-875 pt-3.5 md:col-span-2">
          {/* The table's min-content is wider than a 390px viewport, and w-full
              cannot shrink a table below that — so it used to widen the document
              itself. It scrolls in its own box; the page does not. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] font-mono text-xs text-muted">
              <thead className="text-[11px] text-faint">
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
                    <tr
                      key={label}
                      className={label === 'total'
                        ? 'border-t border-neutral-700 text-neutral-200'
                        : 'border-t border-neutral-875'}
                    >
                      <td className="px-2 py-1.5 text-left sm:px-3">{label}</td>
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
            <p className="mt-1 px-2 font-mono text-[11px] text-dim sm:px-3">
              Counts cover only the part of the transcript that was loaded.
            </p>
          )}
        </div>
      </div>
    </details>
  )
}
