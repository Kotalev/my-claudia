import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveClaudeDir } from '../../shared/config.js'

export const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse'] as const

/** Answered from the dashboard, so it gets its own blocking script — see SPEC 8.11. */
export const PERMISSION_EVENT = 'PermissionRequest'

export interface InstallResult {
  settingsPath: string
  backupPath: string | null
  installed: string[]
  alreadyPresent: string[]
  /** True when the statusline forwarder was newly wired in. */
  statusLine: boolean
  /** True when the PermissionRequest hook was newly wired in. */
  permissionPrompt: boolean
}

interface HookCommand { type: 'command'; command: string; timeout?: number }
interface HookGroup { matcher?: string; hooks: HookCommand[] }

/** Hook commands are run through a shell, so a checkout path with a space would split. */
export function shellQuote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`
}

export function buildHookEntry(scriptPath: string): HookCommand {
  // No matcher: matcher semantics have changed across Claude Code releases, and
  // we want every occurrence of these events regardless.
  return { type: 'command', command: shellQuote(scriptPath), timeout: 1 }
}

export function buildPermissionEntry(scriptPath: string): HookCommand {
  // 30s, not 1: blocking is this hook's whole purpose — the window is how a
  // dashboard click reaches the prompt. Timing out is still safe: no stdout
  // means Claude Code falls back to its normal terminal prompt.
  return { type: 'command', command: shellQuote(scriptPath), timeout: 30 }
}

/**
 * Adds the PermissionRequest hook beside whatever groups the user already has
 * for that event, matcher `*` so every tool's prompt reaches the dashboard.
 * Kept apart from mergeHooks: a different script, a different timeout, and a
 * failure philosophy of "block, then fall back" rather than "never block".
 */
export function mergePermissionHook(
  existing: unknown,
  scriptPath: string,
): { settings: Record<string, unknown>; changed: boolean } {
  const base: Record<string, unknown> =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}

  const hooksRaw = base.hooks
  const hooks: Record<string, HookGroup[]> =
    typeof hooksRaw === 'object' && hooksRaw !== null && !Array.isArray(hooksRaw)
      ? { ...(hooksRaw as Record<string, HookGroup[]>) }
      : {}

  const groups = Array.isArray(hooks[PERMISSION_EVENT]) ? [...hooks[PERMISSION_EVENT]] : []
  const quoted = shellQuote(scriptPath)
  const present = groups.some(g =>
    Array.isArray(g?.hooks) && g.hooks.some(h => h?.command === quoted))
  if (present) {
    base.hooks = hooks
    return { settings: base, changed: false }
  }

  groups.push({ matcher: '*', hooks: [buildPermissionEntry(scriptPath)] })
  hooks[PERMISSION_EVENT] = groups
  base.hooks = hooks
  return { settings: base, changed: true }
}

// Hooks are a per-machine concern (they carry absolute paths into this
// checkout), so they belong in settings.local.json, which Claude Code keeps
// out of version control — never in the project's shared settings.json.
function settingsPathFor(projectPath: string): string {
  return join(projectPath, '.claude', 'settings.local.json')
}

export function mergeHooks(
  existing: unknown,
  scriptPath: string,
): { settings: Record<string, unknown>; installed: string[]; alreadyPresent: string[] } {
  const base: Record<string, unknown> =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}

  const hooksRaw = base.hooks
  const hooks: Record<string, HookGroup[]> =
    typeof hooksRaw === 'object' && hooksRaw !== null && !Array.isArray(hooksRaw)
      ? { ...(hooksRaw as Record<string, HookGroup[]>) }
      : {}

  const installed: string[] = []
  const alreadyPresent: string[] = []

  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? [...hooks[event]] : []
    const quoted = shellQuote(scriptPath)
    const present = groups.some(g =>
      Array.isArray(g?.hooks) && g.hooks.some(h => h?.command === quoted))

    if (present) {
      alreadyPresent.push(event)
      hooks[event] = groups
      continue
    }

    // Append our own group rather than touching any the user already has.
    groups.push({ hooks: [buildHookEntry(scriptPath)] })
    hooks[event] = groups
    installed.push(event)
  }

  base.hooks = hooks
  return { settings: base, installed, alreadyPresent }
}

/**
 * Wires our statusline forwarder in front of whatever statusline the user already
 * runs, passing that command through as an argument so their prompt is unchanged.
 * The statusline is the only supported source for plan-limit consumption.
 *
 * Installed at project scope, never in the Claude data dir: settings there are
 * the user's own and this project does not write to them.
 */
export function mergeStatusLine(
  settings: unknown,
  statuslineScript: string,
  currentCommand: string | null,
): { settings: Record<string, unknown>; changed: boolean } {
  const base = (typeof settings === 'object' && settings !== null && !Array.isArray(settings)
    ? { ...settings as Record<string, unknown> }
    : {})

  const existing = typeof base.statusLine === 'object' && base.statusLine !== null
    ? base.statusLine as Record<string, unknown>
    : null
  const existingCommand = typeof existing?.command === 'string' ? existing.command : null

  // Already ours: leave it alone, or its passthrough would be swallowed on a
  // second install and the user's statusline would disappear.
  if (existingCommand?.includes(statuslineScript)) return { settings: base, changed: false }

  const passthrough = existingCommand ?? currentCommand
  const command = passthrough
    ? `${shellQuote(statuslineScript)} ${shellQuote(passthrough)}`
    : shellQuote(statuslineScript)

  base.statusLine = { type: 'command', command }
  return { settings: base, changed: true }
}

/** The statusline the user runs today, from their own settings. Read only. */
export async function currentStatusLineCommand(): Promise<string | null> {
  const raw = await readFile(join(resolveClaudeDir(), 'settings.json'), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const line = (parsed as Record<string, unknown>)?.statusLine
    const command = (line as Record<string, unknown>)?.command
    return typeof command === 'string' && command.length > 0 ? command : null
  } catch {
    return null
  }
}

export async function installHooks(
  projectPath: string,
  scriptPath: string,
  statuslineScript?: string,
  permissionScript?: string,
): Promise<InstallResult> {
  // The one file this project must never touch is the Claude data dir's own
  // settings.json — and registering $HOME as a project would make exactly that
  // file the install target. Refuse before anything is created.
  const target = resolve(projectPath)
  if (target === resolve(homedir())) {
    throw new Error('refusing to install hooks into the home directory')
  }
  if (resolve(join(target, '.claude')) === resolve(resolveClaudeDir())) {
    throw new Error("refusing to write the Claude data dir's settings.json")
  }

  const settingsPath = settingsPathFor(projectPath)
  const raw = await readFile(settingsPath, 'utf8').catch(() => null)

  // An unparseable file cannot be merged; writing anyway would replace the
  // user's permissions/env/hooks with ours alone. Abort instead.
  let parsed: unknown = {}
  if (raw !== null) {
    try { parsed = JSON.parse(raw) } catch {
      throw new Error(`${settingsPath} could not be parsed as JSON; not overwriting it`)
    }
  }

  await mkdir(join(projectPath, '.claude'), { recursive: true })
  let backupPath: string | null = null
  if (raw !== null) {
    // Never overwrite a user's settings without leaving a copy beside it.
    backupPath = `${settingsPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await copyFile(settingsPath, backupPath)
  }

  const { settings, installed, alreadyPresent } = mergeHooks(parsed, scriptPath)
  let statusLine = false
  let merged = settings
  if (statuslineScript) {
    const result = mergeStatusLine(settings, statuslineScript, await currentStatusLineCommand())
    merged = result.settings
    statusLine = result.changed
  }
  let permissionPrompt = false
  if (permissionScript) {
    const result = mergePermissionHook(merged, permissionScript)
    merged = result.settings
    permissionPrompt = result.changed
  }
  await writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')

  return { settingsPath, backupPath, installed, alreadyPresent, statusLine, permissionPrompt }
}

export async function isInstalled(
  projectPath: string,
  scriptPath: string,
  permissionScript?: string,
): Promise<boolean> {
  const raw = await readFile(settingsPathFor(projectPath), 'utf8').catch(() => null)
  if (raw === null) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    const { alreadyPresent } = mergeHooks(parsed, scriptPath)
    if (alreadyPresent.length !== HOOK_EVENTS.length) return false
    // "Installed" now includes the permission hook: an older install without
    // it should offer the button again rather than claim it is complete.
    return permissionScript ? !mergePermissionHook(parsed, permissionScript).changed : true
  } catch {
    return false
  }
}
