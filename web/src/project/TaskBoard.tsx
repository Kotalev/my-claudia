import type { Task, TaskStatus, TasksDoc } from '../shared/types.js'

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

export function TaskBoard(
  { doc, onAdvance, onDispatch }:
  { doc: TasksDoc; onAdvance: (task: Task) => void; onDispatch?: (task: Task) => void },
) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map(col => (
        <section key={col.status} data-testid={`column-${col.status}`}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">{col.label}</h3>
          <div className="space-y-2">
            {doc.tasks.filter(t => t.status === col.status).map(task => (
              <article
                key={task.id}
                data-testid="task-card"
                className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => onAdvance(task)}
                    title={`Move to ${NEXT_STATUS[task.status]}`}
                    className="mt-0.5 font-mono text-xs text-neutral-500 hover:text-neutral-200"
                  >
                    {CHECKBOX[task.status]}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-200">
                      <span className="font-mono text-xs text-neutral-500">{task.id}</span> {task.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {task.tags.map(tag => (
                        <span key={tag} className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                          #{tag}
                        </span>
                      ))}
                      {task.note && <span className="text-xs text-neutral-500 italic">{task.note}</span>}
                      {task.doneDate && <span className="text-xs text-neutral-600">{task.doneDate}</span>}
                    </div>
                  </div>
                  {onDispatch && task.status !== 'done' && (
                    <button
                      data-testid="dispatch-button"
                      onClick={() => onDispatch(task)}
                      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      Run
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
