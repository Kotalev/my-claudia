import type { PendingReview, QueuedDispatch, RunHandle, SessionSummary } from '../shared/types.js'

export type AttentionKind =
  | 'waiting-session'
  | 'awaiting-input'
  | 'stalled-run'
  | 'pending-review'
  | 'failed-run'
  | 'stuck-queue'

export interface AttentionItem {
  kind: AttentionKind
  /** Stable across rebuilds, unique across kinds — the React key. */
  key: string
  /** What the item is about: a session's name, a task id, a branch. */
  label: string
  /** ISO moment the wait started; the age on screen is now − since. */
  since: string
  projectId: string | null
  /** Set when clicking should open a session; otherwise the project opens. */
  sessionId: string | null
}

/** A dispatch queued longer than this means something is hogging the project. */
export const QUEUE_STALE_MS = 10 * 60_000

/**
 * Everything on this machine that is waiting on a human, as one flat list,
 * oldest first — the longest-waiting item is the one to deal with. Pure so it
 * can be tested without a socket; permission prompts keep their own card and
 * are deliberately not items here.
 */
export function buildAttentionItems(
  { sessions, runs, queue, reviews, now }:
  {
    sessions: SessionSummary[]
    runs: RunHandle[]
    queue: QueuedDispatch[]
    reviews: PendingReview[]
    now: number
  },
): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const s of sessions) {
    if (s.status !== 'waiting') continue
    items.push({
      kind: 'waiting-session',
      key: `session:${s.sessionId}`,
      label: s.live?.name ?? s.lastUserPrompt ?? s.sessionId.slice(0, 8),
      // statusUpdatedAt dates the transition into waiting itself; lastActivity
      // is only the fallback when the registry never dated it.
      since: s.live?.statusUpdatedAt ?? s.lastActivity,
      projectId: s.projectId,
      sessionId: s.sessionId,
    })
  }

  // A failed worktree run that still has a pending review would appear twice;
  // the review row is the one with an action on it, so it wins.
  const reviewed = new Set(reviews.map(r => r.runId))
  for (const r of runs) {
    const label = r.taskId ?? `run ${r.runId.slice(0, 8)}`
    if (r.endedAt === null && r.status === 'awaiting-input') {
      items.push({
        kind: 'awaiting-input',
        key: `run:${r.runId}`,
        label,
        since: r.lastOutputAt ?? r.startedAt,
        projectId: r.projectId,
        sessionId: null,
      })
    } else if (r.endedAt === null && r.stalled === true) {
      items.push({
        kind: 'stalled-run',
        key: `run:${r.runId}`,
        label,
        since: r.lastOutputAt ?? r.startedAt,
        projectId: r.projectId,
        sessionId: null,
      })
    } else if (r.endedAt !== null && r.status === 'failed' && !reviewed.has(r.runId)) {
      items.push({
        kind: 'failed-run',
        key: `run:${r.runId}`,
        label,
        since: r.endedAt,
        projectId: r.projectId,
        sessionId: null,
      })
    }
  }

  for (const r of reviews) {
    items.push({
      kind: 'pending-review',
      key: `review:${r.runId}`,
      label: r.taskId ?? r.branch,
      since: r.endedAt ?? r.startedAt,
      projectId: r.projectId,
      sessionId: null,
    })
  }

  for (const q of queue) {
    const queued = Date.parse(q.queuedAt)
    if (!Number.isFinite(queued) || now - queued < QUEUE_STALE_MS) continue
    items.push({
      kind: 'stuck-queue',
      key: `queue:${q.queueId}`,
      label: q.input.taskId ?? 'queued prompt',
      since: q.queuedAt,
      projectId: q.projectId,
      sessionId: null,
    })
  }

  return items.sort((a, b) => a.since.localeCompare(b.since))
}
