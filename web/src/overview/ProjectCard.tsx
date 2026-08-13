import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ProjectRecord, SessionSummary } from '../shared/types.js'
import { SessionRow } from './SessionRow.js'
import { FOCUS_RING } from '../shared/focus.js'
import { Modal } from '../shared/Modal.js'

export function ProjectCard(
  { project, sessions, onOpenSession, onOpenProject, onRemove }:
  {
    project: ProjectRecord
    sessions: SessionSummary[]
    onOpenSession: (id: string) => void
    onOpenProject: (id: string) => void
    onRemove: (id: string) => void
  },
) {
  const active = sessions.filter(s => s.status === 'active').length
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  return (
    // min-w-0 on the section and on the heading below: a grid item defaults to
    // min-width:auto, so the `truncate` on the title did nothing — the card
    // sized to the longest project name and pushed the document sideways.
    <section
      data-testid="project-card"
      aria-labelledby={`project-${project.id}`}
      className="min-w-0 rounded-[10px] border border-neutral-800 bg-neutral-900 p-2 pb-3"
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-3.5">
        <h2 id={`project-${project.id}`} className="flex min-w-0 items-baseline gap-2.5 text-base font-semibold">
          <button
            onClick={() => onOpenProject(project.id)}
            data-testid="project-open"
            className={`max-w-full truncate rounded ${active > 0 ? 'text-neutral-100' : 'text-neutral-300'} hover:underline ${FOCUS_RING}`}
          >
            {project.name}
          </button>
          <span className="shrink-0 font-mono text-[11.5px] font-normal">
            {active > 0
              ? <><span className="text-work">{active} active</span><span className="text-faint"> · {sessions.length} total</span></>
              : <span className="text-faint">{active} active · {sessions.length} total</span>}
          </span>
        </h2>
        <button
          data-testid="project-remove"
          title={`Unregister ${project.path} (the directory is not touched)`}
          onClick={() => setConfirmingRemove(true)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 font-mono text-[11px] text-faint hover:bg-neutral-875 hover:text-danger ${FOCUS_RING}`}
        >
          <Trash2 aria-hidden="true" className="size-3" />
          remove
        </button>
      </header>
      <div className="space-y-[3px]">
        {sessions.length === 0
          ? <p className="px-3 py-2 text-sm text-faint">No sessions yet.</p>
          : sessions.slice(0, 6).map(s => <SessionRow key={s.sessionId} session={s} onOpen={onOpenSession} />)}
      </div>
      {confirmingRemove && (
        <Modal title={`Unregister ${project.name}?`} onClose={() => setConfirmingRemove(false)}>
          <p className="font-mono text-xs break-all text-muted">{project.path}</p>
          <p className="text-sm text-neutral-300">
            Only the dashboard entry is removed — nothing on disk is deleted.
          </p>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className={`rounded-[5px] border border-neutral-700 px-3 py-1.5 font-mono text-[11px] text-faint hover:text-neutral-200 ${FOCUS_RING}`}
            >
              cancel
            </button>
            <button
              type="button"
              data-testid="project-remove-confirm"
              onClick={() => { setConfirmingRemove(false); onRemove(project.id) }}
              className={`rounded-[5px] border border-danger/40 px-3 py-1.5 font-mono text-[11px] text-danger hover:bg-danger/10 ${FOCUS_RING}`}
            >
              remove
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
