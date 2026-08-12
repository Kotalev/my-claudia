export interface ProjectRecord {
  id: string
  path: string
  name: string
  escapedDir: string
  addedAt: string
}

/**
 * `waiting` means the agent is blocked on the user. Only Claude Code's own live
 * registry can tell us that — it is invisible to transcript growth and to hooks,
 * and it is the state a person most needs to see.
 */
export type SessionStatus = 'waiting' | 'active' | 'idle' | 'done'

export interface SessionSummary {
  sessionId: string
  projectId: string | null
  projectPath: string | null
  status: SessionStatus
  startedAt: string
  lastActivity: string
  lastUserPrompt: string | null
  lastAssistantText: string | null
  filesTouched: string[]
  toolCounts: Record<string, number>
  messageCount: number
  hasSidechain: boolean
  versions: string[]
  skippedUnknown: number
  /** True when startup backfill began mid-file, so earlier entries were never loaded. */
  historyTruncated: boolean
  /** The running process behind this session, when there is one. */
  live: LiveProcess | null
}

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface RunHandle {
  runId: string
  projectId: string
  taskId: string
  sessionId: string | null
  status: RunStatus
  startedAt: string
  endedAt: string | null
  exitCode: number | null
}

/** How a live process was started. Background agents have no OS process of their own. */
export type LiveKind = 'interactive' | 'background'

/** What a live process is doing. `waiting` means it is blocked on the user. */
export type LiveState = 'busy' | 'waiting' | 'idle' | 'blocked'

/**
 * One live `claude` execution, as reported by Claude Code itself. Two sources
 * feed this: the `<claude dir>/sessions/<pid>.json` registry (interactive and
 * SDK processes) and `claude agents --json` (background agents, which have no
 * pid and no registry file at all).
 */
export interface LiveProcess {
  sessionId: string
  pid: number | null
  cwd: string | null
  /** Claude Code's own name for the session, usually the project directory. */
  name: string | null
  kind: LiveKind
  entrypoint: string | null
  version: string | null
  startedAt: string
  state: LiveState
  /** What the session is waiting for, when Claude Code says. */
  waitingFor: string | null
}
