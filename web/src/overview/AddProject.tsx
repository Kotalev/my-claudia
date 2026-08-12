import { useState, type FormEvent } from 'react'
import { FolderPlus } from 'lucide-react'
import { FOCUS_RING } from '../shared/focus.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import { registerPath } from './register.js'

/**
 * The empty state used to tell the user to open a terminal and POST a path,
 * and once the grid was non-empty there was no way to add a project at all.
 * One panel serves both: it is shown when there is nothing to show, and
 * toggled from the header otherwise.
 */
export function AddProject({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = path.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    const message = await registerPath(trimmed)
    setBusy(false)
    if (message === null) {
      setPath('')
      onDone()
      return
    }
    setError(message)
  }

  return (
    <form
      data-testid="add-project"
      onSubmit={e => { void submit(e) }}
      className="mb-6 space-y-2 rounded-xl border border-dashed border-neutral-800 p-4 sm:p-6"
    >
      <label htmlFor="project-path" className="block text-sm text-neutral-200">
        Absolute path to a project directory
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="project-path"
          data-testid="add-project-input"
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="/Users/you/code/thing"
          className={`min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm ${FOCUS_RING} focus:border-neutral-600`}
        />
        <button
          data-testid="add-project-submit"
          disabled={busy || path.trim().length === 0}
          className={`inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40 ${FOCUS_RING}`}
        >
          <FolderPlus aria-hidden="true" className="size-4" />
          {busy ? 'Adding…' : 'Add project'}
        </button>
      </div>
      {error && <ErrorLine testId="add-project-error">{error}</ErrorLine>}
      <p className="text-xs text-faint">
        The same thing as POSTing a path to <code>/api/projects</code>. Nothing on disk is written —
        only this dashboard learns about the directory.
      </p>
    </form>
  )
}
