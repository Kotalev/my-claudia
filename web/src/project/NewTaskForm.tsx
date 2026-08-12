import { useState, type FormEvent } from 'react'

export function NewTaskForm({ onCreate }: { onCreate: (title: string, tags: string[]) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    // Tags are typed inline as #tag and stripped out of the title.
    const tags = [...trimmed.matchAll(/#([a-zA-Z0-9_-]+)/g)].map(m => m[1]!)
    try {
      await onCreate(trimmed.replace(/#[a-zA-Z0-9_-]+/g, '').replace(/\s+/g, ' ').trim(), tags)
      setTitle('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        data-testid="new-task-input"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="New task… (use #tags)"
        className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
      />
      <button
        data-testid="new-task-submit"
        disabled={busy || title.trim().length === 0}
        className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
      >
        Add
      </button>
    </form>
  )
}
