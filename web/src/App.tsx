import { useEffect } from 'react'
import { Overview } from './overview/Overview.js'
import { SessionView } from './session/SessionView.js'
import { ProjectView } from './project/ProjectView.js'
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
  // "Mission Control" and navigation is silent.
  useEffect(() => {
    document.title = route.sessionId
      ? `Session ${route.sessionId.slice(0, 8)} — Mission Control`
      : project
        ? `${project.name} — Mission Control`
        : 'Mission Control'
  }, [project, route.sessionId])

  if (route.sessionId) {
    const summary = live.sessions.find(s => s.sessionId === route.sessionId)
    return (
      <SessionView
        sessionId={route.sessionId}
        liveActivity={summary?.lastActivity ?? null}
        // Back from a session opened inside a project returns to that project.
        backLabel={project?.name ?? 'Overview'}
        onBack={() => navigate({ projectId: route.projectId, sessionId: null })}
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
        onBack={() => navigate({ projectId: null, sessionId: null })}
        onOpenSession={id => navigate({ ...route, sessionId: id })}
      />
    )
  }

  return (
    <Overview
      live={live}
      onOpenSession={id => navigate({ projectId: null, sessionId: id })}
      onOpenProject={id => navigate({ projectId: id, sessionId: null })}
    />
  )
}
