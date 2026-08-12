import type { SessionStatus, SessionSummary } from './types.js'

/**
 * Desktop notification when a session blocks on the user.
 *
 * The decision is a pure function so it can be tested without a DOM; only the
 * few lines below it touch `Notification` at all, and none of them at module
 * scope — the test environment is node, where the global does not exist.
 *
 * What `waiting` means is not our invention: Claude Code's own status enum is
 * busy | shell | idle | waiting, and it writes `waiting` exactly when a dialog
 * is blocking — a permission prompt, a sandbox request, an elicitation. `idle`
 * is a session sitting at an empty prompt, which is nobody's problem.
 */

const STORAGE_KEY = 'mc.notify'

/**
 * A status transition is a record of an event, not a heartbeat: Claude Code
 * writes `statusUpdatedAt` only when the status changes. Past this age we say
 * nothing rather than announce a prompt that has been open all afternoon —
 * whoever left it there does not need to hear about it now.
 */
export const STALE_MS = 5 * 60 * 1000

/** One session cannot notify more often than this, however it flaps. */
export const COOLDOWN_MS = 60 * 1000

export interface NotifyDecision {
  prev: SessionStatus | undefined
  next: SessionStatus
  kind: 'interactive' | 'background' | null
  statusUpdatedAt: string | null
  enabled: boolean
  permission: string
  lastNotifiedAt: number | undefined
  now: number
  /** The user is looking at this very session, in a focused tab. */
  focused: boolean
}

export function shouldNotify(d: NotifyDecision): boolean {
  if (!d.enabled || d.permission !== 'granted') return false
  if (d.next !== 'waiting') return false
  // Never seen before: this is the snapshot seeding the table, not a transition.
  // Without it, opening the dashboard would fire for every session already blocked.
  if (d.prev === undefined || d.prev === 'waiting') return false
  // Background agents report `blocked` with no transition time at all, so their
  // block is undateable — and the only real ones on this machine had been
  // abandoned for weeks. An undateable block is not news.
  if (d.kind === 'background') return false
  if (d.statusUpdatedAt === null) return false
  const at = Date.parse(d.statusUpdatedAt)
  if (!Number.isFinite(at) || d.now - at > STALE_MS) return false
  if (d.focused) return false
  return d.now - (d.lastNotifiedAt ?? -Infinity) >= COOLDOWN_MS
}

export function supported(): boolean {
  return typeof Notification !== 'undefined'
}

export function permission(): string {
  return supported() ? Notification.permission : 'denied'
}

export function isEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false   // private mode, or storage disabled: off is the safe default
  }
}

export function setEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch { /* nothing to do; the toggle simply will not persist */ }
}

/** Must be called from a click handler — browsers reject a bare request. */
export async function enable(): Promise<boolean> {
  if (!supported()) return false
  const result = await Notification.requestPermission()
  const granted = result === 'granted'
  setEnabled(granted)
  return granted
}

/**
 * Open notifications, so they can be withdrawn. A Web Notification does not
 * close itself: without this the tray would still be saying "waiting for you"
 * long after the prompt was answered.
 */
const open = new Map<string, Notification>()

export function fire(session: SessionSummary, onOpen: (sessionId: string) => void): void {
  if (!supported()) return
  const label = session.live?.name ?? session.projectPath?.split('/').pop() ?? 'a session'
  const n = new Notification(`${label} is waiting for you`, {
    body: session.live?.waitingFor ?? 'blocked on your answer',
    tag: session.sessionId,   // one per session, even across tabs
  })
  n.onclick = () => {
    window.focus()
    onOpen(session.sessionId)
    n.close()
  }
  open.get(session.sessionId)?.close()
  open.set(session.sessionId, n)
}

export function dismiss(sessionId: string): void {
  open.get(sessionId)?.close()
  open.delete(sessionId)
}

/**
 * Withdraws every notification whose session is no longer waiting. Needed on the
 * snapshot path: a socket blip while the user answers the prompt means the
 * transition out of `waiting` is never delivered as a delta, and the tray would
 * otherwise keep insisting a session needs them — permanently, since the snapshot
 * also overwrites the status that the delta path compares against.
 *
 * A session that has vanished from the snapshot entirely counts as not waiting.
 */
export function reconcile(stillWaiting: Iterable<string>): void {
  const keep = new Set(stillWaiting)
  for (const id of [...open.keys()]) if (!keep.has(id)) dismiss(id)
}
