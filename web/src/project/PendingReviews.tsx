import { GitBranch, GitPullRequestDraft } from 'lucide-react'
import type { PendingReview } from '../shared/types.js'
import { elapsed } from '../shared/format.js'
import { ReviewControls } from './ReviewControls.js'

/**
 * The project's review backlog: finished worktree runs — from this server
 * process or a previous one — whose changes are neither merged nor discarded.
 * Historical items render identically to live ones; the endpoints behind the
 * controls fall back to the history row on their own.
 */
export function PendingReviews({ reviews }: { reviews: PendingReview[] }) {
  if (reviews.length === 0) return null
  return (
    <section aria-label="Pending review" className="space-y-2">
      <h2 className="flex items-center gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
        <GitPullRequestDraft aria-hidden="true" className="size-3.5" />
        Pending review
        <span className="text-[11px] font-normal tracking-normal normal-case text-alarm">{reviews.length}</span>
      </h2>
      {reviews.map(r => (
        <div
          key={r.runId}
          data-testid="pending-review"
          className="rounded-[10px] border border-dashed border-neutral-800 bg-neutral-900/60 px-3.5 py-2.5 font-mono text-[11.5px]"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[10.5px] tracking-[0.12em] uppercase text-alarm">unmerged</span>
            <span className="inline-flex min-w-0 items-center gap-1 text-muted">
              <GitBranch aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{r.branch}</span>
            </span>
            {r.taskId && <span className="text-faint">{r.taskId}</span>}
            {r.loopId !== null && (
              <span className="rounded-[4px] border border-neutral-700 px-1.5 py-0.5 text-[10px] tracking-[0.08em] uppercase text-dim">
                loop
              </span>
            )}
            {r.source === 'history' && (
              <span className="rounded-[4px] border border-neutral-700 px-1.5 py-0.5 text-[10px] tracking-[0.08em] uppercase text-dim">
                earlier server run
              </span>
            )}
            <span className="text-dim">finished {r.endedAt !== null ? `${elapsed(r.endedAt)} ago` : '—'}</span>
          </div>
          <ReviewControls runId={r.runId} />
        </div>
      ))}
    </section>
  )
}
