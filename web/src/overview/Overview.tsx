import { useLiveState } from '../shared/useLiveState.js'
import { ProjectCard } from './ProjectCard.js'

export function Overview({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const { projects, sessions, connected } = useLiveState()
  const unassigned = sessions.filter(s => s.projectId === null)

  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Mission Control</h1>
        <span data-testid="connection" className="text-xs text-neutral-500">
          {connected ? 'live' : 'reconnecting…'}
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            sessions={sessions.filter(s => s.projectId === p.id)}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>

      {projects.length === 0 && (
        <p className="text-neutral-500">
          No projects registered yet. POST a path to <code>/api/projects</code> to add one.
        </p>
      )}

      {unassigned.length > 0 && (
        <p className="mt-6 text-sm text-neutral-500">
          {unassigned.length} session(s) in unregistered projects.
        </p>
      )}
    </main>
  )
}
