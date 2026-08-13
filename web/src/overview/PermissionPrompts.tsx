import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { PermissionRequestInfo, ProjectRecord, SessionSummary } from '../shared/types.js'
import { apiFetch } from '../shared/api.js'
import { FOCUS_RING } from '../shared/focus.js'
import { remainingMs } from './permission-window.js'

/** The registered project name where there is one, else the session's own label. */
function contextLabel(
  request: PermissionRequestInfo,
  sessions: SessionSummary[],
  projects: ProjectRecord[],
): string {
  const session = sessions.find(s => s.sessionId === request.sessionId)
  const registered = session?.projectId != null
    ? projects.find(p => p.id === session.projectId)?.name
    : undefined
  if (registered) return registered
  if (session?.live?.name) return session.live.name
  const path = request.cwd ?? session?.projectPath ?? null
  if (!path) return 'unknown project'
  return path.split('/').filter(Boolean).pop() ?? path
}

function PromptCard(
  { request, sessions, projects, secondsLeft }:
  {
    request: PermissionRequestInfo
    sessions: SessionSummary[]
    projects: ProjectRecord[]
    secondsLeft: number
  },
) {
  // Once a button is pressed the card waits for `permission.resolved` (or the
  // window) to withdraw it; letting a second click race the first helps nobody.
  const [answered, setAnswered] = useState(false)

  const decide = (behavior: 'allow' | 'deny'): void => {
    setAnswered(true)
    // Fire and forget: the resolved broadcast withdraws the card, and a 404
    // means the window already lapsed — which the countdown shows anyway.
    void apiFetch(`/api/permissions/${request.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ behavior }),
    }).catch(() => {})
  }

  return (
    <div
      data-testid="permission-card"
      className="animate-beacon flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[9px] border border-alarm/40 border-l-[3px] border-l-alarm bg-alarm/10 px-4 py-3.5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-alarm">
            permission
          </span>
          <span className="max-w-48 truncate font-mono text-[11.5px] text-faint">
            {contextLabel(request, sessions, projects)}
          </span>
          <span className="font-mono text-xs text-neutral-100">{request.toolName}</span>
        </span>
        {request.toolInputSummary && (
          <span
            title={request.toolInputSummary}
            className="truncate font-mono text-[11.5px] text-muted"
          >
            {request.toolInputSummary}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="font-mono text-[11px] text-alarm" aria-label={`${secondsLeft} seconds left`}>
          {secondsLeft}s
        </span>
        <button
          data-testid="permission-allow"
          disabled={answered}
          onClick={() => decide('allow')}
          className={`inline-flex items-center gap-1.5 rounded-md border border-work/40 bg-work/10 px-3 py-[7px] font-mono text-[11.5px] text-work hover:bg-work/20 disabled:opacity-40 ${FOCUS_RING}`}
        >
          <Check aria-hidden="true" className="size-3.5" />
          Allow
        </button>
        <button
          data-testid="permission-deny"
          disabled={answered}
          onClick={() => decide('deny')}
          className={`inline-flex items-center gap-1.5 rounded-md border border-alarm/40 bg-alarm/10 px-3 py-[7px] font-mono text-[11.5px] text-alarm hover:bg-alarm/20 disabled:opacity-40 ${FOCUS_RING}`}
        >
          <X aria-hidden="true" className="size-3.5" />
          Deny
        </button>
      </span>
    </div>
  )
}

/**
 * The permission prompts Claude Code is holding open right now, each with the
 * seconds it will keep waiting for a click. Renders nothing when nothing is
 * pending — unlike the Live band, silence needs no announcement here.
 */
export function PermissionPrompts(
  { permissions, sessions, projects }:
  {
    permissions: PermissionRequestInfo[]
    sessions: SessionSummary[]
    projects: ProjectRecord[]
  },
) {
  const [now, setNow] = useState(() => Date.now())
  const anyPending = permissions.length > 0
  useEffect(() => {
    // A 1s tick, and only while a countdown is on screen.
    if (!anyPending) return
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [anyPending])

  const open = permissions.filter(p => remainingMs(p.createdAt, now) > 0)
  if (open.length === 0) return null

  return (
    <section className="mb-8" data-testid="permission-prompts" aria-live="assertive">
      <div className="flex flex-col gap-1.5">
        {open.map(request => (
          <PromptCard
            key={request.id}
            request={request}
            sessions={sessions}
            projects={projects}
            secondsLeft={Math.ceil(remainingMs(request.createdAt, now) / 1000)}
          />
        ))}
      </div>
    </section>
  )
}
