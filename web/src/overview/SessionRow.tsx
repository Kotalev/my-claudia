import type { SessionSummary } from '../shared/types.js'
import { relativeTime, STATUS_LABELS, STATUS_TEXT } from '../shared/format.js'
import { StatusDot } from '../shared/StatusDot.js'
import { FOCUS_RING } from '../shared/focus.js'

/**
 * One session in a project card or sidebar. State decides the visual weight:
 * a working row carries the green rail, an orbiting dot and bright text; a
 * waiting row the amber equivalent; done rows recede at reduced opacity.
 */
export function SessionRow(
  { session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void },
) {
  const status = session.status
  const rail = status === 'active'
    ? 'border-l-[3px] border-l-work-edge bg-neutral-950/60'
    : status === 'waiting'
      ? 'border-l-[3px] border-l-alarm bg-alarm/5'
      : 'border-l-[3px] border-l-transparent'
  return (
    <button
      onClick={() => onOpen(session.sessionId)}
      data-testid="session-row"
      className={`flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-neutral-875 focus-visible:bg-neutral-875 ${rail} ${FOCUS_RING}`}
    >
      <StatusDot status={status} labelled size="sm" className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {session.live?.name && (
            <span className={`shrink-0 font-mono text-[11.5px] ${STATUS_TEXT[status]}`}>
              {session.live.name}
            </span>
          )}
          <span className={`block truncate text-[13.5px] ${status === 'active' || status === 'waiting' ? 'text-neutral-100' : 'text-neutral-300'}`}>
            {session.lastUserPrompt
              ?? session.lastAssistantText
              ?? (session.historyTruncated ? '(earlier history not loaded)' : '(no prompt yet)')}
          </span>
        </span>
        {/* The status name is printed rather than left to the dot's colour:
            amber and emerald are the pair a red-green deficiency collapses. */}
        <span className={`block font-mono text-[11px] ${status === 'done' ? 'text-dim' : 'text-faint'}`}>
          <span className={STATUS_TEXT[status]}>{STATUS_LABELS[status]}</span>
          {' · '}{relativeTime(session.lastActivity)} · {session.messageCount} msgs
          {session.hasSidechain && ' · subagents'}
          {session.historyTruncated && ' · partial history'}
          {session.skippedUnknown > 0 && ` · ${session.skippedUnknown} unknown lines`}
        </span>
      </span>
    </button>
  )
}
