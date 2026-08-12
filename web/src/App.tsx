import { useState } from 'react'
import { Overview } from './overview/Overview.js'
import { SessionView } from './session/SessionView.js'
import { ProjectView } from './project/ProjectView.js'
import { useLiveState } from './shared/useLiveState.js'

export function App() {
  // One socket for the whole app: every screen reads from this state rather
  // than opening a connection of its own.
  const live = useLiveState()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  if (sessionId) {
    const summary = live.sessions.find(s => s.sessionId === sessionId)
    return (
      <SessionView
        sessionId={sessionId}
        liveActivity={summary?.lastActivity ?? null}
        onBack={() => setSessionId(null)}
      />
    )
  }

  const project = live.projects.find(p => p.id === projectId)
  if (project) {
    return (
      <ProjectView
        project={project}
        sessions={live.sessions.filter(s => s.projectId === project.id)}
        doc={live.tasks[project.id]}
        runs={live.runs.filter(r => r.projectId === project.id)}
        runOutput={live.runOutput}
        onBack={() => setProjectId(null)}
        onOpenSession={setSessionId}
      />
    )
  }

  return <Overview live={live} onOpenSession={setSessionId} onOpenProject={setProjectId} />
}
