import { useCallback, useEffect, useState } from 'react'

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

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/hooks`)
    if (res.ok) setInstalled((await res.json()).installed)
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  const install = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/hooks/install`, { method: 'POST' })
      if (res.ok) {
        setResult((await res.json()).result)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  if (installed === null) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span data-testid="hooks-status" className={installed ? 'text-emerald-400' : 'text-neutral-500'}>
        {installed ? 'hooks installed' : 'hooks not installed'}
      </span>
      {!installed && (
        <button
          data-testid="install-hooks"
          onClick={install}
          disabled={busy}
          className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          {busy ? 'installing…' : 'Install hooks'}
        </button>
      )}
      {result && (
        <span className="text-neutral-500">
          added {result.installed.join(', ') || 'nothing'}
          {result.backupPath && ' · previous settings backed up'}
        </span>
      )}
    </div>
  )
}
