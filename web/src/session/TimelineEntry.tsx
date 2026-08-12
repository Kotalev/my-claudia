import { useState } from 'react'
import { Bot, ChevronDown, Cog, User, Wrench, type LucideIcon } from 'lucide-react'
import type { TranscriptEntry } from '../shared/types.js'
import { FOCUS_RING } from '../shared/focus.js'

/**
 * User and assistant turns used to be typographically identical apart from a
 * 2px border colour, so scanning a transcript for "where did I last say
 * something" meant reading it. The role name now carries the same hue as its
 * rail, and a user turn gets a faint ground.
 */
const ROLE_STYLES: Record<string, { rail: string; name: string; body: string; Icon: LucideIcon }> = {
  user: { rail: 'border-l-sky-500', name: 'text-sky-300', body: 'bg-sky-500/5', Icon: User },
  assistant: { rail: 'border-l-violet-500', name: 'text-violet-300', body: '', Icon: Bot },
  system: { rail: 'border-l-neutral-700', name: 'text-muted', body: '', Icon: Cog },
}

const FALLBACK = { rail: 'border-l-neutral-700', name: 'text-muted', body: '', Icon: Cog }

const MAX_TEXT = 2000

export function TimelineEntry({ entry }: { entry: TranscriptEntry }) {
  const [expanded, setExpanded] = useState(false)
  const time = new Date(entry.timestamp).toLocaleTimeString()
  const role = ROLE_STYLES[entry.role] ?? FALLBACK

  const long = entry.text !== null && entry.text.length > MAX_TEXT
  const shown = long && !expanded ? entry.text!.slice(0, MAX_TEXT) : entry.text
  // Tool results and bookkeeping turns carry nothing to render. They were
  // taking a full-height row each, so half the timeline was blank boxes.
  const bare = entry.text === null && entry.toolCalls.length === 0

  if (bare) {
    return (
      <p
        data-testid="timeline-entry"
        className={`flex items-center gap-1.5 border-l-2 ${role.rail} py-0.5 pl-4 text-xs text-faint`}
      >
        <role.Icon aria-hidden="true" className={`size-3 shrink-0 ${role.name}`} />
        <span className={role.name}>{entry.role}</span> {time} · no visible content
      </p>
    )
  }

  return (
    <article
      data-testid="timeline-entry"
      className={`border-l-2 ${role.rail} ${role.body} py-2 pl-4`}
    >
      <header className="mb-1 flex items-center gap-2 text-xs text-faint">
        <role.Icon aria-hidden="true" className={`size-3.5 shrink-0 ${role.name}`} />
        <span className={`font-medium ${role.name}`}>{entry.role}</span>
        <span>{time}</span>
        {entry.isSidechain && <span className="rounded bg-neutral-800 px-1.5 py-0.5">subagent</span>}
      </header>

      {shown && (
        <p className="max-w-[75ch] text-sm break-words whitespace-pre-wrap text-neutral-200">
          {shown}
        </p>
      )}

      {/* A bare `…` was the only sign that content had been withheld — the one
          place this app quietly lost what the user came to read. */}
      {long && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`mt-1 inline-flex items-center gap-1.5 rounded text-xs text-muted hover:text-neutral-100 ${FOCUS_RING}`}
        >
          <ChevronDown aria-hidden="true" className="size-3.5" />
          truncated at {MAX_TEXT} characters — show the remaining {entry.text!.length - MAX_TEXT}
        </button>
      )}

      {entry.toolCalls.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {entry.toolCalls.map(call => (
            // break-all on the path only: the tool name must not split, and the
            // head of an absolute path is its least identifying part, so
            // clipping the tail would remove exactly what you need.
            <li key={call.id} className="font-mono text-xs break-words text-muted">
              <Wrench aria-hidden="true" className="mr-1 inline size-3 shrink-0 align-[-1px] text-amber-400" />
              <span className="text-amber-400">{call.name}</span>
              {call.filePath && <span className="break-all text-faint"> {call.filePath}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
