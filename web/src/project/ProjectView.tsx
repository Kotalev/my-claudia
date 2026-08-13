import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../shared/api.js'
import { ArrowLeft, MessagesSquare } from 'lucide-react'
import type { InterruptedRun, PendingReview, ProjectRecord, QueuedDispatch, RunHandle, ScheduleJob, SessionSummary, Task, TasksDoc } from '../shared/types.js'
import { NewTaskForm } from './NewTaskForm.js'
import { PromptRunForm } from './PromptRunForm.js'
import { NEXT_STATUS, TaskBoard, type ScheduleOptions } from './TaskBoard.js'
import { SessionRow } from '../overview/SessionRow.js'
import { RunPanel } from './RunPanel.js'
import { PendingReviews } from './PendingReviews.js'
import { InterruptedRuns } from './InterruptedRuns.js'
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

/** What names a queued dispatch: its task id, or what kind of taskless run it will be. */
function queuedLabel(q: QueuedDispatch): string {
  if (q.input.taskId) return q.input.taskId
  if (q.input.kind === 'resume') {
    return q.input.resumeSessionId ? `resume ${q.input.resumeSessionId.slice(0, 8)}` : 'resume'
  }
  return 'prompt'
}

export function ProjectView(
  { project, sessions, doc, runs, runOutput, schedules, queue, reviews, interrupted, onBack, onOpenSession }:
  {
    project: ProjectRecord
    sessions: SessionSummary[]
    doc: TasksDoc | undefined
    runs: RunHandle[]
    runOutput: Record<string, string>
    schedules: ScheduleJob[]
    queue: QueuedDispatch[]
    reviews: PendingReview[]
    interrupted: InterruptedRun[]
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

  const dispatchPrompt = useCallback(async (text: string) => {
    const res = await apiFetch(`/api/projects/${project.id}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? `could not start the run (${res.status})`)
    }
  }, [project.id])

  const cancelRun = useCallback((runId: string) => {
    void apiFetch(`/api/runs/${runId}/cancel`, { method: 'POST' })
  }, [])

  const retryRun = useCallback(async (runId: string) => {
    const res = await apiFetch(`/api/runs/${runId}/retry`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `retry failed (${res.status})`)
      return
    }
    setError(null)
  }, [])

  const cancelQueued = useCallback((queueId: string) => {
    void apiFetch(`/api/queue/${queueId}`, { method: 'DELETE' })
  }, [])

  const scheduleTask = useCallback(async (task: Task, atIso: string, opts: ScheduleOptions) => {
    const res = await apiFetch(`/api/projects/${project.id}/tasks/${task.id}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        at: atIso,
        ...(opts.repeatEveryMs !== null && { repeatEveryMs: opts.repeatEveryMs }),
        ...(opts.maxIterations !== null && { maxIterations: opts.maxIterations }),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? `could not schedule the task (${res.status})`)
    }
  }, [project.id])

  const cancelSchedule = useCallback((scheduleId: string) => {
    void apiFetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' })
  }, [])

  /** The pending auto-continue for a run's session, so its panel can say when. */
  const autoContinueAt = useCallback((run: RunHandle): string | null =>
    schedules.find(s => s.kind === 'resume-run' && s.sessionId !== null && s.sessionId === run.sessionId)
      ?.runAt ?? null, [schedules])

  // Every run ever dispatched used to stay expanded above the board for the
  // lifetime of the server process — three finished runs put ~870px of log
  // between the new-task form and the tasks.
  const activeRuns = runs.filter(r => r.endedAt === null)
  const finishedRuns = [...runs.filter(r => r.endedAt !== null)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const shownFinished = showOlderRuns ? finishedRuns : finishedRuns.slice(0, VISIBLE_FINISHED_RUNS)

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-b border-neutral-875 pb-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{project.name}</h1>
          <p className="min-w-0 font-mono text-[11.5px] break-all text-faint">{project.path}</p>
        </div>
        <HooksBadge projectId={project.id} />
      </div>

      {/* One column until xl. The split used to arrive at lg, the same
          breakpoint at which the board went 3-up, so the task columns got
          narrower as the window grew — about 196px at 1024px. */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-4">
          <NewTaskForm onCreate={createTask} />
          <PromptRunForm onDispatch={dispatchPrompt} />
          {error && <ErrorLine testId="dispatch-error" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2">{error}</ErrorLine>}
          {loadError && <ErrorLine testId="tasks-error" className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2">{loadError} — the board below may be incomplete.</ErrorLine>}

          <InterruptedRuns interrupted={interrupted} />
          {activeRuns.map(run => (
            <RunPanel key={run.runId} run={run} output={runOutput[run.runId] ?? ''} onCancel={cancelRun} onRetry={retryRun} autoContinueAt={autoContinueAt(run)} />
          ))}
          {queue.map(q => (
            <div
              key={q.queueId}
              data-testid="queued-dispatch"
              className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-dashed border-neutral-800 bg-neutral-900/60 px-3.5 py-2.5 font-mono text-[11.5px]"
            >
              <span className="text-[10.5px] tracking-[0.12em] uppercase text-dim">queued</span>
              <span className="text-faint">{queuedLabel(q)} · claude -p</span>
              <span className="text-dim">waits for the running dispatch</span>
              <button
                onClick={() => cancelQueued(q.queueId)}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-[5px] border border-neutral-700 px-2 py-1 text-[11px] text-faint hover:text-danger ${FOCUS_RING}`}
              >
                cancel
              </button>
            </div>
          ))}
          <PendingReviews reviews={reviews} />
          {shownFinished.map(run => (
            <RunPanel key={run.runId} run={run} output={runOutput[run.runId] ?? ''} onCancel={cancelRun} onRetry={retryRun} autoContinueAt={autoContinueAt(run)} collapsed />
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
            schedules={schedules}
            onSchedule={scheduleTask}
            onCancelSchedule={cancelSchedule}
            // Worktree-isolated runs may overlap; only an in-place run (non-git
            // project) still blocks the next dispatch.
            dispatchBusy={activeRuns.some(r => r.isolation !== 'worktree')}
            runningTaskIds={activeRuns.map(r => r.taskId).filter((id): id is string => id !== null)}
          />
        </div>

        <aside className="min-w-0">
          <h2 className="mb-3 flex items-center gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">
            <MessagesSquare aria-hidden="true" className="size-3.5" />
            Sessions
            {sessions.some(s => s.status === 'active') && (
              <span className="text-[11px] font-normal tracking-normal normal-case text-work">
                {sessions.filter(s => s.status === 'active').length} live
              </span>
            )}
          </h2>
          <div className="space-y-[3px]">
            {sessions.length === 0
              ? <p className="px-3 py-2 text-sm text-faint">No sessions yet.</p>
              : sessions.map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
          </div>
        </aside>
      </div>
    </Page>
  )
}
