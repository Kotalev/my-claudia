import { useCallback, useEffect, useState } from 'react'

export interface Route {
  projectId: string | null
  sessionId: string | null
  history?: boolean
  digest?: boolean
}

/**
 * `/p/<projectId>/s/<sessionId>`, either half optional.
 *
 * The nesting encodes the precedence the app already had: a session opened
 * from inside a project keeps that project in the URL, so Back lands on the
 * project rather than jumping to the Overview. Screen state used to live in
 * `useState`, which meant the browser's own Back button left the app.
 *
 * Never throws: this parses whatever is in the address bar, including a path
 * a user typed by hand.
 */
export function parseRoute(pathname: string): Route {
  if (pathname === '/history' || pathname.startsWith('/history/')) {
    return { projectId: null, sessionId: null, history: true }
  }
  if (pathname === '/digest' || pathname.startsWith('/digest/')) {
    return { projectId: null, sessionId: null, digest: true }
  }
  const project = /^\/p\/([^/]+)/.exec(pathname)
  const session = /\/s\/([^/]+)/.exec(pathname)
  return {
    projectId: decodeSegment(project?.[1]),
    sessionId: decodeSegment(session?.[1]),
  }
}

/** A malformed percent-escape makes decodeURIComponent throw; that is not a crash. */
function decodeSegment(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function pathFor(route: Route): string {
  if (route.history) return '/history'
  if (route.digest) return '/digest'
  let path = ''
  if (route.projectId) path += `/p/${encodeURIComponent(route.projectId)}`
  if (route.sessionId) path += `/s/${encodeURIComponent(route.sessionId)}`
  return path === '' ? '/' : path
}

/**
 * The server already serves index.html for any non-`/api`, non-`/ws` 404 and
 * Vite dev does the same, so these paths are shareable with no server change.
 */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.pathname))

  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route) => {
    const path = pathFor(next)
    if (path !== location.pathname) history.pushState(null, '', path)
    setRoute(next)
  }, [])

  return [route, navigate]
}
