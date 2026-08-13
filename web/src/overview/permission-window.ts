/**
 * Mirrors the server's hold window. After it lapses the held reply has already
 * answered "no opinion", so a card past this age is a dead control and hides
 * itself even if no `permission.resolved` ever arrives.
 */
export const WINDOW_MS = 22_000

export function remainingMs(createdAt: string, now: number): number {
  const started = Date.parse(createdAt)
  if (Number.isNaN(started)) return 0
  return Math.max(0, started + WINDOW_MS - now)
}
