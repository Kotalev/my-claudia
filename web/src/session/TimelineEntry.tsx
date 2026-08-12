import type { TranscriptEntry } from '../shared/types.js'

const ROLE_STYLES: Record<string, string> = {
  user: 'border-l-sky-500',
  assistant: 'border-l-violet-500',
  system: 'border-l-neutral-700',
}

const MAX_TEXT = 2000

export function TimelineEntry({ entry }: { entry: TranscriptEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString()

  return (
    <article
      data-testid="timeline-entry"
      className={`border-l-2 ${ROLE_STYLES[entry.role] ?? 'border-l-neutral-700'} py-2 pl-4`}
    >
      <header className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-400">{entry.role}</span>
        <span>{time}</span>
        {entry.isSidechain && <span className="rounded bg-neutral-800 px-1.5">subagent</span>}
      </header>

      {entry.text && (
        <p className="whitespace-pre-wrap break-words text-sm text-neutral-200">
          {entry.text.length > MAX_TEXT ? `${entry.text.slice(0, MAX_TEXT)}…` : entry.text}
        </p>
      )}

      {entry.toolCalls.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {entry.toolCalls.map(call => (
            <li key={call.id} className="font-mono text-xs text-neutral-400">
              <span className="text-amber-400">{call.name}</span>
              {call.filePath && <span className="text-neutral-500"> {call.filePath}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
