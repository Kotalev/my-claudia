import { ChevronRight, Square } from 'lucide-react'
import { money } from '../shared/usage-format.js'
import { useEffect, useRef } from 'react'
import type { RunHandle, RunStatus } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'

const STATUS_TEXT: Record<RunStatus, string> = {
  running: 'text-work',
  succeeded: 'text-muted',
  failed: 'text-danger',
  cancelled: 'text-alarm',
}

/**
 * A dispatched `claude -p` run. While it streams it is a "working" element:
 * green-tinted surface, an orbiting indicator, and a block caret at the end of
 * the log. Finished runs are static and collapse behind a summary line.
 */
export function RunPanel(
  { run, output, onCancel, collapsed = false }:
  { run: RunHandle; output: string; onCancel: (runId: string) => void; collapsed?: boolean },
) {
  const log = useRef<HTMLPreElement>(null)
  const running = run.status === 'running'

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
    <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 font-mono text-[11.5px]">
      {running && (
        <span aria-hidden="true" className="relative size-3 shrink-0">
          <span className="absolute -inset-[3px] animate-orbit rounded-full border-[1.5px] border-transparent border-t-work" />
          <span className="absolute top-1/2 left-1/2 size-[7px] -translate-1/2 rounded-full bg-work" />
        </span>
      )}
      <span
        data-testid="run-status"
        role="status"
        className={`text-[10.5px] tracking-[0.12em] uppercase ${STATUS_TEXT[run.status] ?? 'text-faint'}`}
      >
        {running ? 'run streaming' : run.status}
      </span>
      <span className="text-muted">{run.taskId} · claude -p</span>
      {run.costUsd !== null && (
        <span data-testid="run-cost" className="shrink-0 text-muted">
          {run.numTurns !== null && `${run.numTurns} turns · `}
          {money(run.costUsd)}
          <span className="text-dim"> reported by claude</span>
        </span>
      )}
      {run.sessionId && <span className="min-w-0 truncate text-dim">{run.sessionId}</span>}
      {run.endedAt === null && (
        <button
          onClick={() => onCancel(run.runId)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1 text-[11px] text-faint hover:text-danger ${FOCUS_RING}`}
        >
          <Square aria-hidden="true" className="size-3" />
          cancel
        </button>
      )}
    </div>
  )

  const body = (
    <div className={collapsed ? '' : 'px-3.5 pb-3'}>
      <pre
        ref={log}
        className="max-h-64 overflow-auto rounded-[7px] bg-neutral-950 px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] break-all whitespace-pre-wrap text-muted"
      >
        {output || '(waiting for output…)'}
        {running && (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-[13px] w-[7px] animate-caret bg-work align-[-2px]"
          />
        )}
      </pre>
    </div>
  )

  return (
    <section
      data-testid="run-panel"
      aria-label={`Run ${run.taskId}`}
      className={running
        ? 'rounded-[10px] border border-work/25 bg-work/[0.04]'
        : 'rounded-[10px] border border-neutral-800 bg-neutral-900'}
    >
      {collapsed
        ? (
            <details className="group">
              <summary className={`flex list-none items-center rounded-[10px] pl-2 ${FOCUS_RING}`}>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-faint transition-transform group-open:rotate-90" />
                {header}
              </summary>
              <div className="px-3.5 pb-3">{body}</div>
            </details>
          )
        : (
            <>
              {header}
              {body}
            </>
          )}
    </section>
  )
}
