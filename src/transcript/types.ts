export type Role = 'user' | 'assistant' | 'system'

export interface ToolCall {
  id: string
  name: string
  /** Best-effort file path from the tool input, when the tool takes one. */
  filePath: string | null
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
