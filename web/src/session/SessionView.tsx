import { useEffect, useRef, useState } from 'react'
import { useSessionDetail } from './useSessionDetail.js'
import { TimelineEntry } from './TimelineEntry.js'
import { relativeTime, STATUS_STYLES } from '../shared/format.js'
import { TelemetryPanel } from './TelemetryPanel.js'

export function SessionView(
  { sessionId, liveActivity, onBack }:
  { sessionId: string; liveActivity: string | null; onBack: () => void },
) {
  const { summary, entries, loading } = useSessionDetail(sessionId, liveActivity)
  const [follow, setFollow] = useState(true)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length, follow])

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 px-8 py-4 backdrop-blur">
        <button onClick={onBack} className="mb-2 text-sm text-neutral-400 hover:text-neutral-100">
          ← Overview
        </button>
        {summary && (
          <div className="flex items-center gap-3">
            <span className={`size-2 shrink-0 rounded-full ${STATUS_STYLES[summary.status]}`} />
            <h1 className="truncate font-mono text-sm">{summary.sessionId}</h1>
            <span className="shrink-0 text-xs text-neutral-500">
              {relativeTime(summary.lastActivity)} · {summary.messageCount} msgs
              {summary.versions.length > 0 && ` · cc ${summary.versions.join(', ')}`}
              {summary.skippedUnknown > 0 && ` · ${summary.skippedUnknown} unknown lines`}
            </span>
            <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
              <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
              Follow
            </label>
          </div>
        )}
      </header>

      <div className="space-y-1 px-8 py-6">
        {summary?.historyTruncated && (
          <p className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-500">
            Only the tail of this transcript was loaded — it was already large when the dashboard started.
          </p>
        )}
        {summary && <TelemetryPanel usage={summary.usage} truncated={summary.historyTruncated} />}
        {loading && <p className="text-neutral-500">Loading…</p>}
        {!loading && entries.length === 0 && <p className="text-neutral-500">No entries parsed yet.</p>}
        {entries.map(e => <TimelineEntry key={e.uuid} entry={e} />)}
        <div ref={bottom} />
      </div>
    </main>
  )
}
