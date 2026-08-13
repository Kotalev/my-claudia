import { useEffect } from 'react'
import { Overview } from './overview/Overview.js'
import { SessionView } from './session/SessionView.js'
import { ProjectView } from './project/ProjectView.js'
import { HistoryView } from './history/HistoryView.js'
import { useLiveState } from './shared/useLiveState.js'
import { useRoute } from './shared/route.js'

export function App() {
  // Which screen is on show lives in the URL rather than in useState: the
  // browser's own Back button used to leave the app entirely, and a session
  // could not be linked to.
  const [route, navigate] = useRoute()
  // One socket for the whole app: every screen reads from this state rather
  // than opening a connection of its own.
  const live = useLiveState({
    focusedSessionId: route.sessionId,
    // A notification click must go through navigate too, or the URL lies
    // about which session is on screen.
    onOpenSession: id => navigate({ ...route, sessionId: id }),
  })

  const project = live.projects.find(p => p.id === route.projectId)

  // Screen readers announce a title change; without this every screen is
  // "Mission Control" and navigation is silent. A session waiting on the user
  // additionally prefixes the tab title, so the alarm reaches a hidden tab.
  const waiting = live.sessions.filter(s => s.status === 'waiting').length
  useEffect(() => {
    const base = route.sessionId
      ? `Session ${route.sessionId.slice(0, 8)} — Mission Control`
      : project
        ? `${project.name} — Mission Control`
        : 'Mission Control'
    document.title = waiting > 0 ? `(${waiting}) ● ${base}` : base
  }, [project, route.sessionId, waiting])

  if (route.sessionId) {
    const summary = live.sessions.find(s => s.sessionId === route.sessionId)
    return (
      <SessionView
        sessionId={route.sessionId}
        liveActivity={summary?.lastActivity ?? null}
        // Back from a session opened inside a project returns to that project.
        backLabel={project?.name ?? 'Overview'}
        onBack={() => navigate({ projectId: route.projectId, sessionId: null })}
        // The dispatched resume run streams on the project screen, so go there.
        onResumed={projectId => navigate({ projectId, sessionId: null })}
      />
    )
  }

  if (project) {
    return (
      <ProjectView
        project={project}
        sessions={live.sessions.filter(s => s.projectId === project.id)}
        doc={live.tasks[project.id]}
        runs={live.runs.filter(r => r.projectId === project.id)}
        runOutput={live.runOutput}
        schedules={live.schedules.filter(s => s.projectId === project.id)}
        queue={live.queue.filter(q => q.projectId === project.id)}
        onBack={() => navigate({ projectId: null, sessionId: null })}
        onOpenSession={id => navigate({ ...route, sessionId: id })}
      />
    )
  }

  if (route.history) {
    return (
      <HistoryView
        projects={live.projects}
        onBack={() => navigate({ projectId: null, sessionId: null })}
      />
    )
  }

  return (
    <Overview
      live={live}
      onOpenSession={id => navigate({ projectId: null, sessionId: id })}
      onOpenProject={id => navigate({ projectId: id, sessionId: null })}
      onOpenHistory={() => navigate({ projectId: null, sessionId: null, history: true })}
    />
  )
}
