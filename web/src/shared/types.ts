// Mirrors src/shared/types.ts and src/transcript/types.ts. The frontend has no
// path alias into src/, so these must be kept identical by hand.

export interface ProjectRecord {
  id: string
  path: string
  name: string
  escapedDir: string
  addedAt: string
}

export type SessionStatus = 'active' | 'idle' | 'done'

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
}

export interface ToolCall {
  id: string
  name: string
  filePath: string | null
}

export interface TranscriptEntry {
  uuid: string
  parentUuid: string | null
  sessionId: string
  timestamp: string
  role: 'user' | 'assistant' | 'system'
  isSidechain: boolean
  cwd: string | null
  gitBranch: string | null
  version: string | null
  text: string | null
  toolCalls: ToolCall[]
  isMeta: boolean
}
