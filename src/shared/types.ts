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
  usage: SessionUsage
  /**
   * Claude Code's own cost figure for this session, via the statusline. Still a
   * client-side estimate by Anthropic's own account, but it is theirs, not ours.
   */
  reportedCostUsd: number | null
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
  /**
   * What `claude` itself reported for this run, from the `result` event. Still a
   * client-side estimate by Anthropic's own documentation, but it is theirs.
   */
  costUsd: number | null
  numTurns: number | null
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
  /** Null when the registry entry did not state one — not a reason to call it dead. */
  startedAt: string | null
  state: LiveState
  /** What the session is waiting for, when Claude Code says. */
  waitingFor: string | null
}

/** Token counts summed over a set of messages. */
export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  cacheCreation5mInputTokens: number
  cacheCreation1hInputTokens: number
  webSearchRequests: number
  webFetchRequests: number
  /** Distinct API messages counted, after de-duplication. */
  messages: number
}

/**
 * Tokens grouped by everything that changes their price: the model, fast mode,
 * and the inference geography. Splitting on all three is what keeps the estimate
 * honest for a session that switched models partway through.
 */
export interface RateBucket {
  model: string
  speed: string | null
  inferenceGeo: string | null
  totals: TokenTotals
}

export interface SessionUsage {
  /** The session's own thread. */
  main: TokenTotals
  /** Everything its subagents did. Roughly a fifth of all usage in real data. */
  subagents: TokenTotals
  total: TokenTotals
  /**
   * How full the context window was on the most recent main-thread turn. This
   * lags by one turn: it is what the model was sent, so a large tool result
   * arriving after it is not counted until the next request. Null when the
   * session has not had an assistant turn yet — which is not the same as zero.
   */
  contextTokens: number | null
  contextAt: string | null
  /**
   * The model of that same main-thread turn. Not `models[last]`: a subagent on a
   * 200k model would otherwise be used to size the main thread's 1M window, and
   * the bar would read full at 300k.
   */
  contextModel: string | null
  /** Models seen, newest last. More than one means the session switched. */
  models: string[]
  /** Reasoning effort on the most recent turn that stated one. */
  effort: string | null
  /** Times the conversation was compacted, from the transcript's own markers. */
  compactions: number
  /** Per-model, per-rate totals. The only sound basis for a cost estimate. */
  byRate: RateBucket[]
}
