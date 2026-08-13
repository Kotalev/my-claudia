import { ChevronRight, Clock, GitBranch, RotateCcw, Square } from 'lucide-react'
import { money } from '../shared/usage-format.js'
import { clockTime, elapsed } from '../shared/format.js'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../shared/api.js'
import { isEnabled, permission, supported } from '../shared/notifications.js'
import type { RunHandle, RunStatus } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'
import { useClockTick } from '../shared/useClockTick.js'
import { ACTION_BUTTON, ReviewControls } from './ReviewControls.js'

const STATUS_TEXT: Record<RunStatus, string> = {
  'running': 'text-work',
  'awaiting-input': 'text-alarm',
  'succeeded': 'text-muted',
  'failed': 'text-danger',
  'cancelled': 'text-alarm',
}

/** What names the run in the header: its task id, or what kind of taskless run it is. */
function runLabel(run: RunHandle): string {
  if (run.taskId) return run.taskId
  if (run.kind === 'resume') {
    return run.sessionId ? `resume ${run.sessionId.slice(0, 8)}` : 'resume'
  }
  return 'prompt'
}

/**
 * Steering for a live run: a follow-up message goes into the run's stdin and
 * starts a new turn in the same session. While the run is 'awaiting-input' a
 * Finish button closes stdin so the run concludes and can be reviewed.
 */
function SteerControls({ run }: { run: RunHandle }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const awaiting = run.status === 'awaiting-input'

  const post = async (path: 'input' | 'finish', body?: { text: string }): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await apiFetch(`/api/runs/${run.runId}/${path}`, {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    setBusy(false)
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      setError(errBody.error ?? `${path} failed (${res.status})`)
      return
    }
    if (path === 'input') setText('')
  }

  return (
    <form
      data-testid="run-steer"
      onSubmit={e => { e.preventDefault(); if (text.trim()) void post('input', { text: text.trim() }) }}
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={awaiting ? 'the run is waiting — steer it or finish' : 'queue a follow-up message'}
        aria-label="Steer this run"
        className={`min-w-0 flex-1 rounded-[5px] border border-neutral-700 bg-neutral-950 px-2.5 py-1
          font-mono text-[11.5px] text-muted placeholder:text-dim ${FOCUS_RING}`}
      />
      <button type="submit" disabled={busy || !text.trim()} className={`${ACTION_BUTTON} hover:text-work`}>
        send
      </button>
      {awaiting && (
        <button
          type="button"
          onClick={() => void post('finish')}
          disabled={busy}
          className={`${ACTION_BUTTON} border-alarm/40 text-alarm hover:border-alarm`}
        >
          finish run
        </button>
      )}
      {error && (
        <p data-testid="run-steer-error" className="w-full font-mono text-[11.5px] break-words text-danger">{error}</p>
      )}
    </form>
  )
}

/**
 * A dispatched `claude -p` run. While it streams it is a "working" element:
 * green-tinted surface, an orbiting indicator, and a block caret at the end of
 * the log. Finished runs are static and collapse behind a summary line.
 */
export function RunPanel(
  { run, output, onCancel, onRetry, collapsed = false, autoContinueAt = null }:
  {
    run: RunHandle
    output: string
    onCancel: (runId: string) => void
    /** Re-dispatches a failed or cancelled run with its original input. */
    onRetry?: (runId: string) => void
    collapsed?: boolean
    /** When a pending schedule will resume this run's session — a rate-limited run that re-armed. */
    autoContinueAt?: string | null
  },
) {
  const log = useRef<HTMLPreElement>(null)
  const running = run.status === 'running'
  const awaiting = run.status === 'awaiting-input'
  // The watchdog badges show durations ("no output 6m") that must keep aging
  // between socket messages — a stalled run is exactly the one not sending any.
  useClockTick()

  // Desktop notification on the stalled transition, under the same opt-in and
  // permission the session 'waiting' notifications use. The tag makes repeat
  // stalls of one run replace, not stack.
  const stalledNow = running && run.stalled === true
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!stalledNow) return
    if (!supported() || !isEnabled() || permission() !== 'granted') return
    const r = runRef.current
    const n = new Notification(`run ${runLabel(r)} looks stalled`, {
      body: `no output since ${clockTime(r.lastOutputAt ?? r.startedAt)}`,
      tag: `run-stall-${r.runId}`,
    })
    n.onclick = () => { window.focus(); n.close() }
  }, [stalledNow])

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
      {awaiting && (
        <span aria-hidden="true" className="relative size-3 shrink-0">
          <span className="absolute top-1/2 left-1/2 size-[7px] -translate-1/2 animate-pulse rounded-full bg-alarm" />
        </span>
      )}
      <span
        data-testid="run-status"
        role="status"
        className={`text-[10.5px] tracking-[0.12em] uppercase ${STATUS_TEXT[run.status] ?? 'text-faint'}`}
      >
        {running ? 'run streaming' : awaiting ? 'awaiting input' : run.status}
      </span>
      <span className="text-muted">{runLabel(run)} · claude -p</span>
      {stalledNow && (
        <span data-testid="run-stalled" className="inline-flex shrink-0 items-center gap-1 text-alarm">
          <Clock aria-hidden="true" className="size-3" />
          no output {elapsed(run.lastOutputAt ?? run.startedAt)}
        </span>
      )}
      {run.endedAt === null && run.longRunning && (
        <span data-testid="run-long-running" className="shrink-0 text-dim">
          running {elapsed(run.startedAt)}
        </span>
      )}
      {run.branch && (
        <span data-testid="run-branch" className="inline-flex min-w-0 items-center gap-1 text-dim">
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{run.branch}</span>
          {run.merged && <span className="text-work">merged</span>}
          {run.discarded && <span className="text-faint">discarded</span>}
        </span>
      )}
      {run.costUsd !== null && (
        <span data-testid="run-cost" className="shrink-0 text-muted">
          {run.numTurns !== null && `${run.numTurns} turns · `}
          {money(run.costUsd)}
          <span className="text-dim"> reported by claude</span>
        </span>
      )}
      {autoContinueAt !== null && (
        <span data-testid="run-auto-continue" className="inline-flex shrink-0 items-center gap-1 text-alarm">
          <Clock aria-hidden="true" className="size-3" />
          auto-continue at {clockTime(autoContinueAt)}
        </span>
      )}
      {run.sessionId && <span className="min-w-0 truncate text-dim">{run.sessionId}</span>}
      {onRetry && (run.status === 'failed' || run.status === 'cancelled') && (
        <button
          data-testid="run-retry"
          onClick={e => { e.preventDefault(); onRetry(run.runId) }}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1 text-[11px] text-faint hover:text-work ${FOCUS_RING}`}
        >
          <RotateCcw aria-hidden="true" className="size-3" />
          retry
        </button>
      )}
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
      {(running || awaiting) && <SteerControls run={run} />}
      {run.endedAt !== null && run.isolation === 'worktree' && run.diffAvailable && (
        <ReviewControls runId={run.runId} />
      )}
    </div>
  )

  return (
    <section
      data-testid="run-panel"
      aria-label={`Run ${runLabel(run)}`}
      className={running
        ? 'rounded-[10px] border border-work/25 bg-work/[0.04]'
        : awaiting
          ? 'rounded-[10px] border border-alarm/25 bg-alarm/[0.04]'
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
