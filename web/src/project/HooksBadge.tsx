import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../shared/api.js'
import { CircleCheck, Plug } from 'lucide-react'
import { FOCUS_RING } from '../shared/focus.js'
import { ErrorLine } from '../shared/ErrorLine.js'

interface InstallResult {
  settingsPath: string
  backupPath: string | null
  installed: string[]
  alreadyPresent: string[]
}

export function HooksBadge({ projectId }: { projectId: string }) {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InstallResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/hooks`)
    if (res.ok) setInstalled((await res.json()).installed)
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  const install = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/hooks/install`, { method: 'POST' })
      if (res.ok) {
        setResult((await res.json()).result)
        await refresh()
      } else {
        // Without this the button simply reads "Install hooks" again, which is
        // indistinguishable from a click that never registered.
        setError(`the server answered ${res.status}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the server is unreachable')
    } finally {
      setBusy(false)
    }
  }

  if (installed === null) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        data-testid="hooks-status"
        className={`inline-flex items-center gap-1.5 ${installed ? 'text-emerald-400' : 'text-muted'}`}
      >
        {installed
          ? <CircleCheck aria-hidden="true" className="size-3.5" />
          : <Plug aria-hidden="true" className="size-3.5" />}
        {installed ? 'hooks installed' : 'hooks not installed'}
      </span>
      {!installed && (
        <>
          <button
            data-testid="install-hooks"
            onClick={install}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 ${FOCUS_RING}`}
          >
            <Plug aria-hidden="true" className="size-3" />
            {busy ? 'installing…' : 'Install hooks'}
          </button>
          {/* The backup was only mentioned after the write. */}
          <span className="text-faint">writes .claude/settings.local.json (backed up first)</span>
        </>
      )}
      {error && <ErrorLine testId="hooks-error" className="text-xs">install failed — {error}</ErrorLine>}
      {result && (
        <span className="text-muted">
          added {result.installed.join(', ') || 'nothing'}
          {result.backupPath && ' · previous settings backed up'}
        </span>
      )}
    </div>
  )
}
