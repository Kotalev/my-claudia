import type { ParseStats, TranscriptEntry } from '../../transcript/types.js'
import type { LiveProcess, ProjectRecord, SessionStatus, SessionSummary } from '../../shared/types.js'
import { UsageAccumulator } from './usage.js'
import type { PlanLimits, StatuslineReport } from '../live/statusline.js'

/** A session with no activity for this long is no longer "active". */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000

/**
 * Entries retained per session. Startup backfill is capped at 1 MB per file, but
 * tailing afterwards had no cap at all: measured against the real corpus, session
 * state grew ~28 MB per day and was never freed, because a session that ends is
 * only flagged, never dropped.
 *
 * The oldest entries go first and the session is marked truncated, which the UI
 * already renders as "partial history". Usage totals are unaffected — the
 * accumulator folds each entry as it arrives and never revisits the array.
 */
export const MAX_RETAINED_ENTRIES = 4000

interface SessionState {
  entries: TranscriptEntry[]
  lastStatus: SessionStatus | null
  /** Set by hook events, which are ahead of the transcript's own timestamps. */
  hookActivity: string | null
  historyTruncated: boolean
  seen: Set<string>
  ended: boolean
  project: ProjectRecord | null
  versions: Set<string>
  skippedUnknown: number
  /** The running process, from Claude Code's own live registry. */
  live: LiveProcess | null
  /**
   * This session was live at some point in this dashboard's lifetime. Once it
   * disappears from the registry we can say it finished, which is more than the
   * time-decay rule can ever know.
   */
  wasLive: boolean
  usage: UsageAccumulator
  reportedCostUsd: number | null
}

/**
 * Liveness precedence. The live registry outranks everything: it is Claude Code's
 * own account of its processes, so it can say `waiting` where transcript recency
 * and hook events can only guess between active and idle. A session that was live
 * and no longer is has genuinely finished — the time-decay rule below can never
 * conclude that, it can only fade to `idle`.
 */
function deriveStatus(state: SessionState, fresh: boolean): SessionStatus {
  if (state.live) {
    // `blocked` is what a background agent reports when it needs the user; it is
    // the same situation as an interactive session's `waiting`.
    if (state.live.state === 'waiting' || state.live.state === 'blocked') return 'waiting'
    if (state.live.state === 'busy') return 'active'
    return fresh ? 'active' : 'idle'
  }
  if (state.ended || state.wasLive) return 'done'
  return fresh ? 'active' : 'idle'
}

/** Everything about a live process that a client would render. */
function signature(p: LiveProcess | null): string {
  return p === null ? '' : JSON.stringify(p)
}

export class SessionStore {
  #sessions = new Map<string, SessionState>()
  /** Account-wide, not per session: the 5h and 7d plan windows. */
  #planLimits: PlanLimits | null = null

