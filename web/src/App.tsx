import { useEffect, useState } from 'react'

export function App() {
  const [health, setHealth] = useState('checking…')

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d.ok ? `API up (v${d.version})` : 'API error'))
      .catch(() => setHealth('API unreachable'))
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <h1 className="text-2xl font-semibold">Mission Control</h1>
      <p className="mt-2 text-neutral-400" data-testid="health">{health}</p>
    </main>
  )
}
