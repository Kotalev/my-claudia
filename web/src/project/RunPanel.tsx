import { ChevronRight, Square } from 'lucide-react'
import { money } from '../shared/usage-format.js'
import { useEffect, useRef } from 'react'
import type { RunHandle } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'

const STATUS_STYLES: Record<string, string> = {
  running: 'text-emerald-400',
  succeeded: 'text-muted',
  failed: 'text-red-400',
  cancelled: 'text-amber-400',
}

export function RunPanel(
  { run, output, onCancel, collapsed = false }:
  { run: RunHandle; output: string; onCancel: (runId: string) => void; collapsed?: boolean },
) {
  const log = useRef<HTMLPreElement>(null)

  // The old sentinel `<div>` inside the <pre> called scrollIntoView() on every
  // chunk, which scrolls *all* scrollable ancestors including the window — a
  // chatty run yanked the page back up while the user was clicking task cards.
  // Scroll the log box only, and only if the reader is already at the bottom.
  useEffect(() => {
    const el = log.current
    if (!el || collapsed) return
    // The effect runs post-commit, so scrollHeight already includes the new
    // line; the threshold must be at least one line-height.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 32) el.scrollTop = el.scrollHeight
  }, [output, collapsed])

  const header = (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <span className="font-mono text-muted">{run.taskId}</span>
      <span data-testid="run-status" role="status" className={STATUS_STYLES[run.status] ?? 'text-faint'}>
        {run.status}
      </span>
      {run.sessionId && <span className="min-w-0 truncate font-mono text-muted">{run.sessionId}</span>}
      {run.costUsd !== null && (
        <span data-testid="run-cost" className="shrink-0 text-muted">
          {money(run.costUsd)}
          {run.numTurns !== null && ` · ${run.numTurns} turns`}
          <span className="text-faint"> reported by claude</span>
        </span>
      )}
      {run.endedAt === null && (
        <button
          onClick={() => onCancel(run.runId)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 ${FOCUS_RING}`}
        >
          <Square aria-hidden="true" className="size-3" />
          Cancel
        </button>
      )}
    </div>
  )

  const body = (
    <pre
      ref={log}
      className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-muted"
    >
      {output || '(waiting for output…)'}
    </pre>
  )

  return (
    <section
      data-testid="run-panel"
      aria-label={`Run ${run.taskId}`}
      className="rounded-xl border border-neutral-800 bg-neutral-900/60"
    >
      {collapsed
        ? (
            <details className="group">
              <summary className={`flex list-none items-center border-b border-neutral-800 pl-2 ${FOCUS_RING}`}>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-faint transition-transform group-open:rotate-90" />
                {header}
              </summary>
              {body}
            </details>
          )
        : (
            <>
              <div className="border-b border-neutral-800">{header}</div>
              {body}
            </>
          )}
    </section>
  )
}
