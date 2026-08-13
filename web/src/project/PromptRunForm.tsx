import { useEffect, useState, type FormEvent } from 'react'
import { Play } from 'lucide-react'
import { apiFetch } from '../shared/api.js'
import { FOCUS_RING } from '../shared/focus.js'
import { ErrorLine } from '../shared/ErrorLine.js'
import { Modal } from '../shared/Modal.js'
import type { PromptTemplate } from '../shared/types.js'

/**
 * A run from a free prompt: no TASKS.md task behind it, otherwise a normal
 * dispatch. The resulting run streams in the RunPanel list like any other.
 * Saved templates fill the textarea; the list is fetched once on mount —
 * templates change rarely, so no broadcast.
 */
export function PromptRunForm({ onDispatch }: { onDispatch: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [naming, setNaming] = useState(false)
  const [templateName, setTemplateName] = useState('')

  useEffect(() => {
    let cancelled = false
    void apiFetch('/api/templates')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`templates unavailable (${r.status})`))))
      .then((d: { templates: PromptTemplate[] }) => { if (!cancelled) setTemplates(d.templates) })
      .catch(() => { /* no templates is a working form, not an error */ })
    return () => { cancelled = true }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (trimmed.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onDispatch(trimmed)
      setText('')   // cleared only on success: a failed submit keeps the typing
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start the run')
    } finally {
      setBusy(false)
    }
  }

  const pickTemplate = (id: string): void => {
    setSelectedId(id)
    const template = templates.find(t => t.id === id)
    if (template) setText(template.text)
  }

  const saveTemplate = async (): Promise<void> => {
    const name = templateName.trim()
    if (!name) return
    setNaming(false)
    setTemplateName('')
    setError(null)
    const res = await apiFetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `could not save the template (${res.status})`)
      return
    }
    const { template } = await res.json() as { template: PromptTemplate }
    setTemplates(prev => [...prev, template].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedId(template.id)
  }

  const deleteTemplate = async (): Promise<void> => {
    if (!selectedId) return
    setError(null)
    const res = await apiFetch(`/api/templates/${selectedId}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `could not delete the template (${res.status})`)
      return
    }
    setTemplates(prev => prev.filter(t => t.id !== selectedId))
    setSelectedId('')
  }

  return (
    <>
    <form onSubmit={submit} className="space-y-1">
      <label htmlFor="prompt-run" className="sr-only">New run from a prompt</label>
      <textarea
        id="prompt-run"
        data-testid="prompt-run-input"
        aria-describedby="prompt-run-hint"
        rows={2}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Or dispatch a run from a free prompt…"
        className={`w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 text-sm ${FOCUS_RING} focus:border-info`}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          data-testid="prompt-run-submit"
          disabled={busy || text.trim().length === 0}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-875 px-4 py-2 font-mono text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 ${FOCUS_RING}`}
        >
          <Play aria-hidden="true" className="size-3.5" />
          Run
        </button>
        <label htmlFor="prompt-template" className="sr-only">Fill from a template</label>
        <select
          id="prompt-template"
          data-testid="prompt-template-select"
          value={selectedId}
          onChange={e => pickTemplate(e.target.value)}
          className={`max-w-48 rounded-[5px] border border-neutral-700 bg-neutral-900 px-2 py-1.5
            font-mono text-[11px] text-muted ${FOCUS_RING}`}
        >
          <option value="">template…</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button
          type="button"
          data-testid="prompt-template-save"
          onClick={() => setNaming(true)}
          disabled={text.trim().length === 0}
          className={`rounded-[5px] border border-neutral-700 px-2 py-1 font-mono text-[11px] text-faint hover:text-neutral-200 disabled:opacity-40 ${FOCUS_RING}`}
        >
          save as template
        </button>
        {selectedId && (
          <button
            type="button"
            data-testid="prompt-template-delete"
            onClick={() => void deleteTemplate()}
            className={`rounded-[5px] border border-neutral-700 px-2 py-1 font-mono text-[11px] text-faint hover:text-danger ${FOCUS_RING}`}
          >
            delete template
          </button>
        )}
        <p id="prompt-run-hint" className="font-mono text-[11px] text-dim">
          Starts claude -p with this prompt — no task required.
        </p>
      </div>
      {error && <ErrorLine testId="prompt-run-error" className="text-xs">{error}</ErrorLine>}
    </form>
    {/* Outside the run <form>: nesting forms is invalid HTML, and the modal
        carries its own form so Enter saves. */}
    {naming && (
      <Modal title="Save as template" onClose={() => { setNaming(false); setTemplateName('') }}>
        <form
          onSubmit={e => { e.preventDefault(); void saveTemplate() }}
          className="space-y-3"
        >
          <label htmlFor="template-name" className="sr-only">Template name</label>
          <input
            id="template-name"
            data-testid="template-name-input"
            autoFocus
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="Template name…"
            className={`w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm ${FOCUS_RING} focus:border-info`}
          />
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => { setNaming(false); setTemplateName('') }}
              className={`rounded-[5px] border border-neutral-700 px-3 py-1.5 font-mono text-[11px] text-faint hover:text-neutral-200 ${FOCUS_RING}`}
            >
              cancel
            </button>
            <button
              data-testid="template-name-save"
              disabled={templateName.trim().length === 0}
              className={`rounded-[5px] border border-neutral-700 bg-neutral-875 px-3 py-1.5 font-mono text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 ${FOCUS_RING}`}
            >
              save
            </button>
          </div>
        </form>
      </Modal>
    )}
    </>
  )
}
