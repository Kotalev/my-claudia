import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, RotateCw } from 'lucide-react'
import { useSessionDetail } from './useSessionDetail.js'
import { ActivityBlock, CompactionDivider, HiddenDivider, TimelineEntry } from './TimelineEntry.js'
import { relativeTime } from '../shared/format.js'
import { TelemetryPanel } from './TelemetryPanel.js'
import { buildChapters, buildTimeline } from './timeline.js'
import { Container } from '../shared/Page.js'
import { StatusDot } from '../shared/StatusDot.js'
import { FOCUS_RING } from '../shared/focus.js'
import { useClockTick } from '../shared/useClockTick.js'

/** How close to the bottom of the log still counts as "following". */
const AT_BOTTOM_PX = 48

function chapterTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function SessionView(
  { sessionId, liveActivity, backLabel, onBack }:
  { sessionId: string; liveActivity: string | null; backLabel: string; onBack: () => void },
) {
  const { summary, entries, loading, error, refetch } = useSessionDetail(sessionId, liveActivity)
  const [follow, setFollow] = useState(true)
  const [activeChapter, setActiveChapter] = useState<string | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const programmatic = useRef(false)
  useClockTick()

  const working = summary?.status === 'active'
  const items = useMemo(() => buildTimeline(entries), [entries])
  const chapters = useMemo(() => buildChapters(entries), [entries])

  // Scrolling away is the clearest possible statement that you want to stay
  // where you are — the transcript used to pull the reader back to the bottom
  // mid-sentence on every new entry. The same scroll pass tracks which chapter
  // the reader is in, for the rail.
  useEffect(() => {
    const el = log.current
    if (!el) return
    const onScroll = (): void => {
      // getBoundingClientRect rather than offsetTop: the marks' offsetParent
      // is <main>, not this scroll box, so offsetTop would carry the header.
      const top = el.getBoundingClientRect().top
      let current: string | null = null
      for (const c of chapters) {
        const mark = document.getElementById(`entry-${c.uuid}`)
        if (mark && mark.getBoundingClientRect().top - top <= 100) current = c.uuid
        else if (mark) break
      }
      setActiveChapter(current ?? chapters[0]?.uuid ?? null)
      if (programmatic.current) { programmatic.current = false; return }
      setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [chapters])

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

  const jumpTo = (uuid: string): void => {
    const el = log.current
    const mark = document.getElementById(`entry-${uuid}`)
    if (!el || !mark) return
    setFollow(false)
    programmatic.current = true
    const delta = mark.getBoundingClientRect().top - el.getBoundingClientRect().top
    el.scrollTop = Math.max(el.scrollTop + delta - 16, 0)
  }

  // User prompts are the chapter marks; ↑ ↓ jumps between them (the redesign's
  // stated affordance). Only when nothing focusable owns the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (chapters.length === 0) return
      const idx = chapters.findIndex(c => c.uuid === activeChapter)
      const next = e.key === 'ArrowDown' ? Math.min(idx + 1, chapters.length - 1) : Math.max(idx - 1, 0)
      const chapter = chapters[next]
      if (chapter && chapter.uuid !== activeChapter) {
        e.preventDefault()
        jumpTo(chapter.uuid)
        setActiveChapter(chapter.uuid)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapters, activeChapter])

  const jumpToLatest = (): void => {
    setFollow(true)
    const el = log.current
    if (!el) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
  }

  // The live tail carries the caret: the last prose entry of a working session.
  const streamingUuid = useMemo(() => {
    if (!working) return null
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (item.kind === 'entry' && item.entry.role === 'assistant') return item.entry.uuid
      if (item.kind === 'entry' || item.kind === 'compaction') return null
    }
    return null
  }, [items, working])

  return (
    // A viewport-height column: the header and the telemetry stay put and only
    // the transcript scrolls, so opening a long session no longer means
    // scrolling past thousands of entries to see what the session cost.
    <main className="relative flex h-dvh flex-col bg-neutral-950 text-neutral-200">
      <header className="shrink-0 border-b border-neutral-875 px-4 py-3.5 sm:px-8">
        <Container width="reading">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
            <button
              onClick={onBack}
              className={`-ml-2 inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11.5px] text-faint hover:bg-neutral-875 hover:text-neutral-200 ${FOCUS_RING}`}
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              {backLabel}
            </button>
            {summary && (
              <>
                <StatusDot status={summary.status} size="sm" />
                {summary.live?.name && (
                  <h1 className="min-w-0 truncate font-mono text-[13px] text-neutral-100">{summary.live.name}</h1>
                )}
                <span className={`min-w-0 truncate font-mono text-[11px] text-dim ${summary.live?.name ? '' : 'text-[13px] text-neutral-100'}`}>
                  {summary.sessionId}
                </span>
                <span className="basis-full font-mono text-[11.5px] text-faint sm:basis-auto">
                  {relativeTime(summary.lastActivity)} · {summary.messageCount} msgs
                  {summary.versions.length > 0 && ` · cc ${summary.versions.join(', ')}`}
                  {summary.skippedUnknown > 0 && ` · ${summary.skippedUnknown} unknown lines`}
                </span>
                <label className="flex w-full items-center gap-2 font-mono text-[11.5px] text-muted sm:ml-auto sm:w-auto">
                  <input type="checkbox" className="accent-info" checked={follow} onChange={e => setFollow(e.target.checked)} />
                  Follow
                </label>
              </>
            )}
          </div>
        </Container>
      </header>

      {summary && (
        <div className="shrink-0 px-4 pt-4 sm:px-8">
          <Container width="reading">
            {summary.historyTruncated && (
              <p className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-[11px] text-faint">
                Only the tail of this transcript was loaded — it was already large when the dashboard started.
              </p>
            )}
            <TelemetryPanel
              usage={summary.usage}
              truncated={summary.historyTruncated}
              reportedCostUsd={summary.reportedCostUsd}
              working={working}
            />
          </Container>
        </div>
      )}

      {/* The rail and the transcript share the reading measure: the rail's
          left edge lines up with the telemetry panel above, instead of
          hanging on the viewport edge beside a centred column. */}
      <div className="mx-auto flex min-h-0 w-full max-w-reading flex-1">
        {/* The chapter rail: user prompts are the marks, compactions divide
            them. Hidden below lg — the keyboard shortcut still works. */}
        {chapters.length > 0 && (
          <nav aria-label="Chapters" className="hidden w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-875 px-3.5 py-4 lg:flex">
            <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">chapters</span>
            <div className="flex flex-col gap-0.5">
              {chapters.map(c => c.isCompaction
                ? (
                    <span key={c.uuid} className="my-1 border-y border-dashed border-neutral-700 px-2 py-1.5 font-mono text-[11px] text-dim">
                      compaction · {chapterTime(c.time)}
                    </span>
                  )
                : (
                    <button
                      key={c.uuid}
                      type="button"
                      onClick={() => jumpTo(c.uuid)}
                      title={c.label}
                      className={`truncate rounded-md px-2 py-[7px] text-left font-mono text-[11px] ${
                        c.uuid === activeChapter
                          ? 'border-l-2 border-l-work bg-neutral-875 text-neutral-200'
                          : 'text-faint hover:bg-neutral-875 hover:text-muted'
                      } ${FOCUS_RING}`}
                    >
                      {chapterTime(c.time)} · {c.label}
                    </button>
                  ))}
            </div>
            <span className="mt-auto font-mono text-[10.5px] leading-[1.6] text-dim">
              user prompts are the chapter marks; ↑ ↓ jumps between them
            </span>
          </nav>
        )}

        {/* min-h-0 is what lets this shrink inside the flex column; without it a
            flex child refuses to go below its content height and the page grows
            a second scrollbar instead. */}
        <div ref={log} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-6 sm:px-4">
          <div className="space-y-1">
            {loading && <p className="p-4 text-faint">Loading…</p>}
            {!loading && error && (
              <div role="alert" className="space-y-2 p-4">
                <p className="text-sm text-danger">{error}</p>
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
            {!loading && !error && entries.length === 0 && <p className="p-4 text-faint">No entries parsed yet.</p>}
            {items.map(item => {
              switch (item.kind) {
                case 'compaction':
                  return <CompactionDivider key={item.entry.uuid} entry={item.entry} />
                case 'hidden':
                  return <HiddenDivider key={item.uuid} count={item.count} />
                case 'activity':
                  return <ActivityBlock key={item.uuid} item={item} />
                default:
                  return (
                    <TimelineEntry
                      key={item.entry.uuid}
                      entry={item.entry}
                      streaming={item.entry.uuid === streamingUuid}
                    />
                  )
              }
            })}
          </div>
        </div>
      </div>

      {/* With Follow off, the checkbox looked identical whether the transcript
          was one entry ahead of the reader or forty. */}
      {!follow && entries.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <button
            onClick={jumpToLatest}
            className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-875 px-4 py-2 font-mono text-[11.5px] text-neutral-200 shadow-[0_6px_20px_rgba(0,0,0,0.5)] hover:bg-neutral-800 ${FOCUS_RING}`}
          >
            <ArrowDown aria-hidden="true" className="size-3.5" />
            jump to latest
          </button>
        </div>
      )}
    </main>
  )
}
