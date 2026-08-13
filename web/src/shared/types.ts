// Re-exports of the server's types. There is deliberately no hand-written copy
// here: a mirror that drifts silently is worse than no mirror at all, and these
// types grow every time the dashboard learns to show something new.
export type {
  ProjectRecord,
  SessionStatus,
  SessionSummary,
  RunStatus,
  RunKind,
  RunHandle,
  RunDiff,
  RunDiffFile,
  RateLimitInfo,
  ScheduleKind,
  ScheduleJob,
  DispatchInput,
  QueuedDispatch,
  PromptTemplate,
  PendingReview,
  InterruptedRun,
} from '@shared/types.js'

export type {
  SessionUsage,
  TokenTotals,
  RateBucket,
  LiveProcess,
  SpendSummary,
  AccountInfo,
  PermissionRequestInfo,
} from '@shared/types.js'

export type { ToolCall, TranscriptEntry } from '@transcript/types.js'
export type { PlanLimits, RateLimitWindow } from '@server/live/statusline.js'

export type {
  TaskStatus,
  Task,
  ProgressEntry,
  ExtraSection,
  TasksDoc,
} from '@tasks/types.js'
