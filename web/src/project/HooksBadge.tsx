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
    <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px]">
      {installed
        ? (
            <span data-testid="hooks-status" className="inline-flex items-center gap-1.5 text-work">
              <CircleCheck aria-hidden="true" className="size-3.5" />
              hooks installed
            </span>
          )
        : (
            <span
              data-testid="hooks-status"
              className="inline-flex items-center gap-[7px] rounded-md border border-alarm/25 bg-alarm/5 px-2.5 py-[5px] text-alarm"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-alarm" />
              hooks not installed
            </span>
          )}
      {!installed && (
        <>
          <button
            data-testid="install-hooks"
            onClick={install}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-875 px-2.5 py-[5px] text-[11.5px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 ${FOCUS_RING}`}
          >
            <Plug aria-hidden="true" className="size-3" />
            {busy ? 'installing…' : 'Install hooks'}
          </button>
          {/* The backup was only mentioned after the write. */}
          <span className="text-dim">writes .claude/settings.local.json (backed up first)</span>
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
