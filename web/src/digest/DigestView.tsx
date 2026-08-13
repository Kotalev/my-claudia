import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '../shared/api.js'
import { Page } from '../shared/Page.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import { FOCUS_RING } from '../shared/focus.js'
import { duration, relativeTime, usd } from '../shared/format.js'
import type { ProjectRecord } from '../shared/types.js'
// Types only — erased at build time, nothing from src/server ships in the bundle.
import type { RunRow } from '@server/history/db.js'
import type { LoopStopTrace } from '@server/scheduler/loop.js'
import type { DigestTotals } from '@server/routes/digest.js'

const HOUR_CHOICES = [6, 12, 24, 48]

interface DigestBody {
  since: string
  disabled: boolean
  runs: RunRow[]
  totals: DigestTotals
  pendingReviews: number
  stoppedLoops: LoopStopTrace[]
}

// Statuses arrive as free strings from the db; unknown ones render colourless.
const STATUS_TEXT: Record<string, string> = {
  running: 'text-info',
  succeeded: 'text-work',
  failed: 'text-danger',
  cancelled: 'text-dim',
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">{label}</span>
      <span className={`text-lg tabular-nums ${tone ?? 'text-neutral-200'}`}>{value}</span>
    </div>
  )
}

function RunsTable({ runs, projectName }: { runs: RunRow[]; projectName: (id: string) => string }) {
  if (runs.length === 0) {
    return <p className="font-mono text-[11.5px] text-faint">Nothing ran in this window.</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-925">
      <table className="w-full font-mono text-[11.5px]">
        <thead>
          <tr className="border-b border-neutral-875 text-left text-[10.5px] tracking-[0.14em] uppercase text-faint">
            {['Project', 'Task', 'Outcome', 'Started', 'Duration', 'Cost'].map(h => (
              <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.runId} className="border-b border-neutral-875 last:border-b-0 hover:bg-neutral-875">
              <td className="max-w-48 truncate px-4 py-2 text-neutral-200">{projectName(run.projectId)}</td>
              <td className="px-4 py-2 text-muted">
                {run.taskId ?? '—'}
                {run.loopId !== null && <span className="ml-1.5 text-dim">loop</span>}
              </td>
              <td className={`px-4 py-2 ${STATUS_TEXT[run.status] ?? 'text-muted'}`}>
                {run.status}
                {run.merged && <span className="ml-1.5 text-dim">merged</span>}
                {run.discarded && <span className="ml-1.5 text-dim">discarded</span>}
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-dim">{relativeTime(run.startedAt)}</td>
              <td className="px-4 py-2 tabular-nums text-muted">{duration(run.startedAt, run.endedAt)}</td>
              <td className="px-4 py-2 tabular-nums text-muted">
                {run.costUsd === null ? '—' : usd(run.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * "What ran while you were away": one fetch per visit (and per window change),
 * no live socket — the point is the summary of a period, not a moving picture.
 */
export function DigestView(
  { projects, onBack, onOpenProject }:
  { projects: ProjectRecord[]; onBack: () => void; onOpenProject: (id: string) => void },
) {
  const [hours, setHours] = useState(12)
  const [data, setData] = useState<DigestBody | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/api/digest?hours=${hours}`)
        if (!res.ok) throw new Error(`digest unavailable (${res.status})`)
        const body = await res.json() as DigestBody
        if (!cancelled) {
          setData(body)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [hours])

  const projectName = (id: string): string => projects.find(p => p.id === id)?.name ?? id

  return (
    <Page>
      <nav aria-label="Breadcrumb" className="mb-3">
        <button
          onClick={onBack}
          className={`-ml-2 inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11.5px] text-faint hover:bg-neutral-875 hover:text-neutral-200 ${FOCUS_RING}`}
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Overview
        </button>
      </nav>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-3 border-b border-neutral-875 pb-5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Digest — last {hours} h</h1>
        <div role="group" aria-label="Window" className="flex items-center gap-1 font-mono text-[11.5px]">
          {HOUR_CHOICES.map(h => (
            <button
              key={h}
              aria-pressed={h === hours}
              onClick={() => setHours(h)}
              className={`rounded px-2 py-1 ${FOCUS_RING} ${h === hours
                ? 'bg-neutral-875 text-neutral-200'
                : 'text-faint hover:bg-neutral-875 hover:text-neutral-200'}`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorLine testId="digest-error" className="mb-6">{error}</ErrorLine>}
      {data?.disabled && (
        <p className="mb-6 rounded-xl border border-neutral-800 bg-neutral-925 p-5 font-mono text-[11.5px] text-faint">
          History is disabled (Node 22.5+ needed), so this window only covers runs since the server started.
        </p>
      )}

      {data === null && !error && <p className="font-mono text-[11.5px] text-faint">Loading…</p>}

      {data !== null && (
        <div className="flex flex-col gap-6">
          <section className="grid grid-cols-2 gap-4 rounded-xl border border-neutral-800 bg-neutral-925 p-5 font-mono sm:grid-cols-5">
            <Stat label="Runs" value={String(data.totals.runs)} />
            <Stat label="Succeeded" value={String(data.totals.succeeded)} tone="text-work" />
            <Stat label="Failed" value={String(data.totals.failed)}
              tone={data.totals.failed > 0 ? 'text-danger' : 'text-dim'} />
            <Stat label="Cancelled" value={String(data.totals.cancelled)} tone="text-dim" />
            <Stat label="Cost" value={data.totals.costUsd > 0 ? usd(data.totals.costUsd) : '—'} />
          </section>

          {data.pendingReviews > 0 && (
            <p data-testid="digest-reviews" className="rounded-xl border border-alarm/30 bg-alarm/10 p-4 font-mono text-[11.5px] text-alarm">
              {data.pendingReviews} finished run{data.pendingReviews === 1 ? '' : 's'} awaiting review — open the project to merge or discard.
            </p>
          )}

          {data.stoppedLoops.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
                Loops that stopped
              </h2>
              <ul className="flex flex-col gap-1.5">
                {data.stoppedLoops.map(loop => (
                  <li key={`${loop.loopId}-${loop.stoppedAt}`}>
                    <button
                      onClick={() => onOpenProject(loop.projectId)}
                      className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-neutral-800 bg-neutral-925 px-4 py-2.5 text-left font-mono text-[11.5px] hover:bg-neutral-875 ${FOCUS_RING}`}
                    >
                      <span className="text-neutral-200">{projectName(loop.projectId)}</span>
                      {loop.taskId !== null && <span className="text-muted">{loop.taskId}</span>}
                      <span className="text-faint">{loop.note}</span>
                      <span className="ml-auto whitespace-nowrap text-dim">{relativeTime(loop.stoppedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
              Runs
            </h2>
            <RunsTable runs={data.runs} projectName={projectName} />
          </section>
        </div>
      )}
    </Page>
  )
}
