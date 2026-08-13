import { ChevronRight, GitBranch, Square } from 'lucide-react'
import { money } from '../shared/usage-format.js'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../shared/api.js'
import type { RunDiff, RunHandle, RunStatus } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'

const STATUS_TEXT: Record<RunStatus, string> = {
  running: 'text-work',
  succeeded: 'text-muted',
  failed: 'text-danger',
  cancelled: 'text-alarm',
}

/** Tint a raw patch line with the existing tokens: additions work-green, deletions danger-red. */
function patchLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('@@')) {
    return 'text-faint'
  }
  if (line.startsWith('+')) return 'text-work'
  if (line.startsWith('-')) return 'text-danger'
  return 'text-muted'
}

const ACTION_BUTTON = `inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1
  text-[11px] text-faint disabled:opacity-50 ${FOCUS_RING}`

/**
 * Diff review for a finished worktree run: the file list and patch behind a
 * toggle, plus merge/discard. A 409 from either endpoint (dirty checkout,
 * merge conflict) surfaces inline; success arrives as a run update over the
 * socket, which flips the run to merged/discarded and retires these controls.
 */
function WorktreeReview({ run }: { run: RunHandle }) {
  const [diff, setDiff] = useState<RunDiff | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggleDiff = async (): Promise<void> => {
    if (showDiff) { setShowDiff(false); return }
    setShowDiff(true)
    if (diff) return
    const res = await apiFetch(`/api/runs/${run.runId}/diff`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `diff unavailable (${res.status})`)
      setShowDiff(false)
      return
    }
    setDiff(await res.json())
  }

  const act = async (action: 'merge' | 'discard'): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await apiFetch(`/api/runs/${run.runId}/${action}`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `${action} failed (${res.status})`)
      return
    }
    // The updated run handle arrives over the socket; the stale diff must not
    // outlive the worktree it came from.
    setDiff(null)
    setShowDiff(false)
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void toggleDiff()} className={ACTION_BUTTON}>
          {showDiff ? 'hide diff' : 'view diff'}
        </button>
        <button onClick={() => void act('merge')} disabled={busy} className={`${ACTION_BUTTON} hover:text-work`}>
          merge
        </button>
        <button onClick={() => void act('discard')} disabled={busy} className={`${ACTION_BUTTON} hover:text-danger`}>
          discard
        </button>
      </div>
      {error && (
        <p data-testid="run-review-error" className="font-mono text-[11.5px] break-words text-danger">{error}</p>
      )}
      {showDiff && diff && (
        <div data-testid="run-diff" className="space-y-2">
          {diff.files.length === 0
            ? <p className="font-mono text-[11.5px] text-faint">No changes in this run&apos;s worktree.</p>
            : (
                <ul className="space-y-0.5 font-mono text-[11.5px]">
                  {diff.files.map(f => (
                    <li key={f.path} className="flex flex-wrap gap-x-3">
                      <span className="min-w-0 break-all text-muted">{f.path}</span>
                      <span className="text-work">+{f.additions}</span>
                      <span className="text-danger">−{f.deletions}</span>
                    </li>
                  ))}
                </ul>
              )}
          {diff.patch && (
            <pre className="max-h-80 overflow-auto overflow-x-auto rounded-[7px] bg-neutral-950 px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] whitespace-pre">
              {diff.patch.split('\n').map((line, i) => (
                <span key={i} className={patchLineClass(line)}>{line}{'\n'}</span>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  )
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
      {run.endedAt !== null && run.isolation === 'worktree' && run.diffAvailable && (
        <WorktreeReview run={run} />
      )}
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
