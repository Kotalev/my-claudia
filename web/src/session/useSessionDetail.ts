import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary, TranscriptEntry } from '../shared/types.js'

export function useSessionDetail(sessionId: string) {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const inFlight = useRef(false)

  const refetch = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(`/api/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setEntries(data.entries)
      }
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refetch() }, [refetch])

  // A session.updated for THIS session means new entries exist, so refetch the
  // full timeline rather than trying to patch it.
  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`)
    socket.onmessage = ev => {
      const msg = JSON.parse(ev.data as string)
      if (msg.type === 'session.updated' && msg.session.sessionId === sessionId) void refetch()
    }
    return () => {
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', () => socket.close())
      } else {
        socket.close()
      }
    }
  }, [sessionId, refetch])

  return { summary, entries, loading }
}
