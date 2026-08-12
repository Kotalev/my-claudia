import type { SessionUsage } from '@shared/types.js'
import { occupancyFraction, contextWindowFor } from '@shared/pricing.js'
import { compactTokens, shortModel, agoLabel } from './usage-format.js'

/**
 * How full the context window is — the number that changes what a person does
 * next, and the one honest headline for a subscriber. It deliberately fails
 * open: an unknown model gets a raw token count and no bar, because a
 * percentage of an assumed window is confidently wrong.
 *
 * Redesigned as an instrument: a wider meter with threshold ticks at 75% and
 * 90% (the compaction weather), and — while the session is working — a
 * shimmer flowing across the fill, so the meter itself says "live".
 */
export function ContextBar(
  { usage, detailed = false, working = false }:
  { usage: SessionUsage; detailed?: boolean; working?: boolean },
) {
  const model = usage.contextModel
  const fraction = occupancyFraction(usage.contextTokens, model)
  const window = contextWindowFor(model)

  if (usage.contextTokens === null) {
    return (
      <span className="font-mono text-[11px] text-faint" data-testid="context-empty">
        — no assistant turn yet
      </span>
    )
  }

  const tight = fraction !== null && fraction > 0.8
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5 font-mono text-[11.5px]" data-testid="context-bar">
      {fraction !== null && (
        <span className="relative h-1.5 w-[140px] shrink-0 overflow-hidden rounded-full bg-neutral-875">
          <span
            data-testid="context-fill"
            className={`relative block h-full overflow-hidden rounded-full ${tight ? 'bg-alarm' : 'bg-info'}`}
            style={{ width: `${Math.max(fraction * 100, 1)}%` }}
          >
            {working && (
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-shimmer bg-linear-to-r from-white/0 via-white/40 to-white/0 bg-size-[220%_100%]"
              />
            )}
          </span>
          {/* Threshold ticks: 75% is the caution mark, 90% means compaction is near. */}
          <span aria-hidden="true" className="absolute inset-y-0 left-3/4 w-px bg-neutral-700" />
          <span aria-hidden="true" className="absolute inset-y-0 left-[90%] w-px bg-neutral-700" />
        </span>
      )}
      <span className={`tabular-nums ${tight ? 'text-alarm' : 'text-muted'}`}>
        {compactTokens(usage.contextTokens)}
        {window !== null && ` / ${compactTokens(window)}`}
      </span>
      {model && (
        <span className="rounded border border-neutral-700 px-1.5 text-muted">{shortModel(model)}</span>
      )}
      {usage.effort && (
        <span className="rounded border border-neutral-700 px-1.5 text-faint">{usage.effort}</span>
      )}
      {detailed && usage.contextAt && (
        <span className="text-dim">measured {agoLabel(usage.contextAt)}</span>
      )}
    </div>
  )
}