  #state(sessionId: string): SessionState {
    let s = this.#sessions.get(sessionId)
    if (!s) {
      s = {
        entries: [], lastStatus: null, hookActivity: null, historyTruncated: false,
        seen: new Set(), ended: false,
        project: null, versions: new Set(), skippedUnknown: 0,
        live: null, wasLive: false, usage: new UsageAccumulator(), reportedCostUsd: null,
      }
      this.#sessions.set(sessionId, s)
    }
    return s
  }

  apply(
    sessionId: string,
    entries: TranscriptEntry[],
    stats: ParseStats,
    project: ProjectRecord | null,
  ): SessionSummary {
    const state = this.#state(sessionId)
    if (project) state.project = project
    state.skippedUnknown += stats.skippedUnknown
    for (const v of stats.versions) state.versions.add(v)

    for (const e of entries) {
      if (state.seen.has(e.uuid)) continue   // re-read after truncation must not double-count
      state.seen.add(e.uuid)
      state.entries.push(e)
      state.usage.add(e)
    }
    if (state.entries.length > MAX_RETAINED_ENTRIES) {
      const dropped = state.entries.splice(0, state.entries.length - MAX_RETAINED_ENTRIES)
      for (const e of dropped) state.seen.delete(e.uuid)
      state.historyTruncated = true
    }

    const summary = this.#summarize(sessionId, state)
    state.lastStatus = summary.status
    return summary
  }

  /**
   * The session's transcript was joined partway through, so the entries we hold
   * are a tail rather than the whole conversation. Callers must not present the
   * absence of an early prompt as the session never having had one.
   */
  markTruncated(sessionId: string): void {
    this.#state(sessionId).historyTruncated = true
  }

  markEnded(sessionId: string): void {
    this.#state(sessionId).ended = true
  }

  /**
   * A hook fired for this session. Hooks are the authoritative liveness signal:
   * the docs state transcript_path is written asynchronously and can lag the
   * current turn, so transcript recency alone under-reports live sessions.
   */
  markActive(sessionId: string, project: ProjectRecord | null): void {
    const state = this.#state(sessionId)
    if (project) state.project = project
    state.hookActivity = new Date().toISOString()
    state.ended = false
  }

  /**
   * Replaces the set of live processes. Sessions we have never seen a transcript
   * for are created here: a session that started a second ago, or a background
   * agent that has no transcript in this dashboard's view at all, must still
   * appear. Returns only the summaries that actually changed, because this runs
   * on every registry poke and broadcasting all of them would be noise.
   */
  setLive(processes: LiveProcess[]): SessionSummary[] {
    const next = new Map(processes.map(p => [p.sessionId, p]))
    const touched = new Set<string>([...next.keys()])
    for (const [id, state] of this.#sessions) if (state.live) touched.add(id)

    const changed: SessionSummary[] = []
    for (const id of touched) {
      const state = this.#state(id)
      const before = state.live
      const after = next.get(id) ?? null
      state.live = after
      if (after) {
        state.wasLive = true
        state.ended = false
      }
      const summary = this.#summarize(id, state)
      // Compare the whole process, not just its state: waitingFor changing from
      // "permission" to "your answer" is exactly what the user needs to see.
      const same = signature(before) === signature(after)
        && state.lastStatus === summary.status
      state.lastStatus = summary.status
      if (!same) changed.push(summary)
    }
    return changed
  }

  /**
   * A statusline refresh. Plan limits are account-wide rather than per session,
   * so the newest report wins for all of them; the cost figure is the session's
   * own. Returns the affected summary when there is one to broadcast.
   */
  applyStatusline(report: StatuslineReport): SessionSummary | undefined {
    if (report.limits) this.#planLimits = report.limits
    if (report.sessionId === null) return undefined
    const state = this.#state(report.sessionId)
    if (report.reportedCostUsd !== null) state.reportedCostUsd = report.reportedCostUsd
    // A statusline refresh proves the session is alive right now.
    state.hookActivity = new Date().toISOString()
    state.ended = false
    const summary = this.#summarize(report.sessionId, state)
    state.lastStatus = summary.status
    return summary
  }

  planLimits(): PlanLimits | null {
    return this.#planLimits
  }

  get(sessionId: string): SessionSummary | undefined {
    const state = this.#sessions.get(sessionId)
    return state ? this.#summarize(sessionId, state) : undefined
  }

  all(): SessionSummary[] {
    return [...this.#sessions.entries()]
      .map(([id, state]) => this.#summarize(id, state))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
  }

  /**
   * Status is a function of wall-clock time, but summaries are only recomputed
   * when a file changes — so a session that simply goes quiet would stay
   * "active" in an open tab forever. Callers run this periodically and
   * broadcast whatever it returns.
   */
  sweepStatusChanges(): SessionSummary[] {
    const changed: SessionSummary[] = []
    for (const [id, state] of this.#sessions) {
      const summary = this.#summarize(id, state)
      if (state.lastStatus !== null && state.lastStatus !== summary.status) changed.push(summary)
      state.lastStatus = summary.status
    }
    return changed
  }

  entries(sessionId: string): TranscriptEntry[] {
    return [...(this.#sessions.get(sessionId)?.entries ?? [])]
  }

  #summarize(sessionId: string, state: SessionState): SessionSummary {
    const { entries } = state
    const files: string[] = []
    const toolCounts: Record<string, number> = {}
    let lastUserPrompt: string | null = null
    let lastAssistantText: string | null = null
    let hasSidechain = false

    for (const e of entries) {
      if (e.isSidechain) { hasSidechain = true; continue }  // subagent chatter is not the session's own state
      if (e.isHumanPrompt && e.text) lastUserPrompt = e.text
      if (e.role === 'assistant' && e.text) lastAssistantText = e.text
      for (const call of e.toolCalls) {
        toolCounts[call.name] = (toolCounts[call.name] ?? 0) + 1
        if (call.filePath && !files.includes(call.filePath)) files.push(call.filePath)
      }
    }

    const first = entries[0]
    const last = entries[entries.length - 1]
    // A session can be live before it has written a single transcript line, and a
    // background agent may never appear in our transcript view at all. Falling
    // back to the epoch would date it to 1970 in every list that sorts by time.
    const transcriptActivity = last?.timestamp ?? state.live?.startedAt ?? new Date(0).toISOString()
    const lastActivity = state.hookActivity && state.hookActivity > transcriptActivity
      ? state.hookActivity
      : transcriptActivity
    const fresh = Date.now() - Date.parse(lastActivity) < ACTIVE_WINDOW_MS
    const status = deriveStatus(state, fresh)

    return {
      sessionId,
      projectId: state.project?.id ?? null,
      // A live process states its own cwd, so an unregistered session still knows
      // where it is. The escaped directory name is never un-escaped to guess it:
      // the escaping is lossy and reversing it is wrong more often than not.
      projectPath: state.project?.path ?? state.live?.cwd ?? first?.cwd ?? null,
      status,
      startedAt: first?.timestamp ?? state.live?.startedAt ?? lastActivity,
      lastActivity,
      lastUserPrompt,
      lastAssistantText,
      filesTouched: files,
      toolCounts,
      messageCount: entries.length,
      hasSidechain,
      versions: [...state.versions],
      skippedUnknown: state.skippedUnknown,
      historyTruncated: state.historyTruncated,
      live: state.live,
      usage: state.usage.snapshot(),
      reportedCostUsd: state.reportedCostUsd,
    }
  }
}
