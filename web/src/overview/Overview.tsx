import { useState } from 'react'
import { apiFetch } from '../shared/api.js'
import { FolderPlus, Plug, Wifi, WifiOff, X } from 'lucide-react'
import type { LiveState } from '../shared/useLiveState.js'
import { ProjectCard } from './ProjectCard.js'
import { LiveBand } from './LiveBand.js'
import { PlanLimitsBar } from './PlanLimits.js'
import { SpendBar } from './SpendBar.js'
import { NotifyButton } from './NotifyButton.js'
import { AddProject } from './AddProject.js'
import { registerPath } from './register.js'
import { Page } from '../shared/Page.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import { FOCUS_RING } from '../shared/focus.js'
import { useClockTick } from '../shared/useClockTick.js'

export function Overview(
  { live, onOpenSession, onOpenProject }:
  { live: LiveState; onOpenSession: (id: string) => void; onOpenProject: (id: string) => void },
) {
  const [adding, setAdding] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // Every "Xm ago" on this screen is computed at render, and renders only
  // happen when a socket message arrives.
  useClockTick()

  // The list refreshes from the projects.updated broadcast, so nothing is
  // removed locally here — the server's answer is what the tab shows. A
  // failure has to surface, though: the user just confirmed a dialog.
  const remove = async (id: string): Promise<void> => {
    try {
      const res = await apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
      setRemoveError(res.ok ? null : `Could not unregister — the server answered ${res.status}.`)
    } catch {
      setRemoveError('Could not unregister — the server is unreachable.')
    }
  }

  const { projects, sessions, connected, planLimits, spend, account } = live
  // Live sessions already have a home in the band above, whether or not their
  // project was ever registered here.
  const unassigned = sessions.filter(s => s.projectId === null && s.live === null)
  const unassignedPaths = [...new Set(
    unassigned.map(s => s.projectPath).filter((p): p is string => p !== null),
  )].sort()
  const pathless = unassigned.length - unassigned.filter(s => s.projectPath !== null).length

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold">Mission Control</h1>
        <span
          data-testid="connection"
          role="status"
          aria-live="polite"
          className={connected
            ? 'inline-flex items-center gap-1.5 text-xs text-faint'
            : 'inline-flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400'}
        >
          {connected
            ? <Wifi aria-hidden="true" className="size-3.5" />
            : <WifiOff aria-hidden="true" className="size-3.5 animate-pulse motion-reduce:animate-none" />}
          {connected ? 'live' : 'reconnecting…'}
        </span>
        {account && <span data-testid="account-email" className="text-xs text-muted">{account.email}</span>}
        <div className="ml-auto flex items-center gap-3">
          <NotifyButton />
          <button
            data-testid="add-project-toggle"
            aria-expanded={adding}
            onClick={() => setAdding(a => !a)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:text-neutral-100 ${FOCUS_RING}`}
          >
            {adding
              ? <X aria-hidden="true" className="size-3.5" />
              : <FolderPlus aria-hidden="true" className="size-3.5" />}
            {adding ? 'cancel' : 'add project'}
          </button>
        </div>
      </header>

      <PlanLimitsBar limits={planLimits} />

      <SpendBar spend={spend} />

      <LiveBand sessions={sessions} projects={projects} onOpen={onOpenSession} onOpenProject={onOpenProject} />

      {(adding || projects.length === 0) && <AddProject onDone={() => setAdding(false)} />}

      {removeError && <ErrorLine testId="remove-error" className="mb-4">{removeError}</ErrorLine>}

      {/* The explicit grid-cols-1 matters: a grid with no column class gets an
          implicit auto track, which sizes to its content and pushes the page
          sideways on a narrow viewport. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            sessions={sessions.filter(s => s.projectId === p.id)}
            onOpenSession={onOpenSession}
            onOpenProject={onOpenProject}
            onRemove={id => { void remove(id) }}
          />
        ))}
      </div>

      {unassigned.length > 0 && (
        <details className="mt-6 text-sm text-faint">
          <summary className={`rounded py-1 ${FOCUS_RING}`}>
            {unassigned.length} session(s) in unregistered projects.
          </summary>
          <ul className="mt-2 space-y-1">
            {unassignedPaths.map(path => (
              <li key={path} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
                <button
                  onClick={() => { void registerPath(path) }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded border border-neutral-700 px-2 py-0.5 text-xs text-muted hover:bg-neutral-800 hover:text-neutral-100 ${FOCUS_RING}`}
                >
                  <Plug aria-hidden="true" className="size-3" />
                  register
                </button>
              </li>
            ))}
            {pathless > 0 && (
              // Honest, and still a dead end for a reason: the escaped
              // directory name is lossy, so we cannot recover a path to offer.
              <li className="text-xs">{pathless} session(s) with no known path.</li>
            )}
          </ul>
        </details>
      )}
    </Page>
  )
}
