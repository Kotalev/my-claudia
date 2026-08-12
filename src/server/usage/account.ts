import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where Claude Code keeps its account state. Unlike the data dir, this file
 * lives directly in the home directory when `CLAUDE_CONFIG_DIR` is unset — it
 * is `~/.claude.json`, not `~/.claude/.claude.json`.
 */
function claudeJsonPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR
  return dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json')
}

/**
 * The email of the logged-in Claude account, from `oauthAccount.emailAddress`.
 * Read-only, never written. A missing file, a missing field, or garbage JSON
 * all mean "we do not know" — null, never a throw.
 */
export function readAccountEmail(): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(claudeJsonPath(), 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const account = (parsed as Record<string, unknown>).oauthAccount
  if (typeof account !== 'object' || account === null || Array.isArray(account)) return null
  const email = (account as Record<string, unknown>).emailAddress
  return typeof email === 'string' && email.length > 0 ? email : null
}
