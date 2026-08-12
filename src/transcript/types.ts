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
