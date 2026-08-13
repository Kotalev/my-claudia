import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Bind address. Loopback by default; MC_HOST is the explicit opt-in for
 * remote/mobile access. On a non-loopback bind the ?token= URL is the only
 * thing keeping the dashboard private — the CLI warns about exactly that.
 * An empty MC_HOST means "not set", not "bind everything".
 */
export function resolveHost(env: string | undefined = process.env.MC_HOST): string {
  return env?.trim() ? env.trim() : '127.0.0.1'
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

export const HOST = resolveHost()
export const PORT = 4517

/** Claude Code's data directory. Never hardcode ~/.claude — CLAUDE_CONFIG_DIR may relocate it. */
export function resolveClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

/** Claude Code names transcript dirs by replacing every non-alphanumeric char with '-'. Lossy: not reversible. */
export function escapeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

export function projectsDir(): string {
  return join(resolveClaudeDir(), 'projects')
}

/** Claude Code writes one file per live process here, named `<pid>.json`. */
export function sessionsDir(): string {
  return join(resolveClaudeDir(), 'sessions')
}
