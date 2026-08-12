import type { ToolCall, TranscriptEntry } from '../shared/types.js'

/**
 * The transcript hierarchy the redesign asks for, computed once per render:
 * user prompts are chapters, assistant prose is body, tool-call-only entries
 * merge into one activity block per stretch, and bookkeeping rows (nothing to
 * show at all) collapse into a counted divider instead of a wall of
 * "no visible content".
 */
export type TimelineItem =
  | { kind: 'entry'; entry: TranscriptEntry }
  | { kind: 'activity'; uuid: string; entries: TranscriptEntry[] }
  | { kind: 'hidden'; uuid: string; count: number }
  | { kind: 'compaction'; entry: TranscriptEntry }

/** Nothing to render at all — the rows that used to fill half the timeline. */
function isBookkeeping(e: TranscriptEntry): boolean {
  return e.text === null && e.toolCalls.length === 0 && !e.isCompactBoundary
}

/** A turn that is only tool calls: rendered as activity, not as prose. */
function isActivityOnly(e: TranscriptEntry): boolean {
  return e.text === null && e.toolCalls.length > 0 && !e.isCompactBoundary
}

export function buildTimeline(entries: TranscriptEntry[]): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const entry of entries) {
    if (entry.isCompactBoundary) {
      items.push({ kind: 'compaction', entry })
      continue
    }
    const last = items[items.length - 1]
    if (isBookkeeping(entry)) {
      if (last?.kind === 'hidden') last.count += 1
      else items.push({ kind: 'hidden', uuid: entry.uuid, count: 1 })
      continue
    }
    if (isActivityOnly(entry)) {
      if (last?.kind === 'activity') last.entries.push(entry)
      else items.push({ kind: 'activity', uuid: entry.uuid, entries: [entry] })
      continue
    }
    items.push({ kind: 'entry', entry })
  }
  return items
}

/** `Edit ×3 · Bash ×2 · Read ×1` — insertion order, ties broken by frequency. */
export function activitySummary(calls: ToolCall[]): string {
  const counts = new Map<string, number>()
  for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, n]) => (n === 1 ? name : `${name} ×${n}`))
    .join(' · ')
}

/** The distinct file basenames an activity touched, capped for one row. */
export function activityFiles(calls: ToolCall[], max = 3): string {
  const files = [...new Set(
    calls
      .map(c => c.filePath)
      .filter((p): p is string => p !== null)
      .map(p => p.split('/').filter(Boolean).pop() ?? p),
  )]
  if (files.length === 0) return ''
  const shown = files.slice(0, max)
  const extra = files.length - shown.length
  return shown.join(', ') + (extra > 0 ? `, +${extra}` : '')
}

export interface Chapter {
  uuid: string
  time: string
  label: string
  isCompaction: boolean
}

/**
 * User prompts are the natural chapter marks of a session; compaction
 * boundaries divide them. `isHumanPrompt` is the parser's own verdict on what
 * a human actually typed — machine-replayed user turns never make chapters.
 */
export function buildChapters(entries: TranscriptEntry[]): Chapter[] {
  const chapters: Chapter[] = []
  for (const e of entries) {
    if (e.isCompactBoundary) {
      chapters.push({ uuid: e.uuid, time: e.timestamp, label: 'compaction', isCompaction: true })
      continue
    }
    if (e.isHumanPrompt && e.text !== null && e.text.trim() !== '') {
      const firstLine = e.text.trim().split('\n', 1)[0]!
      chapters.push({
        uuid: e.uuid,
        time: e.timestamp,
        label: firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine,
        isCompaction: false,
      })
    }
  }
  return chapters
}
