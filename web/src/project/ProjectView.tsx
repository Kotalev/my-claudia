import { useCallback, useEffect, useState } from 'react'
import type { ProjectRecord, SessionSummary, Task, TasksDoc } from '../shared/types.js'
import { NewTaskForm } from './NewTaskForm.js'
import { NEXT_STATUS, TaskBoard } from './TaskBoard.js'
import { SessionRow } from '../overview/SessionRow.js'

const EMPTY_DOC: TasksDoc = { title: 'Tasks', tasks: [], progress: [], preamble: [] }

export function ProjectView(
  { project, sessions, doc, onBack, onOpenSession }:
  {
    project: ProjectRecord
    sessions: SessionSummary[]
    doc: TasksDoc | undefined
    onBack: () => void
    onOpenSession: (id: string) => void
  },
) {
  // Live task docs arrive over the socket, but the very first render may precede
  // the project's doc appearing in the snapshot, so fetch once as a fallback.
  const [fallback, setFallback] = useState<TasksDoc | null>(null)

  useEffect(() => {
    if (doc) return
    let cancelled = false
    void fetch(`/api/projects/${project.id}/tasks`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setFallback(d.doc) })
    return () => { cancelled = true }
  }, [project.id, doc])

  const current = doc ?? fallback ?? EMPTY_DOC

  const createTask = useCallback(async (title: string, tags: string[]) => {
    await fetch(`/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, tags }),
    })
  }, [project.id])

  const advance = useCallback((task: Task) => {
    void fetch(`/api/projects/${project.id}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: NEXT_STATUS[task.status] }),
    })
  }, [project.id])

  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <button onClick={onBack} className="mb-2 text-sm text-neutral-400 hover:text-neutral-100">
        ← Overview
      </button>
      <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
      <p className="mb-6 font-mono text-xs text-neutral-600">{project.path}</p>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <NewTaskForm onCreate={createTask} />
          <TaskBoard doc={current} onAdvance={advance} />
        </div>

        <aside>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">Sessions</h3>
          <div className="space-y-1">
            {sessions.length === 0
              ? <p className="px-3 py-2 text-sm text-neutral-600">No sessions yet.</p>
              : sessions.map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
          </div>
        </aside>
      </div>
    </main>
  )
}
