import type { SessionStatus } from './types.js'

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// Typed against SessionStatus on purpose: as Record<string, string> a new
// status renders colourless in several places with no compile error. The hue
// pairs with the motion the StatusDot carries for the same state.
export const STATUS_TEXT: Record<SessionStatus, string> = {
  waiting: 'text-alarm',
  active: 'text-work',
  idle: 'text-muted',
  done: 'text-dim',
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  waiting: 'waiting for you',
  active: 'working',
  idle: 'idle',
  done: 'done',
}

/** waiting first: a session blocked on the user is the one thing that needs them. */
export const STATUS_ORDER: Record<SessionStatus, number> = {
  waiting: 0, active: 1, idle: 2, done: 3,
}

/** Local wall-clock HH:MM of a moment; prefixed with day.month when it is not today. */
export function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hm : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`
}

export function elapsed(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}
