import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

/**
 * Loopback binding and the origin guard keep browsers out, but any local
 * process can speak to 127.0.0.1 and set whatever headers it likes. The token
 * is what stops one from registering a directory, rewriting a TASKS.md, or
 * dispatching `claude -p` through us. It lives in a 0600 file so it survives
 * dev-server restarts, and reaches the browser once via `?token=` in the URL.
 */
export async function loadOrCreateToken(path: string): Promise<string> {
  const existing = (await readFile(path, 'utf8').catch(() => null))?.trim()
  if (existing) return existing
  const token = randomBytes(32).toString('hex')
  await writeFile(path, token + '\n', { mode: 0o600 })
  return token
}

export function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The hook and statusline sinks stay open: the forwarder scripts curl them
 * from inside the user's sessions and must never carry a secret into files
 * Claude Code owns. They already answer 200 to garbage by design. Health is
 * a liveness probe with nothing in it.
 */
const EXEMPT_PATHS = new Set(['/api/hooks', '/api/statusline', '/api/health'])

export function requiresToken(url: string): boolean {
  const path = url.split('?', 1)[0]!
  if (EXEMPT_PATHS.has(path)) return false
  return path.startsWith('/api/') || path === '/ws'
}

/** Header for fetches; query parameter for the WebSocket, which cannot set headers. */
export function extractToken(url: string, headers: Record<string, unknown>): string | null {
  const header = headers['x-auth-token']
  if (typeof header === 'string') return header
  const query = url.indexOf('?')
  if (query === -1) return null
  return new URLSearchParams(url.slice(query + 1)).get('token')
}
