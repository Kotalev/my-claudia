import { useState } from 'react'
import { Clock, Play, X } from 'lucide-react'
import type { ScheduleJob, Task, TaskStatus, TasksDoc } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'
import { clockTime } from '../shared/format.js'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'todo' },
  { status: 'in-progress', label: 'in progress' },
  { status: 'done', label: 'done' },
]

export const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in-progress',
  'in-progress': 'done',
  done: 'todo',
}

const CHECKBOX: Record<TaskStatus, string> = {
  todo: '[ ]', 'in-progress': '[~]', done: '[x]',
}

/**
 * The inline "run this later" affordance: a clock button that unfolds a
 * datetime-local input. Submitting posts the schedule; the pending line under
 * the card arrives over the socket, so this only has to close itself.
 */
function ScheduleControl({ task, onSchedule }: { task: Task; onSchedule: (task: Task, atIso: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const at = new Date(value)
    if (Number.isNaN(at.getTime())) { setError('pick a time'); return }
    setBusy(true)
    setError(null)
    try {
      await onSchedule(task, at.toISOString())
      setOpen(false)
      setValue('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="schedule-button"
        aria-label={`Schedule ${task.id} to run later`}
        aria-expanded={open}
        title="Run at a chosen time"
        onClick={() => { setOpen(v => !v); setError(null) }}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded border border-neutral-700 px-[7px] py-0.5
          ${open ? 'text-neutral-200' : 'text-faint'} hover:text-neutral-200 ${FOCUS_RING}`}
      >
        <Clock aria-hidden="true" className="size-2.5" />
        later
      </button>
      {open && (
        <form
          data-testid="schedule-form"
          onSubmit={e => { e.preventDefault(); void submit() }}
          className="flex w-full flex-wrap items-center gap-[7px]"
        >
          <input
            type="datetime-local"
            value={value}
            onChange={e => setValue(e.target.value)}
            aria-label={`Run ${task.id} at`}
            className={`rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono
              text-[10.5px] text-muted [color-scheme:dark] ${FOCUS_RING}`}
          />
          <button
            type="submit"
            disabled={busy || value === ''}
            className={`rounded border border-work/30 px-[7px] py-0.5 text-work hover:bg-work/10 disabled:opacity-40 ${FOCUS_RING}`}
          >
            schedule
          </button>
          {error && <span data-testid="schedule-error" className="w-full break-words text-danger">{error}</span>}
        </form>
      )}
    </>
  )
}

function TaskCard(
  { task, onAdvance, onDispatch, dispatchBusy, running, schedules = [], onSchedule, onCancelSchedule }:
  {
    task: Task
    onAdvance: (task: Task) => void
    onDispatch?: (task: Task) => void
    dispatchBusy: boolean
    running: boolean
    /** Pending schedules for THIS task only. */
    schedules?: ScheduleJob[]
    onSchedule?: (task: Task, atIso: string) => Promise<void>
    onCancelSchedule?: (scheduleId: string) => void
  },
) {
  // Advancing a done task rewrites the user's TASKS.md back to Todo with no
  // undo, from an 18px target whose accessible name was literally "[x]".
  const [confirming, setConfirming] = useState(false)
  const inProgress = task.status === 'in-progress'

  return (
    <article
      data-testid="task-card"
      className={`rounded-[9px] p-3.5 ${inProgress
        ? 'border border-[#1a201d] border-l-[3px] border-l-work-edge bg-neutral-900'
        : 'border border-neutral-800 bg-neutral-900'}`}
    >
      <div className="flex items-start gap-2.5">
        {/* An in-progress task is a working element: the orbit sits beside the
            id, exactly as it does on a working session row. */}
        {inProgress && (
          <span aria-hidden="true" className="relative mt-1 size-[11px] shrink-0">
            <span className="absolute -inset-0.5 animate-orbit rounded-full border-[1.5px] border-transparent border-t-work" />
            <span className="absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-work" />
          </span>
        )}
        <button
          type="button"
          data-testid="task-advance"
          aria-label={`${task.id}: move from ${task.status} to ${NEXT_STATUS[task.status]}`}
          title={`Move to ${NEXT_STATUS[task.status]}`}
          onClick={() => {
            if (task.status === 'done' && !confirming) {
              setConfirming(true)
              setTimeout(() => setConfirming(false), 3000)
              return
            }
            setConfirming(false)
            onAdvance(task)
          }}
          // Negative margin keeps the visual alignment while the padding
          // enlarges the hit box to something a finger can find.
          className={`-m-1 mt-0 shrink-0 rounded p-1 font-mono text-[11px] text-faint hover:text-neutral-200 ${FOCUS_RING}`}
        >
          {confirming ? 'reopen?' : CHECKBOX[task.status]}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-[1.45] text-neutral-100">
            <span className="font-mono text-[11px] text-faint">{task.id}</span> {task.title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-[7px] font-mono text-[10.5px] text-faint">
            {task.tags.map(tag => (
              <span key={tag} className="rounded border border-neutral-700 px-1.5 py-px">
                #{tag}
              </span>
            ))}
            {task.note && <span className="italic">{task.note}</span>}
            {task.doneDate && <span>{task.doneDate}</span>}
            {onDispatch && task.status !== 'done' && (
              <button
                data-testid="dispatch-button"
                onClick={() => onDispatch(task)}
                // Only this task's own live run blocks a re-dispatch; a busy
                // project queues the dispatch server-side instead of refusing.
                disabled={running}
                title={dispatchBusy && !running ? 'Queues behind the running dispatch' : undefined}
                className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded border border-work/30 px-[7px] py-0.5 text-work hover:bg-work/10 disabled:opacity-40 ${FOCUS_RING}`}
              >
                <Play aria-hidden="true" className={`size-2.5 ${running ? 'animate-pulse' : ''}`} />
                {running ? 'running…' : dispatchBusy ? 'queue' : 'run'}
              </button>
            )}
            {onSchedule && task.status !== 'done' && (
              <ScheduleControl task={task} onSchedule={onSchedule} />
            )}
          </div>
          {schedules.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {schedules.map(s => (
                <p key={s.id} data-testid="task-schedule" className="flex items-center gap-1.5 font-mono text-[10.5px] text-alarm">
                  <Clock aria-hidden="true" className="size-2.5 shrink-0" />
                  runs at {clockTime(s.runAt)}
                  {onCancelSchedule && (
                    <button
                      type="button"
                      data-testid="schedule-cancel"
                      aria-label={`Cancel the schedule at ${clockTime(s.runAt)}`}
                      title="Cancel this schedule"
                      onClick={() => onCancelSchedule(s.id)}
                      className={`-m-1 rounded p-1 text-faint hover:text-danger ${FOCUS_RING}`}
                    >
                      <X aria-hidden="true" className="size-3" />
                    </button>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** A done task at archive weight: one line, id + title, nothing interactive. */
function DoneRow({ task }: { task: Task }) {
  return (
    <div className="flex items-baseline gap-2.5 px-1 py-[7px]">
      <span className="shrink-0 font-mono text-[10.5px] text-dim">{task.id}</span>
      <span className="truncate text-[12.5px] text-muted">{task.title}</span>
      {task.doneDate && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-dim">{task.doneDate}</span>}
    </div>
  )
}

const COLUMN_HEADER: Record<TaskStatus, { border: string; label: string }> = {
  todo: { border: 'border-neutral-800', label: 'text-neutral-300' },
  'in-progress': { border: 'border-work-edge', label: 'text-work' },
  done: { border: 'border-neutral-800', label: 'text-faint' },
}

export function TaskBoard(
  { doc, onAdvance, onDispatch, dispatchBusy = false, runningTaskIds = [], loading = false,
    schedules = [], onSchedule, onCancelSchedule }:
  {
    doc: TasksDoc
    onAdvance: (task: Task) => void
    onDispatch?: (task: Task) => void
    /** Pending schedules for this project; each card shows only its own. */
    schedules?: ScheduleJob[]
    onSchedule?: (task: Task, atIso: string) => Promise<void>
    onCancelSchedule?: (scheduleId: string) => void
    /**
     * One run per project. The button is disabled rather than removed: it used
     * to vanish from every card at once, which silently reflowed the board and
     * told the user nothing about why the affordance had gone.
     */
    dispatchBusy?: boolean
    /** The task the active run is working on, so its own card can say so. */
    runningTaskIds?: string[]
    loading?: boolean
  },
) {
  const empty = !loading && doc.tasks.length === 0
  // DONE is archive: it used to visually dominate as the only filled column.
  // Compact rows by default; "expand" restores the full cards (and with them
  // the reopen control).
  const [doneExpanded, setDoneExpanded] = useState(false)

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {COLUMNS.map(col => {
        const tasks = doc.tasks.filter(t => t.status === col.status)
        const done = col.status === 'done'
        const header = COLUMN_HEADER[col.status]
        return (
          // No opacity trick on DONE: the receded text tokens already carry
          // the archive weight, and opacity would push them below AA.
          <section
            key={col.status}
            data-testid={`column-${col.status}`}
            className="min-w-0"
          >
            <h3 className={`mb-2.5 flex items-center gap-2 border-b pb-2 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase ${header.border} ${header.label}`}>
              {col.label}
              <span className="text-[11px] font-normal tracking-normal text-faint">{tasks.length}</span>
              {done && tasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDoneExpanded(v => !v)}
                  className={`ml-auto rounded font-mono text-[10.5px] font-normal tracking-normal normal-case text-faint hover:text-muted ${FOCUS_RING}`}
                >
                  {doneExpanded ? 'collapse' : 'expand'}
                </button>
              )}
            </h3>
            <div className={done && !doneExpanded ? 'space-y-0.5' : 'space-y-2.5'}>
              {loading && [0, 1].map(i => (
                <div key={i} className="h-14 animate-pulse rounded-[9px] bg-neutral-900" />
              ))}
              {!loading && (done && !doneExpanded ? tasks.slice(0, 8) : tasks).map(task => (
                done && !doneExpanded
                  ? <DoneRow key={task.id} task={task} />
                  : (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onAdvance={onAdvance}
                        onDispatch={onDispatch}
                        dispatchBusy={dispatchBusy}
                        running={runningTaskIds.includes(task.id)}
                        schedules={schedules.filter(s => s.taskId === task.id)}
                        onSchedule={onSchedule}
                        onCancelSchedule={onCancelSchedule}
                      />
                    )
              ))}
              {!loading && done && !doneExpanded && tasks.length > 8 && (
                <p className="px-1 py-1.5 font-mono text-[10.5px] text-dim">
                  + {tasks.length - 8} more — expand to see the archive
                </p>
              )}
              {!loading && !empty && tasks.length === 0 && (
                <p className="px-3 py-2 font-mono text-[11px] text-dim">Nothing here</p>
              )}
            </div>
          </section>
        )
      })}

      {empty && (
        // Naming the source of truth: this board is a file in the project, and
        // a user who does not know that reads three empty columns as a bug.
        <p className="rounded-[9px] border border-dashed border-neutral-800 px-4 py-6 text-sm text-faint sm:col-span-2 xl:col-span-3">
          No tasks yet — this board is <code>TASKS.md</code> in the project root. Add one above and
          it will be written there.
        </p>
      )}
    </div>
  )
}
