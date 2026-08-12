import { useEffect, useRef } from 'react'
import type { RunHandle } from '../shared/types.js'

const STATUS_STYLES: Record<string, string> = {
  running: 'text-emerald-400',
  succeeded: 'text-neutral-400',
  failed: 'text-red-400',
  cancelled: 'text-amber-400',
}

export function RunPanel(
  { run, output, onCancel }:
  { run: RunHandle; output: string; onCancel: (runId: string) => void },
) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView() }, [output])

  return (
    <section data-testid="run-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs">
        <span className="font-mono text-neutral-400">{run.taskId}</span>
        <span data-testid="run-status" className={STATUS_STYLES[run.status] ?? 'text-neutral-500'}>
          {run.status}
        </span>
        {run.sessionId && <span className="truncate font-mono text-neutral-600">{run.sessionId}</span>}
        {run.endedAt === null && (
          <button
            onClick={() => onCancel(run.runId)}
            className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
        )}
      </header>
      <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-neutral-400">
        {output || '(waiting for output…)'}
        <div ref={bottom} />
      </pre>
    </section>
  )
}
