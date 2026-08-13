import type { ProjectRecord, SessionSummary } from '../shared/types.js'
import { STATUS_LABELS, STATUS_ORDER, STATUS_TEXT, elapsed } from '../shared/format.js'
import { ContextBar, contextPressure } from '../shared/ContextBar.js'
import { StatusDot } from '../shared/StatusDot.js'
import { FOCUS_RING } from '../shared/focus.js'

function projectLabel(session: SessionSummary): string {
  // The process states its own name and cwd, so an unregistered project is still
  // named properly rather than guessed from the lossy escaped directory.
  if (session.live?.name) return session.live.name
  const path = session.projectPath
  if (!path) return 'path unknown'
  return path.split('/').filter(Boolean).pop() ?? path
}

/**
 * Two live sessions belong together when they are in the same directory. The
 * registered id alone is not enough: a process in an unregistered project has
 * no id at all, and two of those in one directory must still group. Falling
 * back to the label instead of the path would merge two different directories
 * that happen to share a basename — a worktree beside its checkout is exactly
 * that case.
 */
function groupKey(session: SessionSummary): string {
  return session.projectId ?? session.projectPath ?? `session:${session.sessionId}`
}

interface LiveGroup {
  key: string
  label: string
  /** Set only for a registered project — the card the heading opens. */
  projectId: string | null
  path: string | null
  sessions: SessionSummary[]
}

/** The sub-rows hang under the indicator: dot width + gap, from the token layer. */
const SUB_ROW = 'pl-0 sm:pl-[var(--live-indent)]'

/**
 * One live process. State carries the whole treatment: a working row gets the
 * green rail and an orbiting indicator; a waiting row is the alarm — amber
 * ground, a pulsing dot and a beacon ring in phase with it, sorted above
 * everything else by the existing status order.
 */
function LiveRow(
  { session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void },
) {
  const live = session.live
  const status = session.status
  const waiting = status === 'waiting'
  const surface = waiting
    ? 'animate-beacon border border-alarm/30 border-l-[3px] border-l-alarm bg-alarm/5'
    : status === 'active'
      ? 'border border-[#1a201d] border-l-[3px] border-l-work-edge bg-neutral-900'
      : 'border border-neutral-800 border-l-[3px] border-l-transparent bg-neutral-900'

  return (
    <button
      type="button"
      data-testid="live-row"
      onClick={() => onOpen(session.sessionId)}
      className={`flex w-full items-start gap-3.5 rounded-[9px] px-4 py-3.5 text-left transition hover:border-neutral-700 focus-visible:border-neutral-700 ${surface} ${FOCUS_RING}`}
    >
      <StatusDot status={status} labelled className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-3.5">
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {/* The session's own name leads: /rename rewrites it in the
                registry file, so it is the one label the user controls. */}
            {live?.name && (
              <>
                <span className={`max-w-48 shrink-0 truncate font-mono text-[13px] ${STATUS_TEXT[status]}`}>
                  {live.name}
                </span>
                <span aria-hidden="true" className="shrink-0 font-mono text-xs text-neutral-600">·</span>
              </>
            )}
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-neutral-100">
              {session.lastUserPrompt ?? <span className="font-normal text-faint">no prompt yet</span>}
            </span>
          </span>
          <span className={`shrink-0 font-mono text-xs ${waiting ? 'text-alarm' : 'text-muted'}`}>
            {session.startedAt ? elapsed(session.startedAt) : ''}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={`font-mono text-[10.5px] tracking-[0.1em] uppercase ${STATUS_TEXT[status]}`}>
            {STATUS_LABELS[status]}
          </span>
          {/* How long the prompt has been open — statusUpdatedAt is written only
              on the transition, so it dates the wait itself. Null means the
              transition was never dated, and an undated wait gets no timer. */}
          {waiting && live?.statusUpdatedAt && (
            <span className="font-mono text-[11px] text-alarm">
              waiting {elapsed(live.statusUpdatedAt)}
            </span>
          )}
          {session.gitBranch && (
            <span className="max-w-40 truncate font-mono text-[11px] text-muted">
              {session.gitBranch}
            </span>
          )}
          <ContextBar usage={session.usage} working={status === 'active'} />
          {contextPressure(session.usage) && (
            <span data-testid="compaction-hint" className="font-mono text-[11px] text-alarm">
              compaction soon
            </span>
          )}
        </span>
        {session.filesTouched.length > 0 && (
          <span className={`flex flex-wrap gap-x-2.5 gap-y-0.5 ${SUB_ROW}`}>
            {session.filesTouched.slice(-3).map(path => (
              <span
                key={path}
                title={path}
                className="max-w-44 truncate font-mono text-[11px] text-faint"
              >
                {path.split('/').pop() ?? path}
              </span>
            ))}
          </span>
        )}
        {live?.waitingFor && (
          <span className={`font-mono text-xs text-alarm ${SUB_ROW}`}>waiting for {live.waitingFor}</span>
        )}
      </span>
    </button>
  )
}

