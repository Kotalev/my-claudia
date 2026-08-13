import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { apiFetch } from '../shared/api.js'
import { FOCUS_RING } from '../shared/focus.js'
import { relativeTime } from '../shared/format.js'

interface SearchMatch {
  sessionId: string
  projectId: string | null
  projectLabel: string
  timestamp: string
  role: string
  snippet: string
}

/** Queries this short return [] from the server; skip the round trip entirely. */
const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

/** The snippet split around the first case-insensitive occurrence of the query. */
function emphasize(snippet: string, query: string): React.ReactNode {
  const index = snippet.toLowerCase().indexOf(query.trim().toLowerCase())
  if (index === -1) return snippet
  const end = index + query.trim().length
  return (
    <>
      {snippet.slice(0, index)}
      <mark className="rounded-[2px] bg-work/20 px-0.5 text-neutral-100">{snippet.slice(index, end)}</mark>
      {snippet.slice(end)}
    </>
  )
}

export function SearchBox({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[] | null>(null)
  // The query the visible matches answer, so emphasis never lags the input.
  const [answered, setAnswered] = useState('')
  const requestSeq = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setMatches(null)
      return
    }
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      void apiFetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then(res => res.ok ? res.json() as Promise<{ matches: SearchMatch[] }> : null)
        .then(body => {
          // A slower earlier response must not overwrite a newer query's answer.
          if (body === null || seq !== requestSeq.current) return
          setMatches(body.matches)
          setAnswered(trimmed)
        })
        .catch(() => { /* server unreachable: keep whatever is shown */ })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="mb-6">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
        <input
          data-testid="search-input"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search across sessions…"
          aria-label="Search across sessions"
          className={`w-full rounded-lg border border-neutral-800 bg-neutral-900 py-2 pr-3 pl-9 font-mono text-sm ${FOCUS_RING} focus:border-neutral-600`}
        />
      </div>

      {matches !== null && (
        matches.length === 0
          ? <p data-testid="search-empty" className="mt-2 px-1 font-mono text-xs text-faint">No matches.</p>
          : (
            <ul data-testid="search-results" className="mt-2 divide-y divide-neutral-850 rounded-lg border border-neutral-800 bg-neutral-900">
              {matches.map((m, i) => (
                <li key={`${m.sessionId}-${m.timestamp}-${i}`}>
                  <button
                    onClick={() => onOpenSession(m.sessionId)}
                    className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-neutral-850 ${FOCUS_RING}`}
                  >
                    <span className="shrink-0 font-mono text-[11px] text-muted">{m.projectLabel}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{relativeTime(m.timestamp)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">
                      {emphasize(m.snippet, answered)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  )
}
