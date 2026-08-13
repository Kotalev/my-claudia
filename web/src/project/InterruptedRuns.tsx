import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { apiFetch } from '../shared/api.js'
import { FOCUS_RING } from '../shared/focus.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import type { InterruptedRun } from '../shared/types.js'

/**
 * Runs a previous server process left behind (stopped or crashed while they
 * were alive). Resume continues the session where it stopped; a run that died
 * before its session id was known is re-dispatched from its original prompt.
 */
export function InterruptedRuns({ interrupted }: { interrupted: InterruptedRun[] }) {
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (interrupted.length === 0) return null

  const act = async (runId: string, action: 'resume' | 'dismiss'): Promise<void> => {
    setBusyId(runId)
    setError(null)
    const res = await apiFetch(`/api/interrupted/${runId}/${action}`, { method: 'POST' })
    setBusyId(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `${action} failed (${res.status})`)
    }
  }

  return (
    <div data-testid="interrupted-runs" className="space-y-2">
      {interrupted.map(run => (
        <div
          key={run.runId}
          data-testid="interrupted-run"
          className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-amber-900/60 bg-amber-950/20 px-3.5 py-2.5 font-mono text-[11.5px]"
        >
          <span className="text-[10.5px] tracking-[0.12em] uppercase text-amber-500/90">interrupted</span>
          <span className="min-w-0 flex-1 basis-48 truncate text-muted" title={run.prompt}>
            {run.taskId ?? run.prompt}
          </span>
          <span className="text-dim">
            {run.sessionId !== null ? 'server stopped mid-run' : 'died before the session was known'}
          </span>
          <button
            data-testid="interrupted-resume"
            disabled={busyId === run.runId}
            onClick={() => void act(run.runId, 'resume')}
            className={`inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1 text-[11px] text-faint hover:text-work disabled:opacity-50 ${FOCUS_RING}`}
          >
            <RotateCcw aria-hidden="true" className="size-3" />
            {run.sessionId !== null ? 'resume' : 'run again'}
          </button>
          <button
            data-testid="interrupted-dismiss"
            disabled={busyId === run.runId}
            onClick={() => void act(run.runId, 'dismiss')}
            className={`inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1 text-[11px] text-faint hover:text-danger disabled:opacity-50 ${FOCUS_RING}`}
          >
            <X aria-hidden="true" className="size-3" />
            dismiss
          </button>
        </div>
      ))}
      {error && <ErrorLine testId="interrupted-error" className="text-xs">{error}</ErrorLine>}
    </div>
  )
}
