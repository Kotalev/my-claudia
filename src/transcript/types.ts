export type Role = 'user' | 'assistant' | 'system'

export interface ToolCall {
  id: string
  name: string
  /** Best-effort file path from the tool input, when the tool takes one. */
  filePath: string | null
}

/**
 * Token usage as reported on one assistant message. Field names mirror the
 * transcript's own, flattened: `cache_creation` is a nested object there, and
 * `iterations` is an array — never a count, however much it reads like one.
 */
export interface EntryUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  /** The 5m and 1h buckets summed. Priced separately, so keep both below. */
  cacheCreationInputTokens: number
  cacheCreation5mInputTokens: number
  cacheCreation1hInputTokens: number
  thinkingTokens: number | null
  webSearchRequests: number
  webFetchRequests: number
  serviceTier: string | null
  /** `us`, `not_available`, … — carries a price multiplier on some tiers. */
  inferenceGeo: string | null
  speed: string | null
}

/** What the transcript records about one compaction. Every field is optional in real data. */
export interface CompactBoundary {
  trigger: string | null
  preTokens: number | null
  postTokens: number | null
  durationMs: number | null
  /** Lifetime total of tokens dropped by compaction, monotonic across the session. */
  cumulativeDroppedTokens: number | null
}

export interface TranscriptEntry {
  uuid: string
  parentUuid: string | null
  sessionId: string
  timestamp: string
  role: Role
  isSidechain: boolean
  cwd: string | null
  gitBranch: string | null
  version: string | null
  /** Visible text only. Thinking blocks are deliberately excluded. */
  text: string | null
  toolCalls: ToolCall[]
  isMeta: boolean
  /**
   * The API message id. Claude Code writes one transcript line per content block,
   * so a single response appears several times carrying the SAME usage figures —
   * summing lines instead of messages inflates every total severalfold. This is
   * the dedup key, and it is not the uuid.
   */
  messageId: string | null
  requestId: string | null
  /** May be the `<synthetic>` sentinel, which is not a real model and costs nothing. */
  model: string | null
  usage: EntryUsage | null
  /** Reasoning effort: low | medium | high | xhigh | max. */
  effort: string | null
  /** An error rendered as an assistant turn. Carries no real usage. */
  isApiError: boolean
  /** A `system`/`compact_boundary` line: the conversation was compacted here. */
  isCompactBoundary: boolean
  compact: CompactBoundary | null
  /**
   * True only for text a human actually typed. Claude Code replays a lot of
   * machine content as user turns — slash-command output, injected reminders,
   * tool results, subagent instructions — and deciding which is which requires
   * knowing this format, so the decision belongs here rather than in the UI.
   */
  isHumanPrompt: boolean
}

export interface ParseStats {
  parsed: number
  /** Lines whose `type` we have never seen: the format-drift signal, surfaced in the UI. */
  skippedUnknown: number
  /** Known session-bookkeeping lines we deliberately ignore. Expected to be large. */
  skippedBookkeeping: number
  /** Unparseable JSON, or a content line missing fields we require. */
  skippedInvalid: number
  versions: string[]
}

/** Wrappers Claude Code uses for machine content replayed as a user turn. */
export const INJECTED_MARKERS = [
  '<local-command-stdout>',
  '<local-command-caveat>',
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<system-reminder>',
  '<user-prompt-submit-hook>',
  // Background-task results replayed as a user turn. By far the most common
  // injected shape in real transcripts, and the easiest to mistake for a prompt.
  '<task-notification>',
  // A `!` command typed in the CLI. Human-typed, but a shell command is not a
  // request to the agent, and showing it as "what they last asked" reads wrong.
  '<bash-input>',
  '<bash-stdout>',
  '<bash-stderr>',
] as const

/**
 * Line types that carry conversation content. Everything else in the file
 * (titles, modes, file-history snapshots, queue operations, bridge metadata)
 * is session bookkeeping we deliberately ignore.
 */
export const CONTENT_TYPES = ['user', 'assistant', 'system'] as const

/** Known-but-ignored types. Anything outside both lists counts as format drift. */
export const BOOKKEEPING_TYPES = [
  'attachment', 'summary', 'file-history-snapshot', 'file-history-delta',
  'queue-operation', 'mode', 'permission-mode', 'agent-name', 'ai-title',
  'custom-title', 'last-prompt', 'bridge-session',
] as const
