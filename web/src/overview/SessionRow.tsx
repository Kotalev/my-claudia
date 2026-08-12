import type { SessionSummary } from '../shared/types.js'
import { relativeTime, STATUS_LABELS } from '../shared/format.js'
import { StatusDot } from '../shared/StatusDot.js'
import { FOCUS_RING } from '../shared/focus.js'

export function SessionRow(
  { session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void },
) {
  return (
    <button
      onClick={() => onOpen(session.sessionId)}
      data-testid="session-row"
      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-800/60 focus-visible:bg-neutral-800/60 ${FOCUS_RING}`}
    >
      <StatusDot status={session.status} labelled className="mt-1.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-200">
          {session.lastUserPrompt
            ?? session.lastAssistantText
            ?? (session.historyTruncated ? '(earlier history not loaded)' : '(no prompt yet)')}
        </span>
        {/* The status name is printed rather than left to the dot's colour:
            amber and emerald are the pair a red-green deficiency collapses. */}
        <span className="block text-xs text-faint">
          {STATUS_LABELS[session.status]} · {relativeTime(session.lastActivity)} · {session.messageCount} msgs
          {session.hasSidechain && ' · subagents'}
          {session.historyTruncated && ' · partial history'}
          {session.skippedUnknown > 0 && ` · ${session.skippedUnknown} unknown lines`}
        </span>
      </span>
    </button>
  )
}
