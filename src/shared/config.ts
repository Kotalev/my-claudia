import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOST = '127.0.0.1'
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
