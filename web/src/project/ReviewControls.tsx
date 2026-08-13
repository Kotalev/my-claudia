import { useState } from 'react'
import { apiFetch } from '../shared/api.js'
import type { RunDiff } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'

/** Tint a raw patch line with the existing tokens: additions work-green, deletions danger-red. */
function patchLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('@@')) {
    return 'text-faint'
  }
  if (line.startsWith('+')) return 'text-work'
  if (line.startsWith('-')) return 'text-danger'
  return 'text-muted'
}

export const ACTION_BUTTON = `inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1
  text-[11px] text-faint disabled:opacity-50 ${FOCUS_RING}`

/**
 * Diff review for an unresolved worktree run: the file list and patch behind a
 * toggle, plus merge/discard. Works for live runs and for historical runs — the
 * endpoints fall back to the history row when the dispatcher does not know the
 * id. A 409 from either endpoint (dirty checkout, merge conflict) surfaces
 * inline; success arrives over the socket, which retires these controls.
 */
export function ReviewControls({ runId }: { runId: string }) {
  const [diff, setDiff] = useState<RunDiff | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggleDiff = async (): Promise<void> => {
    if (showDiff) { setShowDiff(false); return }
    setShowDiff(true)
    if (diff) return
    const res = await apiFetch(`/api/runs/${runId}/diff`)
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
    const res = await apiFetch(`/api/runs/${runId}/${action}`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `${action} failed (${res.status})`)
      return
    }
    // The resolution arrives over the socket; the stale diff must not outlive
    // the worktree it came from.
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
