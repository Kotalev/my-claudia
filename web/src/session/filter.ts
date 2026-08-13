import type { TranscriptEntry } from '../shared/types.js'

/**
 * The in-session filter: free text over an entry's visible text plus an exact
 * tool name, combined with AND. Pure over the parsed entries so the transcript
 * view can recompute it per render without touching scroll or follow state.
 */
export interface EntryFilter {
  query: string
  tool: string | null
}

export function isFilterActive(f: EntryFilter): boolean {
  return f.query.trim() !== '' || f.tool !== null
}

export function filterEntries(entries: TranscriptEntry[], f: EntryFilter): TranscriptEntry[] {
  if (!isFilterActive(f)) return entries
  const needle = f.query.trim().toLowerCase()
  return entries.filter((e) => {
    if (needle !== '' && (e.text === null || !e.text.toLowerCase().includes(needle))) return false
    if (f.tool !== null && !e.toolCalls.some(c => c.name === f.tool)) return false
    return true
  })
}

/** Distinct tool names used in this session, in first-use order. */
export function collectToolNames(entries: TranscriptEntry[]): string[] {
  const names = new Set<string>()
  for (const e of entries) for (const c of e.toolCalls) names.add(c.name)
  return [...names]
}
