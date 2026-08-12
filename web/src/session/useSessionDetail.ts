import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../shared/api.js'
import type { SessionSummary, TranscriptEntry } from '../shared/types.js'

export function useSessionDetail(sessionId: string, liveActivity: string | null) {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  // A failed fetch used to be swallowed by `if (res.ok)`, so the screen said
  // "No entries parsed yet." — telling the user the session is empty when it
  // could not be read at all.
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refetch = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setError(null)
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setEntries(data.entries)
      } else {
        setError(res.status === 404
          ? 'This session is no longer available — the transcript may have rotated away.'
          : `Could not load this session (${res.status}).`)
      }
    } catch {
      setError('The server is unreachable.')
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

  return { summary, entries, loading, error, refetch }
}
