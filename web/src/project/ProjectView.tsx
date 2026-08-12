import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../shared/api.js'
import { ArrowLeft, MessagesSquare } from 'lucide-react'
import type { ProjectRecord, RunHandle, SessionSummary, Task, TasksDoc } from '../shared/types.js'
import { NewTaskForm } from './NewTaskForm.js'
import { NEXT_STATUS, TaskBoard } from './TaskBoard.js'
import { SessionRow } from '../overview/SessionRow.js'
import { RunPanel } from './RunPanel.js'
import { HooksBadge } from './HooksBadge.js'
import { Page } from '../shared/Page.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import { FOCUS_RING } from '../shared/focus.js'
import { useClockTick } from '../shared/useClockTick.js'

const EMPTY_DOC: TasksDoc = {
  title: 'Tasks', tasks: [], progress: [], preamble: [], sectionExtras: {}, extraSections: [],
}

/** Finished runs kept on screen before the rest go behind a toggle. */
const VISIBLE_FINISHED_RUNS = 3

export function ProjectView(
  { project, sessions, doc, runs, runOutput, onBack, onOpenSession }:
  {
    project: ProjectRecord
    sessions: SessionSummary[]
    doc: TasksDoc | undefined
    runs: RunHandle[]
    runOutput: Record<string, string>
    onBack: () => void
    onOpenSession: (id: string) => void
  },
) {
  // Live task docs arrive over the socket, but the very first render may precede
  // the project's doc appearing in the snapshot, so fetch once as a fallback.
  const [fallback, setFallback] = useState<TasksDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showOlderRuns, setShowOlderRuns] = useState(false)
  useClockTick()

  useEffect(() => {
    if (doc) return
    let cancelled = false
    void apiFetch(`/api/projects/${project.id}/tasks`)
      // A non-ok answer — a TASKS.md that failed to parse — used to fall
      // through to EMPTY_DOC and render as an empty board, indistinguishable
      // from a project that genuinely has no tasks.
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`tasks unavailable (${r.status})`))))
      .then(d => { if (!cancelled) setFallback(d.doc) })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [project.id, doc])

  const current = doc ?? fallback ?? EMPTY_DOC
  const loading = doc === undefined && fallback === null && loadError === null

  const createTask = useCallback(async (title: string, tags: string[]) => {
    const res = await apiFetch(`/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, tags }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? `could not add the task (${res.status})`)
    }
  }, [project.id])

  const advance = useCallback((task: Task) => {
    void apiFetch(`/api/projects/${project.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: NEXT_STATUS[task.status] }),
    })
  }, [project.id])

  const dispatch = useCallback(async (task: Task) => {
    const res = await apiFetch(`/api/projects/${project.id}/tasks/${task.id}/dispatch`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'dispatch failed' }))
      setError(body.error ?? 'dispatch failed')
      return
    }
    setError(null)
  }, [project.id])

  const cancelRun = useCallback((runId: string) => {
    void apiFetch(`/api/runs/${runId}/cancel`, { method: 'POST' })
  }, [])

  // Every run ever dispatched used to stay expanded above the board for the
  // lifetime of the server process — three finished runs put ~870px of log
  // between the new-task form and the tasks.
  const activeRuns = runs.filter(r => r.endedAt === null)
  const finishedRuns = [...runs.filter(r => r.endedAt !== null)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const shownFinished = showOlderRuns ? finishedRuns : finishedRuns.slice(0, VISIBLE_FINISHED_RUNS)

  return (
    <Page>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <button
          onClick={onBack}
          className={`-ml-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-muted hover:bg-neutral-800 hover:text-neutral-100 ${FOCUS_RING}`}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Overview
        </button>
      </nav>
      <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
      <p className="mb-2 font-mono text-xs break-all text-muted">{project.path}</p>
      <div className="mb-6"><HooksBadge projectId={project.id} /></div>

      {/* One column until xl. The split used to arrive at lg, the same
          breakpoint at which the board went 3-up, so the task columns got
          narrower as the window grew — about 196px at 1024px. */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-4">
          <NewTaskForm onCreate={createTask} />
          {error && <ErrorLine testId="dispatch-error" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2">{error}</ErrorLine>}
          {loadError && <ErrorLine testId="tasks-error" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2">{loadError} — the board below may be incomplete.</ErrorLine>}

          {activeRuns.map(run => (
            <RunPanel key={run.runId} run={run} output={runOutput[run.runId] ?? ''} onCancel={cancelRun} />
          ))}
          {shownFinished.map(run => (
            <RunPanel key={run.runId} run={run} output={runOutput[run.runId] ?? ''} onCancel={cancelRun} collapsed />
          ))}
          {finishedRuns.length > VISIBLE_FINISHED_RUNS && (
            <button
              onClick={() => setShowOlderRuns(v => !v)}
              className={`rounded px-2 py-1 text-xs text-muted hover:text-neutral-100 ${FOCUS_RING}`}
            >
              {showOlderRuns
                ? 'hide older runs'
                : `show ${finishedRuns.length - VISIBLE_FINISHED_RUNS} older run(s)`}
            </button>
          )}

          <TaskBoard
            doc={current}
            loading={loading}
            onAdvance={advance}
            onDispatch={dispatch}
            dispatchBusy={activeRuns.length > 0}
            runningTaskId={activeRuns[0]?.taskId ?? null}
          />
        </div>

        <aside className="min-w-0">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase text-muted"><MessagesSquare aria-hidden="true" className="size-3.5" />Sessions</h2>
          <div className="space-y-1">
            {sessions.length === 0
              ? <p className="px-3 py-2 text-sm text-faint">No sessions yet.</p>
              : sessions.map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
          </div>
        </aside>
      </div>
    </Page>
  )
}
