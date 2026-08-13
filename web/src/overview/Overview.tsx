import { useState } from 'react'
import { apiFetch } from '../shared/api.js'
import { FolderPlus, Plug, X } from 'lucide-react'
import type { LiveState } from '../shared/useLiveState.js'
import { ProjectCard } from './ProjectCard.js'
import { LiveBand } from './LiveBand.js'
import { PermissionPrompts } from './PermissionPrompts.js'
import { PlanLimitsBar } from './PlanLimits.js'
import { SpendBar } from './SpendBar.js'
import { NotifyButton } from './NotifyButton.js'
import { AddProject } from './AddProject.js'
import { SearchBox } from './SearchBox.js'
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

  const { projects, sessions, connected, planLimits, spend, account, permissions } = live
  // Live sessions already have a home in the band above, whether or not their
  // project was ever registered here.
  const unassigned = sessions.filter(s => s.projectId === null && s.live === null)
  const unassignedPaths = [...new Set(
    unassigned.map(s => s.projectPath).filter((p): p is string => p !== null),
  )].sort()
  const pathless = unassigned.length - unassigned.filter(s => s.projectPath !== null).length

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Mission Control</h1>
        <span
          data-testid="connection"
          role="status"
          aria-live="polite"
          className={connected
            ? 'inline-flex items-center gap-[7px] rounded-[5px] border border-work/25 bg-work/10 px-2 py-1'
            : 'inline-flex items-center gap-[7px] rounded-[5px] border border-alarm/30 bg-alarm/10 px-2 py-1'}
        >
          <span
            aria-hidden="true"
            className={connected
              ? 'size-1.5 animate-breathe rounded-full bg-work'
              : 'size-1.5 animate-pulse rounded-full bg-alarm'}
          />
          <span className={`font-mono text-[10.5px] tracking-[0.12em] uppercase ${connected ? 'text-work' : 'text-alarm'}`}>
            {connected ? 'live' : 'reconnecting…'}
          </span>
        </span>
        {account && <span data-testid="account-email" className="font-mono text-xs text-faint">{account.email}</span>}
        <div className="ml-auto flex items-center gap-2.5">
          <NotifyButton />
          <button
            data-testid="add-project-toggle"
            aria-expanded={adding}
            onClick={() => setAdding(a => !a)}
            className={`inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-875 px-3 py-[7px] font-mono text-[11.5px] text-neutral-200 hover:bg-neutral-800 ${FOCUS_RING}`}
          >
            {adding
              ? <X aria-hidden="true" className="size-3.5" />
              : <FolderPlus aria-hidden="true" className="size-3.5" />}
            {adding ? 'cancel' : 'add project'}
          </button>
        </div>
      </header>

      <SearchBox onOpenSession={onOpenSession} />

      {(planLimits ?? spend) && (
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PlanLimitsBar limits={planLimits} />
          <SpendBar spend={spend} />
        </div>
      )}

      {/* Above the Live band: a prompt someone is blocked on outranks everything running. */}
      <PermissionPrompts permissions={permissions} sessions={sessions} projects={projects} />

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
        <details className="mt-6 font-mono text-[11.5px] text-faint">
          <summary className={`rounded py-1 hover:text-muted ${FOCUS_RING}`}>
            {unassigned.length} session(s) in unregistered projects
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
