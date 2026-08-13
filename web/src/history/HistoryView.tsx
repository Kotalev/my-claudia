import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '../shared/api.js'
import { Page } from '../shared/Page.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import { FOCUS_RING } from '../shared/focus.js'
import { relativeTime } from '../shared/format.js'
import type { ProjectRecord } from '../shared/types.js'
// Types only — erased at build time, nothing from src/server ships in the bundle.
import type { RunRow, SpendDayRow } from '@server/history/db.js'

const SPEND_DAYS = 90

/** Two decimals under $10, whole dollars above — same voice as the SpendBar. */
function usd(v: number): string {
  return v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`
}

/** `12s`, `4m 05s`, `1h 12m` between two stamps. A dash when either is unparsable. */
function duration(startedAt: string, endedAt: string | null): string {
  if (endedAt === null) return '—'
  const ms = Date.parse(endedAt) - Date.parse(startedAt)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Statuses arrive as free strings from the db; unknown ones render colourless.
const STATUS_TEXT: Record<string, string> = {
  running: 'text-info',
  succeeded: 'text-work',
  failed: 'text-danger',
  cancelled: 'text-dim',
}

/** The local calendar day of a moment, as `YYYY-MM-DD` — mirrors the server's bucketing. */
function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** The last `count` local calendar days, oldest first, today last. */
function lastDays(count: number): string[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) =>
    localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - i))))
}

function SpendChart({ days }: { days: SpendDayRow[] }) {
  const byDay = new Map(days.map(d => [d.day, d.costUsd]))
  const axis = lastDays(SPEND_DAYS)
  const max = Math.max(...axis.map(d => byDay.get(d) ?? 0))

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-925 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono">
        <h2 className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
          Spend — last {SPEND_DAYS} days
        </h2>
        {max > 0 && <span className="text-[11px] text-dim tabular-nums">peak {usd(max)}/day</span>}
      </div>
      {max <= 0 ? (
        <p className="font-mono text-[11.5px] text-faint">No priced spend recorded yet.</p>
      ) : (
        <div data-testid="spend-chart" className="flex h-24 items-end gap-px" role="img"
          aria-label={`Daily spend over the last ${SPEND_DAYS} days, peaking at ${usd(max)}`}
        >
          {axis.map(day => {
            const value = byDay.get(day)
            const pct = value != null && value > 0 ? Math.max(2, (value / max) * 100) : 0
            return (
              <div key={day} className="group relative h-full min-w-0 flex-1"
                title={`${day} — ${value == null ? 'n/a' : usd(value)}`}
              >
                <div className="absolute inset-x-0 bottom-0 h-px bg-neutral-875" />
                {pct > 0 && (
                  <div className="absolute inset-x-0 bottom-0 rounded-t-[1px] bg-info opacity-80 group-hover:opacity-100"
                    style={{ height: `${pct}%` }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="flex justify-between font-mono text-[10.5px] text-dim tabular-nums">
        <span>{axis[0]}</span>
        <span>today</span>
      </div>
    </section>
  )
}

function RunsTable({ runs, projectName }: { runs: RunRow[]; projectName: (id: string) => string }) {
  if (runs.length === 0) {
    return <p className="font-mono text-[11.5px] text-faint">No finished runs recorded yet.</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-925">
      <table className="w-full font-mono text-[11.5px]">
        <thead>
          <tr className="border-b border-neutral-875 text-left text-[10.5px] tracking-[0.14em] uppercase text-faint">
            {['Project', 'Task', 'Status', 'Started', 'Duration', 'Cost'].map(h => (
              <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.runId} className="border-b border-neutral-875 last:border-b-0 hover:bg-neutral-875">
              <td className="max-w-48 truncate px-4 py-2 text-neutral-200">{projectName(run.projectId)}</td>
              <td className="px-4 py-2 text-muted">{run.taskId ?? '—'}</td>
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
 * Persisted run and spend history, read once per visit from the SQLite-backed
 * endpoints. Live state deliberately plays no part here: this screen shows
 * what survived restarts, not what is happening now.
 */
export function HistoryView(
  { projects, onBack }: { projects: ProjectRecord[]; onBack: () => void },
) {
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [spendDays, setSpendDays] = useState<SpendDayRow[]>([])
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [runsRes, spendRes] = await Promise.all([
          apiFetch('/api/history/runs?limit=100'),
          apiFetch(`/api/history/spend?days=${SPEND_DAYS}`),
        ])
        if (!runsRes.ok || !spendRes.ok) {
          throw new Error(`history unavailable (${runsRes.ok ? spendRes.status : runsRes.status})`)
        }
        const runsBody = await runsRes.json() as { disabled: boolean; runs: RunRow[] }
        const spendBody = await spendRes.json() as { disabled: boolean; days: SpendDayRow[] }
        if (cancelled) return
        setDisabled(runsBody.disabled || spendBody.disabled)
        setRuns(runsBody.runs)
        setSpendDays(spendBody.days)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [])

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
        <h1 className="text-xl font-semibold tracking-[-0.01em]">History</h1>
        <p className="font-mono text-[11.5px] text-faint">runs and spend that survived restarts</p>
      </div>

      {error && <ErrorLine testId="history-error" className="mb-6">{error}</ErrorLine>}
      {disabled && (
        <p className="mb-6 rounded-xl border border-neutral-800 bg-neutral-925 p-5 font-mono text-[11.5px] text-faint">
          History is disabled — persistent storage needs Node 22.5+ (node:sqlite). Everything else works.
        </p>
      )}

      {!disabled && !error && (
        <div className="flex flex-col gap-6">
          <SpendChart days={spendDays} />
          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
              Past runs
            </h2>
            {runs === null
              ? <p className="font-mono text-[11.5px] text-faint">Loading…</p>
              : <RunsTable runs={runs} projectName={projectName} />}
          </section>
        </div>
      )}
    </Page>
  )
}
