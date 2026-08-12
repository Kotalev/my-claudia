import type { SessionUsage } from '@shared/types.js'
import { occupancyFraction, contextWindowFor } from '@shared/pricing.js'
import { compactTokens, shortModel, agoLabel } from './usage-format.js'

/**
 * How full the context window is — the number that changes what a person does
 * next, and the one honest headline for a subscriber. It deliberately fails
 * open: an unknown model gets a raw token count and no bar, because a
 * percentage of an assumed window is confidently wrong.
 */
export function ContextBar(
  { usage, detailed = false }: { usage: SessionUsage; detailed?: boolean },
) {
  const model = usage.contextModel
  const fraction = occupancyFraction(usage.contextTokens, model)
  const window = contextWindowFor(model)

  if (usage.contextTokens === null) {
    return (
      <span className="text-xs text-neutral-600" data-testid="context-empty">
        — no assistant turn yet
      </span>
    )
  }

  const tight = fraction !== null && fraction > 0.8
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="context-bar">
      {fraction !== null && (
        <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-neutral-800">
          <span
            data-testid="context-fill"
            className={`block h-full rounded-full ${tight ? 'bg-amber-500' : 'bg-sky-500'}`}
            style={{ width: `${Math.max(fraction * 100, 1)}%` }}
          />
        </span>
      )}
      <span className={tight ? 'text-amber-400' : 'text-neutral-400'}>
        {compactTokens(usage.contextTokens)}
        {window !== null && ` / ${compactTokens(window)}`}
      </span>
      {model && <span className="text-neutral-500">{shortModel(model)}</span>}
      {usage.effort && <span className="text-neutral-600">{usage.effort}</span>}
      {detailed && usage.contextAt && (
        <span className="text-neutral-600">measured {agoLabel(usage.contextAt)}</span>
      )}
    </div>
  )
}
