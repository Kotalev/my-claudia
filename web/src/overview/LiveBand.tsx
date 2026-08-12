import { Radio } from 'lucide-react'
import type { ProjectRecord, SessionSummary } from '../shared/types.js'
import { STATUS_LABELS, STATUS_ORDER, elapsed } from '../shared/format.js'
import { ContextBar } from '../shared/ContextBar.js'
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

/**
 * The sub-rows hang under the status label. The indent used to be a literal
 * `pl-[7.5rem]` in three places, a full rem short of the real dot+gap+label+gap
 * offset — and below `sm` the label column is auto-width, so any fixed indent
 * aligns to nothing at all.
 */
const SUB_ROW = 'pl-0 sm:pl-[var(--live-indent)]'

function LiveRow(
  { session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void },
) {
  const live = session.live
  return (
    <button
      type="button"
      data-testid="live-row"
      onClick={() => onOpen(session.sessionId)}
      className={`flex w-full flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-left transition hover:border-neutral-700 hover:bg-neutral-900 focus-visible:border-neutral-700 focus-visible:bg-neutral-900 ${FOCUS_RING}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusDot status={session.status} labelled />
        {/* w-auto below sm: "waiting for you" sizes to its text rather than
            claiming 7rem of a 390px viewport. */}
        <span className="w-auto shrink-0 whitespace-nowrap text-neutral-300 sm:w-28">
          {STATUS_LABELS[session.status]}
        </span>
        {/* The session's own name leads: /rename rewrites it in the registry
            file, so it is the one label the user controls. The prompt stays —
            unrenamed sessions all carry the auto name of their directory. */}
        {live?.name && (
          <span className="max-w-40 shrink-0 truncate text-neutral-100">{live.name}</span>
        )}
        {live?.name && <span aria-hidden="true" className="shrink-0 text-faint">·</span>}
        <span className="min-w-0 flex-1 truncate text-neutral-100">
          {session.lastUserPrompt ?? <span className="text-faint">no prompt yet</span>}
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-faint">
          {session.startedAt ? elapsed(session.startedAt) : ''}
        </span>
      </div>

      <div className={SUB_ROW}>
        <ContextBar usage={session.usage} />
      </div>

      {live?.waitingFor && (
        <p className={`text-xs text-amber-400 ${SUB_ROW}`}>waiting for {live.waitingFor}</p>
      )}
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
  const name = <span className="truncate font-medium text-neutral-100">{group.label}</span>
  const projectId = group.projectId

  return (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 px-1">
      {projectId !== null
        ? (
            <button
              onClick={() => onOpenProject(projectId)}
              title={group.path ?? undefined}
              className={`flex min-w-0 rounded text-sm hover:underline ${FOCUS_RING}`}
            >
              {name}
            </button>
          )
        // An unregistered project has no card to open, so it is not a control.
        : <span className="flex min-w-0 text-sm" title={group.path ?? undefined}>{name}</span>}
      <span className="shrink-0 text-xs text-faint">
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
  const waiting = liveSessions.filter(s => s.live?.waitingFor).length

  const summary = liveSessions.length === 0
    ? 'nothing running'
    : `${liveSessions.length} process${liveSessions.length === 1 ? '' : 'es'}`
      + ` in ${groups.length} project${groups.length === 1 ? '' : 's'}`
      + (waiting > 0 ? ` · ${waiting} waiting for you` : '')

  return (
    <section className="mb-8" data-testid="live-band">
      <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold tracking-wide uppercase text-muted">
        <Radio aria-hidden="true" className="size-4" />
        Live
        {/* The one place worth announcing: a session going quiet is not news,
            a session blocked on you is. */}
        <span
          data-testid="live-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-xs font-normal normal-case text-faint"
        >
          {summary}
        </span>
      </h2>

      <div className="flex flex-col gap-4">
        {groups.map(group => (
          <section key={group.key} data-testid="live-group" className="min-w-0">
            <GroupHeading group={group} onOpenProject={onOpenProject} />
            <div className="flex flex-col gap-2">
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
