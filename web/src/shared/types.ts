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

export type TaskStatus = 'todo' | 'in-progress' | 'done'

export interface Task {
  id: string
  status: TaskStatus
  title: string
  tags: string[]
  doneDate: string | null
  note: string | null
}

export interface ProgressEntry { raw: string }

export interface TasksDoc {
  title: string
  tasks: Task[]
  progress: ProgressEntry[]
  preamble: string[]
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
