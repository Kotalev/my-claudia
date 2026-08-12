import type { SessionStatus } from './types.js'

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// Typed against SessionStatus on purpose: as Record<string, string> a new status
// renders a colourless dot in three places with no compile error.
export const STATUS_STYLES: Record<SessionStatus, string> = {
  waiting: 'bg-amber-400 animate-pulse motion-reduce:animate-none',
  active: 'bg-emerald-500 animate-pulse motion-reduce:animate-none',
  idle: 'bg-muted',
  // Outline rather than fill. `bg-neutral-700` was 1.9:1 against the page —
  // below the 3:1 floor for a non-text indicator, and next to the
  // neutral-800 borders it read as an empty slot. This way idle and done
  // differ by form as well as by luminance, which colour cannot take away.
  done: 'border border-muted bg-transparent',
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

export function elapsed(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}
