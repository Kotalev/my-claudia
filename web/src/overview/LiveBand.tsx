import type { SessionSummary } from '../shared/types.js'
import { STATUS_STYLES, STATUS_LABELS, STATUS_ORDER, elapsed } from '../shared/format.js'
import { ContextBar } from '../shared/ContextBar.js'

/** `cli` / `sdk-cli` / `bg` — how this process was started. */
function kindChip(session: SessionSummary): string {
  const live = session.live
  if (!live) return ''
  if (live.kind === 'background') return 'bg'
  return live.entrypoint ?? 'cli'
}

function projectLabel(session: SessionSummary): string {
  // The process states its own name and cwd, so an unregistered project is still
  // named properly rather than guessed from the lossy escaped directory.
  if (session.live?.name) return session.live.name
  const path = session.projectPath
  if (!path) return 'path unknown'
  return path.split('/').filter(Boolean).pop() ?? path
}

function LiveRow(
  { session, onOpen }: { session: SessionSummary; onOpen: (id: string) => void },
) {
  const live = session.live
  return (
    <button
      type="button"
      data-testid="live-row"
      onClick={() => onOpen(session.sessionId)}
      className="flex w-full flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-left transition hover:border-neutral-700 hover:bg-neutral-900"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className={`size-2 shrink-0 rounded-full ${STATUS_STYLES[session.status]}`} />
        <span className="w-28 shrink-0 text-neutral-300">{STATUS_LABELS[session.status]}</span>
        <span className="truncate font-medium text-neutral-100">{projectLabel(session)}</span>
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
          {kindChip(session)}
        </span>
        <span className="ml-auto shrink-0 font-mono text-xs text-neutral-500">
          {session.sessionId.slice(0, 8)}
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-neutral-500">
          {elapsed(session.startedAt)}
        </span>
      </div>

      <div className="pl-[7.5rem]">
        <ContextBar usage={session.usage} />
      </div>

      {session.lastUserPrompt && (
        <p className="truncate pl-[7.5rem] text-xs text-neutral-500">
          {session.lastUserPrompt}
        </p>
      )}

      {live?.waitingFor && (
        <p className="pl-[7.5rem] text-xs text-amber-400">waiting for {live.waitingFor}</p>
      )}
    </button>
  )
}

/**
 * Every running `claude` process on this machine, whichever project it is in and
 * whether or not that project was ever registered here. This band is the top of
 * the page and is always rendered: "nothing is running" is itself an answer.
 */
export function LiveBand(
  { sessions, onOpen }: { sessions: SessionSummary[]; onOpen: (id: string) => void },
) {
  const liveSessions = sessions
    .filter(s => s.live !== null)
    .sort((a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || a.startedAt.localeCompare(b.startedAt))

  return (
    <section className="mb-8" data-testid="live-band">
      <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Live
        <span data-testid="live-count" className="text-xs font-normal normal-case text-neutral-500">
          {liveSessions.length === 0
            ? 'nothing running'
            : `${liveSessions.length} process${liveSessions.length === 1 ? '' : 'es'}`}
        </span>
      </h2>

      <div className="flex flex-col gap-2">
        {liveSessions.map(s => (
          <LiveRow key={s.sessionId} session={s} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}
