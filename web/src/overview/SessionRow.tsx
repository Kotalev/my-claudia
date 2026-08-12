import type { SessionSummary } from '../shared/types.js'
import { relativeTime, STATUS_STYLES } from '../shared/format.js'

export function SessionRow(
  { session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void },
) {
  return (
    <button
      onClick={() => onOpen(session.sessionId)}
      data-testid="session-row"
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-800/60"
    >
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_STYLES[session.status]}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-200">
          {session.lastUserPrompt ?? '(no prompt yet)'}
        </span>
        <span className="block text-xs text-neutral-500">
          {relativeTime(session.lastActivity)} · {session.messageCount} msgs
          {session.hasSidechain && ' · subagents'}
          {session.skippedUnknown > 0 && ` · ${session.skippedUnknown} unknown lines`}
        </span>
      </span>
    </button>
  )
}