/** waiting outranks working outranks idle, for a group as for a row. */
function mostUrgent(sessions: SessionSummary[]): number {
  return Math.min(...sessions.map(s => STATUS_ORDER[s.status]))
}

/**
 * @param projectNames registered id -> registered name. A group heading opens
 *   that project's card, so it has to carry the name written on the card: the
 *   process's own `name` is whatever the shell called the directory and drifts
 *   from the registration.
 */
export function groupLiveSessions(
  sessions: SessionSummary[],
  projectNames: Map<string, string> = new Map(),
): LiveGroup[] {
  const groups = new Map<string, LiveGroup>()
  for (const session of sessions) {
    const key = groupKey(session)
    let group = groups.get(key)
    if (!group) {
      const registered = session.projectId === null ? undefined : projectNames.get(session.projectId)
      group = {
        key,
        label: registered ?? projectLabel(session),
        projectId: session.projectId,
        path: session.projectPath,
        sessions: [],
      }
      groups.set(key, group)
    }
    group.sessions.push(session)
  }

  for (const group of groups.values()) {
    group.sessions.sort((a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || a.startedAt.localeCompare(b.startedAt))
  }

  // A project with something blocked on the user comes first, exactly as a
  // blocked row did before grouping.
  return [...groups.values()].sort((a, b) =>
    mostUrgent(a.sessions) - mostUrgent(b.sessions)
    || a.sessions[0]!.startedAt.localeCompare(b.sessions[0]!.startedAt))
}

function GroupHeading(
  { group, onOpenProject }: { group: LiveGroup; onOpenProject: (id: string) => void },
) {
  const name = <span className="truncate font-mono text-[11.5px] text-faint">{group.label}</span>
  const projectId = group.projectId

  return (
    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 px-1">
      {projectId !== null
        ? (
            <button
              onClick={() => onOpenProject(projectId)}
              title={group.path ?? undefined}
              className={`flex min-w-0 rounded hover:underline ${FOCUS_RING}`}
            >
              {name}
            </button>
          )
        // An unregistered project has no card to open, so it is not a control.
        : <span className="flex min-w-0" title={group.path ?? undefined}>{name}</span>}
      <span className="shrink-0 font-mono text-[11px] text-dim">
        {group.sessions.length} process{group.sessions.length === 1 ? '' : 'es'}
        {projectId === null && ' · not registered'}
      </span>
    </div>
  )
}

/**
 * Every running `claude` process on this machine, grouped by the directory it
 * runs in, whether or not that project was ever registered here. This band is
 * the top of the page and is always rendered: "nothing is running" is itself an
 * answer.
 */
export function LiveBand(
  { sessions, projects, onOpen, onOpenProject }:
  {
    sessions: SessionSummary[]
    projects: ProjectRecord[]
    onOpen: (id: string) => void
    onOpenProject: (id: string) => void
  },
) {
  const liveSessions = sessions.filter(s => s.live !== null)
  const groups = groupLiveSessions(liveSessions, new Map(projects.map(p => [p.id, p.name])))
  // Derived from the same field the rows render, so the summary cannot drift.
  const waiting = liveSessions.filter(s => s.status === 'waiting').length

  const summary = liveSessions.length === 0
    ? 'nothing running'
    : `${liveSessions.length} process${liveSessions.length === 1 ? '' : 'es'}`
      + ` in ${groups.length} project${groups.length === 1 ? '' : 's'}`

  return (
    <section className="mb-8" data-testid="live-band">
      <h2 className="mb-3.5 flex flex-wrap items-center gap-3 font-mono">
        <span className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-work">live</span>
        {/* The one place worth announcing: a session going quiet is not news,
            a session blocked on you is. */}
        <span
          data-testid="live-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-xs font-normal text-muted"
        >
          {summary}
          <span className="sr-only">{waiting > 0 ? ` · ${waiting} waiting for you` : ''}</span>
        </span>
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-neutral-875" />
        {waiting > 0
          ? (
              <span className="animate-beacon rounded-[5px] border border-alarm/30 px-2 py-1 text-[11px] font-normal tracking-[0.1em] uppercase text-alarm">
                {waiting} waiting on you
              </span>
            )
          : <span className="text-[11px] font-normal text-dim">nothing waiting</span>}
      </h2>

      <div className="flex flex-col gap-4">
        {groups.map(group => (
          <section key={group.key} data-testid="live-group" className="min-w-0">
            <GroupHeading group={group} onOpenProject={onOpenProject} />
            <div className="flex flex-col gap-1.5">
              {group.sessions.map(s => (
                <LiveRow key={s.sessionId} session={s} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
