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
  /**
   * Current git branch of the live process's working directory, read from
   * `.git/HEAD`. Null when the session is not live, the directory is not a
   * checkout, or HEAD is unreadable.
   */
  gitBranch: string | null
  usage: SessionUsage
  /**
   * Claude Code's own cost figure for this session, via the statusline. Still a
   * client-side estimate by Anthropic's own account, but it is theirs, not ours.
   */
  reportedCostUsd: number | null
}

export type RunStatus = 'running' | 'awaiting-input' | 'succeeded' | 'failed' | 'cancelled'

/**
 * What started the run: a TASKS.md task, a free prompt, or the continuation of
 * an existing session via `--resume`.
 */
export type RunKind = 'task' | 'prompt' | 'resume'

/**
 * Where a dispatched run's working tree lives. `worktree` means a linked git
 * worktree on its own branch, outside the project tree; `in-place` is the old
 * behaviour, kept for projects that are not git repos.
 */
export type RunIsolation = 'worktree' | 'in-place'

/** One changed file in a run's diff. Untracked files count their lines as additions. */
export interface RunDiffFile {
  path: string
  additions: number
  deletions: number
}

/** What `GET /api/runs/:id/diff` answers. An empty diff is empty arrays, never 404. */
export interface RunDiff {
  branch: string | null
  files: RunDiffFile[]
  patch: string
}

/**
 * The most recent `rate_limit_event` seen on a run's output stream. `status`
 * is an open set — anything other than `'allowed'` at failure time means the
 * run died rate-limited. `resetsAt` is epoch SECONDS (verified 2026-08-13).
 */
export interface RateLimitInfo {
  status: string
  resetsAt: number | null
  rateLimitType: string | null
}

/** Everything `Dispatcher.start` needs. Kept whole on the run so a retry or a queued dispatch can replay it. */
export interface DispatchInput {
  projectId: string
  projectPath: string
  taskId: string | null
  prompt: string
  kind?: RunKind
  /** The session `--resume` continues. Required when kind is 'resume'. */
  resumeSessionId?: string
  /** The loop this dispatch belongs to, carried onto the RunHandle so history can group a loop's runs. */
  loopId?: string | null
}

/**
 * A dispatch that could not start because an in-place run already holds its
 * project. In-memory only: unstarted work does not need to survive a restart.
 */
export interface QueuedDispatch {
  queueId: string
  projectId: string
  input: DispatchInput
  queuedAt: string
}

/** A saved prompt for the "new run" box. Persisted in the history db when SQLite is available. */
export interface PromptTemplate {
  id: string
  name: string
  text: string
  createdAt: string
}

export interface RunHandle {
  runId: string
  projectId: string
  /** The TASKS.md task behind the run. Null for prompt and resume runs. */
  taskId: string | null
  /** Optional so run handles recorded before prompt/resume runs stay valid; absent means 'task'. */
  kind?: RunKind
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
  /** Optional so run handles recorded before worktree isolation stay valid. */
  isolation?: RunIsolation
  /** The run's own branch (`mc/run-<short id>`). Null for in-place runs. Never deleted. */
  branch?: string | null
  /** Absolute path of the linked worktree. Null for in-place runs and after removal. */
  worktreeDir?: string | null
  /** Commit the run branched from; the review diff is measured against it. */
  baseCommit?: string | null
  /** True while the worktree still exists, so its diff can be read. */
  diffAvailable?: boolean
  /** The run branch was merged into the project checkout; the worktree is gone. */
  merged?: boolean
  /** The worktree was thrown away without merging. The branch survives. */
  discarded?: boolean
  /** Latest rate-limit event from the stream. Optional so older handles stay valid. */
  lastRateLimit?: RateLimitInfo | null
  /** The loop schedule that started this run. Optional so pre-loop handles stay valid. */
  loopId?: string | null
  /** ISO time of the last stdout/stderr from the child. Refreshed on every stream event. */
  lastOutputAt?: string
  /** Advisory: 'running' with no output for stallAfterMs. Cleared when output resumes. */
  stalled?: boolean
  /** Advisory, one-way: the run has lived longer than warnAfterMs. */
  longRunning?: boolean
}

