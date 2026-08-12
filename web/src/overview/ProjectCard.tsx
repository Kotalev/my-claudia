import type { ProjectRecord, SessionSummary } from '../shared/types.js'
import { SessionRow } from './SessionRow.js'

export function ProjectCard(
  { project, sessions, onOpenSession, onOpenProject }:
  {
    project: ProjectRecord
    sessions: SessionSummary[]
    onOpenSession: (id: string) => void
    onOpenProject: (id: string) => void
  },
) {
  const active = sessions.filter(s => s.status === 'active').length

  return (
    <section data-testid="project-card" className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <button
          onClick={() => onOpenProject(project.id)}
          data-testid="project-open"
          className="truncate font-medium text-neutral-100 hover:text-white hover:underline"
        >
          {project.name}
        </button>
        <span className="shrink-0 text-xs text-neutral-500">{active} active · {sessions.length} total</span>
      </header>
      <div className="space-y-1">
        {sessions.length === 0
          ? <p className="px-3 py-2 text-sm text-neutral-600">No sessions yet.</p>
          : sessions.slice(0, 6).map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
      </div>
    </section>
  )
}
