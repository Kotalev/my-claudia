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
  /** True when startup backfill began mid-file, so earlier entries were never loaded. */
  historyTruncated: boolean
}
