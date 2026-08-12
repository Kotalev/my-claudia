import type { ParseStats, TranscriptEntry } from '../../transcript/types.js'
import type { ProjectRecord, SessionStatus, SessionSummary } from '../../shared/types.js'

/** A session with no activity for this long is no longer "active". */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000

interface SessionState {
  entries: TranscriptEntry[]
  lastStatus: SessionStatus | null
  seen: Set<string>
  ended: boolean
  project: ProjectRecord | null
  versions: Set<string>
  skippedUnknown: number
}

export class SessionStore {
  #sessions = new Map<string, SessionState>()

  #state(sessionId: string): SessionState {
    let s = this.#sessions.get(sessionId)
    if (!s) {
      s = {
        entries: [], lastStatus: null, seen: new Set(), ended: false,
        project: null, versions: new Set(), skippedUnknown: 0,
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
    }
    const summary = this.#summarize(sessionId, state)
    state.lastStatus = summary.status
    return summary
  }

  markEnded(sessionId: string): void {
    this.#state(sessionId).ended = true
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
      if (e.role === 'user' && e.text && !e.isMeta) lastUserPrompt = e.text
      if (e.role === 'assistant' && e.text) lastAssistantText = e.text
      for (const call of e.toolCalls) {
        toolCounts[call.name] = (toolCounts[call.name] ?? 0) + 1
        if (call.filePath && !files.includes(call.filePath)) files.push(call.filePath)
      }
    }

    const first = entries[0]
    const last = entries[entries.length - 1]
    const lastActivity = last?.timestamp ?? new Date(0).toISOString()
    const fresh = Date.now() - Date.parse(lastActivity) < ACTIVE_WINDOW_MS
    const status: SessionStatus = state.ended ? 'done' : fresh ? 'active' : 'idle'

    return {
      sessionId,
      projectId: state.project?.id ?? null,
      projectPath: state.project?.path ?? first?.cwd ?? null,
      status,
      startedAt: first?.timestamp ?? lastActivity,
      lastActivity,
      lastUserPrompt,
      lastAssistantText,
      filesTouched: files,
      toolCounts,
      messageCount: entries.length,
      hasSidechain,
      versions: [...state.versions],
      skippedUnknown: state.skippedUnknown,
    }
  }
}
