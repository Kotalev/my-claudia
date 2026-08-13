import type { FastifyInstance } from 'fastify'
import type { TranscriptEntry } from '../../transcript/types.js'
import type { SessionStore } from '../watcher/session-store.js'
import type { ProjectRegistry } from '../registry.js'

/** Enough matches to be useful, few enough that the scan stays bounded. */
export const MAX_RESULTS = 50
/** One-character queries match almost every entry and mean nothing. */
const MIN_QUERY_LENGTH = 2
/** Characters of surrounding text kept on each side of the match. */
const CONTEXT_CHARS = 60

export interface SearchMatch {
  sessionId: string
  projectId: string | null
  projectLabel: string
  timestamp: string
  role: string
  snippet: string
}

/** One session's worth of searchable material, label already resolved. */
export interface SearchableSession {
  sessionId: string
  projectId: string | null
  projectLabel: string
  entries: TranscriptEntry[]
}

/** The match with ~60 chars of context each side, whitespace collapsed for one-line display. */
function snippetAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS)
  const end = Math.min(text.length, index + matchLength + CONTEXT_CHARS)
  return (start > 0 ? '…' : '')
    + text.slice(start, end).replace(/\s+/g, ' ').trim()
    + (end < text.length ? '…' : '')
}

/**
 * Case-insensitive substring search over already-parsed entries, newest session
 * first, capped at MAX_RESULTS. Defensive against drifted entry shapes: an
 * entry whose text or timestamp is not a string is skipped, never thrown on —
 * the transcript format is internal to Claude Code and changes between releases.
 */
export function searchSessions(sessions: SearchableSession[], rawQuery: string): SearchMatch[] {
  const query = rawQuery.trim()
  if (query.length < MIN_QUERY_LENGTH) return []
  const needle = query.toLowerCase()

  const matches: SearchMatch[] = []
  for (const session of sessions) {
    if (!Array.isArray(session.entries)) continue
    for (const entry of session.entries) {
      if (typeof entry?.text !== 'string' || typeof entry.timestamp !== 'string') continue
      const index = entry.text.toLowerCase().indexOf(needle)
      if (index === -1) continue
      matches.push({
        sessionId: session.sessionId,
        projectId: session.projectId,
        projectLabel: session.projectLabel,
        timestamp: entry.timestamp,
        role: typeof entry.role === 'string' ? entry.role : 'unknown',
        snippet: snippetAround(entry.text, index, query.length),
      })
      if (matches.length >= MAX_RESULTS) return matches
    }
  }
  return matches
}

export function registerSearchRoutes(
  app: FastifyInstance, store: SessionStore, registry: ProjectRegistry,
): void {
  app.get<{ Querystring: { q?: string } }>('/api/search', async req => {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    // store.all() is already newest-first; entries are the same in-memory
    // timeline that /api/sessions/:sessionId serves, so no disk re-read here.
    const sessions: SearchableSession[] = store.all().map(s => ({
      sessionId: s.sessionId,
      projectId: s.projectId,
      projectLabel: (s.projectId ? registry.byId(s.projectId)?.name : undefined)
        ?? s.projectPath ?? 'unregistered',
      entries: store.entries(s.sessionId),
    }))
    return { matches: searchSessions(sessions, q) }
  })
}
