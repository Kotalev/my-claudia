import { useState } from 'react'
import { Overview } from './overview/Overview.js'
import { SessionView } from './session/SessionView.js'

export function App() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  return selectedSession
    ? <SessionView sessionId={selectedSession} onBack={() => setSelectedSession(null)} />
    : <Overview onOpenSession={setSelectedSession} />
}
