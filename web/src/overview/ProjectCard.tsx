import { Trash2 } from 'lucide-react'
import type { ProjectRecord, SessionSummary } from '../shared/types.js'
import { SessionRow } from './SessionRow.js'
import { FOCUS_RING } from '../shared/focus.js'

export function ProjectCard(
  { project, sessions, onOpenSession, onOpenProject, onRemove }:
  {
    project: ProjectRecord
    sessions: SessionSummary[]
    onOpenSession: (id: string) => void
    onOpenProject: (id: string) => void
    onRemove: (id: string) => void
  },
) {
  const active = sessions.filter(s => s.status === 'active').length

  return (
    // min-w-0 on the section and on the heading below: a grid item defaults to
    // min-width:auto, so the `truncate` on the title did nothing — the card
    // sized to the longest project name and pushed the document sideways.
    <section
      data-testid="project-card"
      aria-labelledby={`project-${project.id}`}
      className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 id={`project-${project.id}`} className="min-w-0 text-base font-medium">
          <button
            onClick={() => onOpenProject(project.id)}
            data-testid="project-open"
            className={`max-w-full truncate rounded text-neutral-100 hover:text-white hover:underline ${FOCUS_RING}`}
          >
            {project.name}
          </button>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-faint">{active} active · {sessions.length} total</span>
          <button
            data-testid="project-remove"
            title={`Unregister ${project.path} (the directory is not touched)`}
            onClick={() => {
              if (confirm(`Unregister ${project.name}?\n\n${project.path}\n\nOnly the dashboard entry is removed — nothing on disk is deleted.`)) {
                onRemove(project.id)
              }
            }}
            className={`-mr-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-red-950/40 hover:text-red-300 ${FOCUS_RING}`}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            remove
          </button>
        </div>
      </header>
      <div className="space-y-1">
        {sessions.length === 0
          ? <p className="px-3 py-2 text-sm text-faint">No sessions yet.</p>
          : sessions.slice(0, 6).map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
      </div>
    </section>
  )
}
