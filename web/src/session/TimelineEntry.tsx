import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { TranscriptEntry } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'
import { activityFiles, activitySummary, type TimelineItem } from './timeline.js'

/**
 * The transcript hierarchy: user prompts are the chapters — blue rail, card
 * ground, the largest text; assistant prose is the body; everything else
 * recedes. The role word carries the same hue as its rail.
 */
const ROLE_STYLES: Record<string, { name: string; wrap: string }> = {
  user: { name: 'text-info', wrap: 'rounded-[9px] border-l-[3px] border-l-info bg-neutral-900 px-4 py-3.5' },
  assistant: { name: 'text-work', wrap: 'px-4 py-3.5' },
  system: { name: 'text-faint', wrap: 'px-4 py-2' },
}

const FALLBACK = { name: 'text-faint', wrap: 'px-4 py-2' }

const MAX_TEXT = 2000

/** The fixed role gutter: the label column every row hangs from. */
const GUTTER = 'w-16 shrink-0 pt-0.5 font-mono text-[10.5px] tracking-[0.1em] uppercase'

export function TimelineEntry(
  { entry, streaming = false }: { entry: TranscriptEntry; streaming?: boolean },
) {
  const [expanded, setExpanded] = useState(false)
  const time = new Date(entry.timestamp).toLocaleTimeString()
  const role = ROLE_STYLES[entry.role] ?? FALLBACK

  const long = entry.text !== null && entry.text.length > MAX_TEXT
  const shown = long && !expanded ? entry.text!.slice(0, MAX_TEXT) : entry.text
  const label = entry.role === 'assistant' ? 'claude' : entry.role

  return (
    <article
      data-testid="timeline-entry"
      id={`entry-${entry.uuid}`}
      className={`flex gap-3.5 ${role.wrap} ${streaming ? 'rounded-[9px] border border-work/20 bg-work/[0.04]' : ''}`}
    >
      <span className={`${GUTTER} ${role.name}`}>
        {label}
        {entry.isSidechain && <span className="block normal-case tracking-normal text-dim">sub</span>}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        {shown && (
          <p className={`text-[15px] leading-[1.6] break-words whitespace-pre-wrap ${entry.role === 'user' ? 'text-neutral-100' : 'text-neutral-200'}`}>
            {shown}
            {streaming && (
              <span
                aria-hidden="true"
                className="ml-1.5 inline-block h-[15px] w-2 animate-caret bg-work align-[-2px]"
              />
            )}
          </p>
        )}

        {/* A bare `…` was the only sign that content had been withheld — the one
            place this app quietly lost what the user came to read. */}
        {long && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={`inline-flex items-center gap-1.5 rounded text-xs text-muted hover:text-neutral-100 ${FOCUS_RING}`}
          >
            <ChevronDown aria-hidden="true" className="size-3.5" />
            truncated at {MAX_TEXT} characters — show the remaining {entry.text!.length - MAX_TEXT}
          </button>
        )}

        {entry.toolCalls.length > 0 && <ToolCallList entries={[entry]} />}

        {streaming
          ? <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-work">streaming</p>
          : <p className="font-mono text-[11px] text-dim">{time}</p>}
      </div>
    </article>
  )
}

function ToolCallList({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.flatMap(e => e.toolCalls.map(call => (
        // break-all on the path only: the tool name must not split, and the
        // head of an absolute path is its least identifying part, so
        // clipping the tail would remove exactly what you need.
        <li key={call.id} className="font-mono text-xs break-words text-muted">
          <span className="text-neutral-300">{call.name}</span>
          {call.filePath && <span className="break-all text-faint"> {call.filePath}</span>}
        </li>
      )))}
    </ul>
  )
}

/**
 * Tool calls collapse into one activity block per stretch of turns —
 * `Edit ×3 · Bash ×2` and the files touched — instead of a full-height row
 * per call. Expanding shows every call with its path.
 */
export function ActivityBlock({ item }: { item: Extract<TimelineItem, { kind: 'activity' }> }) {
  const [open, setOpen] = useState(false)
  const calls = item.entries.flatMap(e => e.toolCalls)
  const files = activityFiles(calls)

  return (
    <div data-testid="timeline-activity" id={`entry-${item.uuid}`} className="flex gap-3.5 px-4 py-1">
      <span className={`${GUTTER} text-faint`}>activity</span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          className={`flex w-full flex-wrap items-center gap-2.5 rounded-[7px] border border-neutral-800 bg-neutral-900 px-3 py-2 text-left font-mono hover:bg-neutral-875 ${FOCUS_RING}`}
        >
          <span className="text-[11.5px] text-muted">{activitySummary(calls)}</span>
          {files && <span className="min-w-0 truncate text-[11px] text-dim">{files}</span>}
          <span className="ml-auto shrink-0 text-[11px] text-faint">{open ? 'collapse ▴' : 'expand ▾'}</span>
        </button>
        {open && (
          <div className="px-3 py-2">
            <ToolCallList entries={item.entries} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Bookkeeping rows carry nothing to read; the divider says how many were folded. */
export function HiddenDivider({ count }: { count: number }) {
  return (
    <div data-testid="timeline-hidden" className="flex items-center gap-3.5 px-4 py-1">
      <span className="w-16 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-2.5 font-mono text-[11px] text-dim">
        <span aria-hidden="true" className="h-px flex-1 bg-neutral-875" />
        <span>{count} bookkeeping {count === 1 ? 'entry' : 'entries'} hidden</span>
        <span aria-hidden="true" className="h-px flex-1 bg-neutral-875" />
      </div>
    </div>
  )
}

/** The conversation was compacted here — a chapter divider, not a message. */
export function CompactionDivider({ entry }: { entry: TranscriptEntry }) {
  return (
    <div
      data-testid="timeline-compaction"
      id={`entry-${entry.uuid}`}
      className="mx-4 my-1.5 border-y border-dashed border-neutral-700 px-2 py-1.5 font-mono text-[11px] text-dim"
    >
      compaction · {new Date(entry.timestamp).toLocaleTimeString()} — earlier turns were summarised away
    </div>
  )
}
