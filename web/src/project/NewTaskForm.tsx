import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { FOCUS_RING } from '../shared/focus.js'
import { ErrorLine } from '../shared/ErrorLine.js'

export function NewTaskForm({ onCreate }: { onCreate: (title: string, tags: string[]) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    // Tags are typed inline as #tag and stripped out of the title.
    const tags = [...trimmed.matchAll(/#([a-zA-Z0-9_-]+)/g)].map(m => m[1]!)
    try {
      await onCreate(trimmed.replace(/#[a-zA-Z0-9_-]+/g, '').replace(/\s+/g, ' ').trim(), tags)
      setTitle('')   // cleared only on success: a failed submit keeps the typing
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not add the task')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <form onSubmit={submit} className="flex items-start gap-2">
        <label htmlFor="new-task" className="sr-only">New task</label>
        <textarea
          id="new-task"
          data-testid="new-task-input"
          aria-describedby="new-task-hint"
          rows={2}
          value={title}
          onChange={e => setTitle(e.target.value)}
          // Enter submits like the old <input>; Shift+Enter makes a newline.
          // Any newlines that survive are collapsed by the \s+ replace on submit.
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="New task… (use #tags)"
          // `outline-none` used to be here with only a neutral-800 → 600 border
          // shift as the replacement: 1.23:1 against the field, so a keyboard
          // user could not see where they were.
          className={`min-w-0 flex-1 resize-y rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 text-sm ${FOCUS_RING} focus:border-info`}
        />
        <button
          data-testid="new-task-submit"
          disabled={busy || title.trim().length === 0}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-875 px-4 py-2.5 font-mono text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 ${FOCUS_RING}`}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add
        </button>
      </form>
      {/* The placeholder was the only mention of the #tag convention, and it
          disappeared on the first keystroke. */}
      <p id="new-task-hint" className="font-mono text-[11px] text-dim">
        Type #tags inline; they are stripped from the title.
      </p>
      {error && <ErrorLine testId="new-task-error" className="text-xs">{error}</ErrorLine>}
    </div>
  )
}