/**
 * One finished worktree run whose changes have been neither merged nor
 * discarded. `live` items come from the current process's dispatcher;
 * `history` items are unresolved rows from the history db whose `mc/run-*`
 * branch still exists — work from a previous server process that must not
 * rot unseen. Live wins when both know the same runId.
 */
export interface PendingReview {
  runId: string
  projectId: string
  taskId: string | null
  branch: string
  baseCommit: string | null
  startedAt: string
  endedAt: string | null
  source: 'live' | 'history'
  loopId: string | null
}

/** What a scheduled job does when it fires. */
export type ScheduleKind = 'resume-run' | 'dispatch-task'

/**
 * One pending scheduled job. `resume-run` continues a session headlessly at
 * `runAt` (auto-continue after a rate limit uses this); `dispatch-task` starts
 * a TASKS.md task at a chosen time. Persisted in the history db when SQLite is
 * available; in-memory (dies with the process) otherwise.
 */
export interface ScheduleJob {
  id: string
  kind: ScheduleKind
  projectId: string
  /** The TASKS.md task to dispatch. Null for resume-run jobs. */
  taskId: string | null
  /** The session to `--resume`. Null for dispatch-task jobs. */
  sessionId: string | null
  /** The prompt a resume-run sends. Null for dispatch-task jobs (the task text is read at fire time). */
  prompt: string | null
  runAt: string
  createdAt: string
  note: string | null
  /** Loop cadence in ms (>= 60s). Null = one-shot. */
  repeatEveryMs: number | null
  /** Stable id shared by every job of one recurring loop. Null = one-shot. */
  loopId: string | null
  /** 1-based position of this job within its loop. 1 for one-shots. */
  iteration: number
  /** The loop does not replicate past this iteration. Null = unbounded. */
  maxIterations: number | null
  /** The loop stops after this many consecutive failed runs. Null = never. */
  stopAfterFailures: number | null
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
  /** Null when the source stated no status at all (sdk-cli entries, agents with an unrecognised state). */
  state: LiveState | null
  /** What the session is waiting for, when Claude Code says. */
  waitingFor: string | null
  /**
   * When the status last *changed*, not when the file was last touched: Claude
   * Code writes this field only on a transition. It is therefore a record of an
   * event, never a heartbeat — a `waiting` from an hour ago means the prompt has
   * been open an hour, not that anything is still refreshing it.
   */
  statusUpdatedAt: string | null
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

/** One aggregated period of the spend ledger. Null usd means nothing priceable, not zero. */
export interface SpendRollup {
  /** `2026-W33` for an ISO week, `2026-08` for a calendar month. */
  key: string
  usd: number | null
}

/**
 * Account-wide spend across all registered projects, over rolling windows of
 * local calendar days. An estimate at list prices, not a bill. Each figure is
 * null when nothing priceable fell inside its window.
 */
export interface SpendSummary {
  todayUsd: number | null
  sevenDayUsd: number | null
  thirtyDayUsd: number | null
  /**
   * The last 4 ISO weeks (current first) and the current + previous calendar
   * month, aggregated from the same daily buckets. Bounded by the 30-day
   * retention, so the oldest period can only ever be partially covered.
   */
  weekly: SpendRollup[]
  monthly: SpendRollup[]
  /** Models seen in the 30-day window that we hold no price for. */
  unpricedModels: string[]
  updatedAt: string
}

/** The Claude account logged in on this machine, read from `.claude.json`. */
export interface AccountInfo {
  email: string
}

/**
 * A permission prompt a Claude Code session is holding open right now. The
 * sink holds the hook's HTTP reply while this exists; answering or letting
 * the ~22s window lapse removes it.
 */
export interface PermissionRequestInfo {
  id: string
  sessionId: string
  toolName: string
  /** One safe line of the tool input — a command or a path, never the raw payload. */
  toolInputSummary: string
  cwd: string | null
  createdAt: string
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
