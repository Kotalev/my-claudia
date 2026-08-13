import { CircleAlert, GitMerge, Hourglass, MessageCircleQuestion, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PendingReview, ProjectRecord, QueuedDispatch, RunHandle, SessionSummary } from '../shared/types.js'
import { elapsed } from '../shared/format.js'
import { FOCUS_RING } from '../shared/focus.js'
import { buildAttentionItems } from './attention.js'
import type { AttentionKind } from './attention.js'

const KIND_STYLE: Record<AttentionKind, { icon: LucideIcon; tag: string; color: string }> = {
  'waiting-session': { icon: MessageCircleQuestion, tag: 'waiting', color: 'text-alarm' },
  'awaiting-input': { icon: MessageCircleQuestion, tag: 'run needs input', color: 'text-alarm' },
  'stalled-run': { icon: CircleAlert, tag: 'run stalled', color: 'text-alarm' },
  'pending-review': { icon: GitMerge, tag: 'review', color: 'text-info' },
  'failed-run': { icon: XCircle, tag: 'run failed', color: 'text-danger' },
  'stuck-queue': { icon: Hourglass, tag: 'queued', color: 'text-muted' },
}

/**
 * One band with everything waiting on a human, longest-waiting on top. Built
 * client-side from state the socket already carries; renders nothing at all
 * when nothing needs anyone. Permission prompts keep their own card above.
 */
export function AttentionInbox(
  { sessions, runs, queue, reviews, projects, onOpenSession, onOpenProject }:
  {
    sessions: SessionSummary[]
    runs: RunHandle[]
    queue: QueuedDispatch[]
    reviews: PendingReview[]
    projects: ProjectRecord[]
    onOpenSession: (id: string) => void
    onOpenProject: (id: string) => void
  },
) {
  const items = buildAttentionItems({ sessions, runs, queue, reviews, now: Date.now() })
  if (items.length === 0) return null

  const projectName = (id: string | null): string | null =>
    id === null ? null : projects.find(p => p.id === id)?.name ?? null

  return (
    <section className="mb-8" data-testid="attention-inbox">
      <div className="mb-2 flex items-baseline gap-2.5 px-1">
        <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
          attention
        </h2>
        <span
          data-testid="attention-count"
          className="rounded-full border border-alarm/30 bg-alarm/10 px-2 py-px font-mono text-[10.5px] text-alarm"
        >
          {items.length} need{items.length === 1 ? 's' : ''} you
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map(item => {
          const { icon: Icon, tag, color } = KIND_STYLE[item.kind]
          const name = projectName(item.projectId)
          const open = item.sessionId !== null
            ? () => onOpenSession(item.sessionId!)
            : item.projectId !== null
              ? () => onOpenProject(item.projectId!)
              : null
          const row = (
            <>
              <Icon aria-hidden="true" className={`mt-px size-3.5 shrink-0 ${color}`} />
              <span className={`shrink-0 font-mono text-[10.5px] tracking-[0.1em] uppercase ${color}`}>
                {tag}
              </span>
              {name && (
                <span className="max-w-48 shrink-0 truncate font-mono text-[11.5px] text-faint">
                  {name}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-neutral-100">
                {item.label}
              </span>
              <span className={`shrink-0 font-mono text-[11px] ${color}`}>
                {elapsed(item.since)}
              </span>
            </>
          )
          const surface = 'flex w-full items-center gap-2.5 rounded-[9px] border border-neutral-800 bg-neutral-900 px-4 py-2.5'
          return open !== null
            ? (
                <button
                  key={item.key}
                  type="button"
                  data-testid="attention-item"
                  onClick={open}
                  className={`${surface} transition hover:border-neutral-700 ${FOCUS_RING}`}
                >
                  {row}
                </button>
              )
            // Nothing to open for an unregistered project, so not a control.
            : <div key={item.key} data-testid="attention-item" className={surface}>{row}</div>
        })}
      </div>
    </section>
  )
}
