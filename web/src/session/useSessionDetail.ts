import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary, TranscriptEntry } from '../shared/types.js'

export function useSessionDetail(sessionId: string, liveActivity: string | null) {
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

  // No socket of its own: the app already holds one, and a second connection
  // would receive every broadcast in the system just to learn about this
  // session. The caller passes the live summary; a change in its activity
  // timestamp is the signal that new entries exist.
  useEffect(() => {
    if (liveActivity !== null) void refetch()
  }, [liveActivity, refetch])

  return { summary, entries, loading }
}
