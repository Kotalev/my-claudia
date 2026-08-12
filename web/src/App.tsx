import { useState } from 'react'
import { Overview } from './overview/Overview.js'

export function App() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  if (selectedSession) {
    return (
      <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
        <button onClick={() => setSelectedSession(null)} className="text-sm text-neutral-400 hover:text-neutral-100">
          ← Overview
        </button>
        <h1 className="mt-2 font-mono text-sm">{selectedSession}</h1>
      </main>
    )
  }

  return <Overview onOpenSession={setSelectedSession} />
}
