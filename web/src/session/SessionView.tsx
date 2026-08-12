import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, RotateCw } from 'lucide-react'
import { useSessionDetail } from './useSessionDetail.js'
import { TimelineEntry } from './TimelineEntry.js'
import { relativeTime } from '../shared/format.js'
import { TelemetryPanel } from './TelemetryPanel.js'
import { Container } from '../shared/Page.js'
import { StatusDot } from '../shared/StatusDot.js'
import { FOCUS_RING } from '../shared/focus.js'
import { useClockTick } from '../shared/useClockTick.js'

/** How close to the bottom of the log still counts as "following". */
const AT_BOTTOM_PX = 48

export function SessionView(
  { sessionId, liveActivity, backLabel, onBack }:
  { sessionId: string; liveActivity: string | null; backLabel: string; onBack: () => void },
) {
  const { summary, entries, loading, error, refetch } = useSessionDetail(sessionId, liveActivity)
  const [follow, setFollow] = useState(true)
  const log = useRef<HTMLDivElement>(null)
  const programmatic = useRef(false)
  useClockTick()

  // Scrolling away is the clearest possible statement that you want to stay
  // where you are — the transcript used to pull the reader back to the bottom
  // mid-sentence on every new entry.
  useEffect(() => {
    const el = log.current
    if (!el) return
    const onScroll = (): void => {
      if (programmatic.current) { programmatic.current = false; return }
      setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Depends on `entries`, not `entries.length`: each live tick replaces the
  // whole array, and when the count happens not to change — a turn rewritten
  // in place, or a truncated tail that drops a head line as it gains one —
  // following used to stop silently with the box still ticked.
  useEffect(() => {
    const el = log.current
    if (!follow || !el) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
  }, [entries, follow])

  const jumpToLatest = (): void => {
    setFollow(true)
    const el = log.current
    if (!el) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
  }

  return (
    // A viewport-height column: the header and the telemetry stay put and only
    // the transcript scrolls, so opening a long session no longer means
    // scrolling past thousands of entries to see what the session cost.
    <main className="relative flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-4 sm:px-8">
        <Container width="reading">
          <nav aria-label="Breadcrumb" className="mb-2 text-sm">
            <button
              onClick={onBack}
              className={`-ml-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-muted hover:bg-neutral-800 hover:text-neutral-100 ${FOCUS_RING}`}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {backLabel}
            </button>
          </nav>
          {summary && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusDot status={summary.status} />
              <h1 className="min-w-0 truncate font-mono text-sm">{summary.sessionId}</h1>
              <span className="basis-full text-xs text-faint sm:basis-auto">
                {relativeTime(summary.lastActivity)} · {summary.messageCount} msgs
                {summary.versions.length > 0 && ` · cc ${summary.versions.join(', ')}`}
                {summary.skippedUnknown > 0 && ` · ${summary.skippedUnknown} unknown lines`}
              </span>
              <label className="flex w-full items-center gap-1.5 text-xs text-muted sm:ml-auto sm:w-auto">
                <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
                Follow
              </label>
            </div>
          )}
        </Container>
      </header>

      {summary && (
        <div className="shrink-0 px-4 pt-4 sm:px-8">
          <Container width="reading">
            {summary.historyTruncated && (
              <p className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-faint">
                Only the tail of this transcript was loaded — it was already large when the dashboard started.
              </p>
            )}
            <TelemetryPanel usage={summary.usage} truncated={summary.historyTruncated} reportedCostUsd={summary.reportedCostUsd} />
          </Container>
        </div>
      )}

      {/* min-h-0 is what lets this shrink inside the flex column; without it a
          flex child refuses to go below its content height and the page grows
          a second scrollbar instead. */}
      <div ref={log} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-8">
        <Container width="reading" className="space-y-1">
          {loading && <p className="text-faint">Loading…</p>}
          {!loading && error && (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-red-300">{error}</p>
              <p className="font-mono text-xs break-all text-faint">{sessionId}</p>
              <button
                onClick={() => { void refetch() }}
                className={`inline-flex items-center gap-1.5 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 ${FOCUS_RING}`}
              >
                <RotateCw aria-hidden="true" className="size-3.5" />
                Retry
              </button>
            </div>
          )}
          {!loading && !error && entries.length === 0 && <p className="text-faint">No entries parsed yet.</p>}
          {entries.map(e => <TimelineEntry key={e.uuid} entry={e} />)}
        </Container>
      </div>

      {/* With Follow off, the checkbox looked identical whether the transcript
          was one entry ahead of the reader or forty. */}
      {!follow && entries.length > 0 && (
        <button
          onClick={jumpToLatest}
          className={`absolute right-4 bottom-4 inline-flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 shadow-lg hover:bg-neutral-800 ${FOCUS_RING}`}
        >
          <ArrowDown aria-hidden="true" className="size-3.5" />
          jump to latest
        </button>
      )}
    </main>
  )
}
