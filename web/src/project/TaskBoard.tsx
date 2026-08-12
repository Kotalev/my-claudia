import { useState } from 'react'
import { Play } from 'lucide-react'
import type { Task, TaskStatus, TasksDoc } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in-progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
]

export const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in-progress',
  'in-progress': 'done',
  done: 'todo',
}

const CHECKBOX: Record<TaskStatus, string> = {
  todo: '[ ]', 'in-progress': '[~]', done: '[x]',
}

function TaskCard(
  { task, onAdvance, onDispatch, dispatchBusy, running }:
  {
    task: Task
    onAdvance: (task: Task) => void
    onDispatch?: (task: Task) => void
    dispatchBusy: boolean
    running: boolean
  },
) {
  // Advancing a done task rewrites the user's TASKS.md back to Todo with no
  // undo, from an 18px target whose accessible name was literally "[x]".
  const [confirming, setConfirming] = useState(false)

  return (
    <article
      data-testid="task-card"
      className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
    >
      <div className="flex items-start gap-2">
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
          className={`-m-1 mt-0 shrink-0 rounded p-1 font-mono text-xs text-faint hover:text-neutral-200 ${FOCUS_RING}`}
        >
          {confirming ? 'reopen?' : CHECKBOX[task.status]}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-neutral-200">
            <span className="font-mono text-xs text-faint">{task.id}</span> {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {task.tags.map(tag => (
              <span key={tag} className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-muted">
                #{tag}
              </span>
            ))}
            {task.note && <span className="text-xs text-faint italic">{task.note}</span>}
            {task.doneDate && <span className="text-xs text-faint">{task.doneDate}</span>}
          </div>
        </div>
        {onDispatch && task.status !== 'done' && (
          <button
            data-testid="dispatch-button"
            onClick={() => onDispatch(task)}
            disabled={dispatchBusy}
            title={dispatchBusy ? 'A run is already active for this project' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 ${FOCUS_RING}`}
          >
            <Play aria-hidden="true" className={`size-3 ${running ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
            {running ? 'Running…' : 'Run'}
          </button>
        )}
      </div>
    </article>
  )
}

export function TaskBoard(
  { doc, onAdvance, onDispatch, dispatchBusy = false, runningTaskId = null, loading = false }:
  {
    doc: TasksDoc
    onAdvance: (task: Task) => void
    onDispatch?: (task: Task) => void
    /**
     * One run per project. The button is disabled rather than removed: it used
     * to vanish from every card at once, which silently reflowed the board and
     * told the user nothing about why the affordance had gone.
     */
    dispatchBusy?: boolean
    /** The task the active run is working on, so its own card can say so. */
    runningTaskId?: string | null
    loading?: boolean
  },
) {
  const empty = !loading && doc.tasks.length === 0

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {COLUMNS.map(col => {
        const tasks = doc.tasks.filter(t => t.status === col.status)
        return (
          <section key={col.status} data-testid={`column-${col.status}`} className="min-w-0">
            <h3 className="mb-2 text-xs font-medium tracking-wide uppercase text-muted">{col.label}</h3>
            <div className="space-y-2">
              {loading && [0, 1].map(i => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-neutral-900 motion-reduce:animate-none" />
              ))}
              {!loading && tasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onAdvance={onAdvance}
                  onDispatch={onDispatch}
                  dispatchBusy={dispatchBusy}
                  running={runningTaskId === task.id}
                />
              ))}
              {!loading && !empty && tasks.length === 0 && (
                <p className="px-3 py-2 text-xs text-faint">Nothing here</p>
              )}
            </div>
          </section>
        )
      })}

      {empty && (
        // Naming the source of truth: this board is a file in the project, and
        // a user who does not know that reads three empty columns as a bug.
        <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-6 text-sm text-faint sm:col-span-2 xl:col-span-3">
          No tasks yet — this board is <code>TASKS.md</code> in the project root. Add one above and
          it will be written there.
        </p>
      )}
    </div>
  )
}
