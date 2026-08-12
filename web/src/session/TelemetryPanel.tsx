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
  return <td className="px-3 py-1 text-right tabular-nums">{value === 0 ? '—' : compactTokens(value)}</td>
}

function Cost({ usage }: { usage: SessionUsage }) {
  const cost = estimateCost(usage.byRate)
  if (cost.usd === null) {
    return (
      <p className="text-xs text-neutral-500">
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
        <span className="ml-2 text-xs text-neutral-500">pay-as-you-go equivalent</span>
      </p>
      {cost.withoutCacheUsd !== null && (
        <p className="text-xs text-neutral-500">
          {money(cost.withoutCacheUsd)} without prompt caching
          {saved !== null && saved > 0 && ` — caching saved ${money(saved).replace('≈ ', '')}`}
        </p>
      )}
      {/*
        Not a footnote and not a tooltip. Anthropic's own documentation says this
        figure is irrelevant to Max and Pro billing, and the user is on a
        subscription: a bare dollar amount here would be read as a bill.
      */}
      <p className="text-[11px] leading-snug text-neutral-600">
        Estimated from tokens at API list prices (checked {PRICES_VERIFIED_ON}). Subscription plans
        bill differently — this is what these tokens would cost pay-as-you-go, not what you were charged.
      </p>
      {cost.unpricedModels.length > 0 && (
        <p className="text-[11px] text-amber-500/80">
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
  return (
    <section
      data-testid="telemetry"
      className="mb-4 grid gap-4 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 md:grid-cols-2"
    >
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Context</h2>
        <ContextBar usage={usage} detailed />
        {usage.compactions > 0 && (
          <p className="text-xs text-neutral-500">
            {usage.compactions} compaction{usage.compactions === 1 ? '' : 's'} — earlier turns were
            summarised away, which is why the bar can fall.
          </p>
        )}
        {usage.models.length > 1 && (
          <p className="text-xs text-neutral-500">
            Models used: {usage.models.map(shortModel).join(' → ')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Cost</h2>
        <Cost usage={usage} />
        {reportedCostUsd !== null && (
          <p className="text-xs text-neutral-500">
            {money(reportedCostUsd)} is Claude Code's own figure for this session —
            also an estimate at list prices, and also not what a subscription is charged.
          </p>
        )}
      </div>

      <div className="md:col-span-2">
        <table className="w-full text-xs text-neutral-400">
          <thead className="text-neutral-600">
            <tr>
              <th className="px-3 py-1 text-left font-normal">tokens</th>
              <th className="px-3 py-1 text-right font-normal">input</th>
              <th className="px-3 py-1 text-right font-normal">output</th>
              <th className="px-3 py-1 text-right font-normal">cache read</th>
              <th className="px-3 py-1 text-right font-normal">cache write</th>
              <th className="px-3 py-1 text-right font-normal">msgs</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ label, pick }) => {
              const t = pick(usage)
              return (
                <tr key={label} className={label === 'total' ? 'border-t border-neutral-800 text-neutral-200' : ''}>
                  <td className="px-3 py-1 text-left">{label}</td>
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
        {truncated && (
          <p className="mt-1 px-3 text-[11px] text-neutral-600">
            Counts cover only the part of the transcript that was loaded.
          </p>
        )}
      </div>
    </section>
  )
}
