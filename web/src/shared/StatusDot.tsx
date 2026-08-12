import type { SessionStatus } from './types.js'
import { STATUS_LABELS, STATUS_STYLES } from './format.js'

/**
 * The status dot and its name. Status was colour-only in two of its three
 * render sites, and amber-vs-emerald — waiting vs working — is exactly the
 * pair a red-green deficiency collapses.
 *
 * `labelled` is for callers that already print STATUS_LABELS as visible text;
 * they get the dot without a duplicate announcement. `sr-only` is absolutely
 * positioned, so it stays out of flex flow and adds no gap.
 */
export function StatusDot(
  { status, labelled = false, className = '' }:
  { status: SessionStatus; labelled?: boolean; className?: string },
) {
  return (
    <>
      <span
        aria-hidden="true"
        title={STATUS_LABELS[status]}
        className={`size-2 shrink-0 rounded-full ${STATUS_STYLES[status]} ${className}`}
      />
      {!labelled && <span className="sr-only">{STATUS_LABELS[status]}</span>}
    </>
  )
}
