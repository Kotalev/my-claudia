import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeHooks, installHooks, isInstalled, HOOK_EVENTS, mergeStatusLine, mergePermissionHook, PERMISSION_EVENT } from '../installer.js'

// Lets the home-directory guard be tested without ever pointing installHooks at
// the real home. Everything else (tmpdir) passes through untouched.
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => process.env.MC_TEST_HOME ?? actual.homedir() }
})

const SCRIPT = '/opt/mc/scripts/hook-post.sh'
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mc-install-')) })

describe('mergeHooks', () => {
  it('adds every hook event to empty settings', () => {
    const { settings, installed } = mergeHooks({}, SCRIPT)
    expect(installed).toEqual([...HOOK_EVENTS])
    for (const event of HOOK_EVENTS) {
      expect((settings.hooks as Record<string, unknown>)[event]).toBeDefined()
    }
  })

  it('preserves unrelated settings keys', () => {
    const { settings } = mergeHooks({ model: 'opus', permissions: { allow: ['Bash'] } }, SCRIPT)
    expect(settings.model).toBe('opus')
    expect(settings.permissions).toEqual({ allow: ['Bash'] })
  })

  it("preserves the user's existing hooks for the same event", () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'afplay done.mp3' }] }] } }
    const { settings } = mergeHooks(existing, SCRIPT)
    const stop = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop!
    const commands = stop.flatMap(g => g.hooks.map(h => h.command))
    expect(commands).toContain('afplay done.mp3')
    expect(commands).toContain(`'${SCRIPT}'`)   // ours is shell-quoted
  })

  it('is idempotent — a second merge installs nothing new', () => {
    const first = mergeHooks({}, SCRIPT)
    const second = mergeHooks(first.settings, SCRIPT)
    expect(second.installed).toEqual([])
    expect(second.alreadyPresent).toEqual([...HOOK_EVENTS])
  })

  it('treats a non-object settings file as empty rather than throwing', () => {
    expect(() => mergeHooks('garbage', SCRIPT)).not.toThrow()
    expect(mergeHooks(null, SCRIPT).installed).toEqual([...HOOK_EVENTS])
    expect(mergeHooks([1, 2], SCRIPT).installed).toEqual([...HOOK_EVENTS])
  })

  it('gives each hook a 1s timeout so it cannot stall a session', () => {
    const { settings } = mergeHooks({}, SCRIPT)
    const start = (settings.hooks as Record<string, { hooks: { timeout?: number }[] }[]>).SessionStart!
    expect(start[0]!.hooks[0]!.timeout).toBe(1)
  })
})

describe('mergePermissionHook', () => {
  const PERM_SCRIPT = '/opt/mc/scripts/permission-prompt.sh'

  it('adds a PermissionRequest group with matcher * and a 30s timeout', () => {
    const { settings, changed } = mergePermissionHook({}, PERM_SCRIPT)
    expect(changed).toBe(true)
    const groups = (settings.hooks as Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>)[PERMISSION_EVENT]!
    expect(groups).toHaveLength(1)
    expect(groups[0]!.matcher).toBe('*')
    expect(groups[0]!.hooks[0]!.command).toBe(`'${PERM_SCRIPT}'`)
    // 30, not 1: blocking is this hook's purpose; timing out safely falls back
    // to the terminal prompt.
    expect(groups[0]!.hooks[0]!.timeout).toBe(30)
  })

  it("preserves the user's own PermissionRequest groups", () => {
    const existing = {
      hooks: { [PERMISSION_EVENT]: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard.sh' }] }] },
    }
    const { settings } = mergePermissionHook(existing, PERM_SCRIPT)
    const groups = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>)[PERMISSION_EVENT]!
    expect(groups.flatMap(g => g.hooks.map(h => h.command))).toContain('my-guard.sh')
    expect(groups.flatMap(g => g.hooks.map(h => h.command))).toContain(`'${PERM_SCRIPT}'`)
  })

  it('is idempotent — a second merge changes nothing', () => {
    const first = mergePermissionHook({}, PERM_SCRIPT)
    const second = mergePermissionHook(first.settings, PERM_SCRIPT)
    expect(second.changed).toBe(false)
    expect(second.settings.hooks).toEqual(first.settings.hooks)
  })

  it('treats non-object settings as empty rather than throwing', () => {
    expect(mergePermissionHook(null, PERM_SCRIPT).changed).toBe(true)
    expect(mergePermissionHook('garbage', PERM_SCRIPT).changed).toBe(true)
    expect(mergePermissionHook([1], PERM_SCRIPT).changed).toBe(true)
  })
})

describe('installHooks', () => {
  it('creates .claude/settings.local.json when absent, with no backup', async () => {
    const result = await installHooks(dir, SCRIPT)
    expect(result.settingsPath.endsWith('settings.local.json')).toBe(true)
    expect(result.backupPath).toBeNull()
    const written = JSON.parse(await readFile(result.settingsPath, 'utf8'))
    expect(written.hooks.SessionStart).toBeDefined()
    expect(await isInstalled(dir, SCRIPT)).toBe(true)
  })

  it('backs up an existing settings file before writing', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    const original = JSON.stringify({ model: 'opus' }, null, 2)
    await writeFile(join(dir, '.claude', 'settings.local.json'), original)

    const result = await installHooks(dir, SCRIPT)
    expect(result.backupPath).toBeTruthy()
    expect(await readFile(result.backupPath!, 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(result.settingsPath, 'utf8')).model).toBe('opus')
  })

  // An unparseable file means we cannot merge, so writing anything would replace
  // the user's permissions/env/hooks with ours alone. The install must abort.
  it('aborts on an unparseable settings file, leaving it untouched', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(join(dir, '.claude', 'settings.local.json'), '{ broken json')

    await expect(installHooks(dir, SCRIPT)).rejects.toThrow(/parse/i)
    expect(await readFile(join(dir, '.claude', 'settings.local.json'), 'utf8')).toBe('{ broken json')
    const files = await readdir(join(dir, '.claude'))
    expect(files.some(f => f.startsWith('settings.local.json.backup-'))).toBe(false)
  })

  it('reports nothing installed on a second run', async () => {
    await installHooks(dir, SCRIPT)
    expect((await installHooks(dir, SCRIPT)).installed).toEqual([])
  })

  it('reports not installed for a project with no settings', async () => {
    expect(await isInstalled(dir, SCRIPT)).toBe(false)
  })

  it('writes the PermissionRequest hook when given its script', async () => {
    const PERM_SCRIPT = '/opt/mc/scripts/permission-prompt.sh'
    const result = await installHooks(dir, SCRIPT, undefined, PERM_SCRIPT)
    expect(result.permissionPrompt).toBe(true)
    const written = JSON.parse(await readFile(result.settingsPath, 'utf8'))
    expect(written.hooks[PERMISSION_EVENT][0].matcher).toBe('*')
    expect(written.hooks[PERMISSION_EVENT][0].hooks[0].timeout).toBe(30)
    expect(await isInstalled(dir, SCRIPT, PERM_SCRIPT)).toBe(true)
  })

  it('counts a missing permission hook as not installed, so the button reappears', async () => {
    const PERM_SCRIPT = '/opt/mc/scripts/permission-prompt.sh'
    await installHooks(dir, SCRIPT)   // an older install, without the permission hook
    expect(await isInstalled(dir, SCRIPT)).toBe(true)
    expect(await isInstalled(dir, SCRIPT, PERM_SCRIPT)).toBe(false)
  })
})

describe('installHooks target guard', () => {
  const saved = {
    configDir: process.env.CLAUDE_CONFIG_DIR,
    home: process.env.MC_TEST_HOME,
  }
  afterEach(() => {
    if (saved.configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = saved.configDir
    if (saved.home === undefined) delete process.env.MC_TEST_HOME
    else process.env.MC_TEST_HOME = saved.home
  })

  it('refuses a project whose .claude directory is the Claude data dir', async () => {
    process.env.CLAUDE_CONFIG_DIR = join(dir, '.claude')
    await expect(installHooks(dir, SCRIPT)).rejects.toThrow(/claude data dir/i)
    // The guard fires before anything is created.
    expect(await readdir(dir)).toEqual([])
  })

  it('refuses the home directory as an install target', async () => {
    process.env.MC_TEST_HOME = dir
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'relocated-claude')
    await expect(installHooks(dir, SCRIPT)).rejects.toThrow(/home directory/i)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('shell quoting', () => {
  it('quotes the command, because a checkout path may contain spaces', async () => {
    const spaced = '/Users/ivan/My Projects/mc/scripts/hook-post.sh'
    const { settings } = mergeHooks({}, spaced)
    const start = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>).SessionStart!
    expect(start[0]!.hooks[0]!.command).toBe(`'${spaced}'`)
  })

  it('stays idempotent for a quoted path', async () => {
    const spaced = '/Users/ivan/My Projects/mc/scripts/hook-post.sh'
    const first = mergeHooks({}, spaced)
    expect(mergeHooks(first.settings, spaced).installed).toEqual([])
  })

  it('escapes a single quote in the path rather than breaking out of the quoting', () => {
    const nasty = "/tmp/it's/hook-post.sh"
    const { settings } = mergeHooks({}, nasty)
    const start = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>).SessionStart!
    expect(start[0]!.hooks[0]!.command).toBe(`'/tmp/it'\\''s/hook-post.sh'`)
  })
})

describe('mergeStatusLine', () => {
  const SCRIPT = '/opt/mission control/scripts/statusline.sh'

  it('wires our forwarder in front of the user existing statusline', () => {
    const { settings, changed } = mergeStatusLine({}, SCRIPT, 'bash ~/.claude/statusline.sh')
    expect(changed).toBe(true)
    const line = settings.statusLine as { type: string; command: string }
    expect(line.type).toBe('command')
    // Their command is preserved and handed on, quoted, as our argument.
    expect(line.command).toBe(`'${SCRIPT}' 'bash ~/.claude/statusline.sh'`)
  })

  it('prefers a statusline already set on the project over the global one', () => {
    const { settings } = mergeStatusLine(
      { statusLine: { type: 'command', command: 'project-line.sh' } },
      SCRIPT,
      'global-line.sh',
    )
    expect((settings.statusLine as { command: string }).command).toContain("'project-line.sh'")
    expect((settings.statusLine as { command: string }).command).not.toContain('global-line.sh')
  })

  it('installs alone when the user has no statusline at all', () => {
    const { settings } = mergeStatusLine({}, SCRIPT, null)
    expect((settings.statusLine as { command: string }).command).toBe(`'${SCRIPT}'`)
  })

  it('is idempotent: a second install must not swallow the passthrough', () => {
    const first = mergeStatusLine({}, SCRIPT, 'bash ~/.claude/statusline.sh')
    const second = mergeStatusLine(first.settings, SCRIPT, 'bash ~/.claude/statusline.sh')
    expect(second.changed).toBe(false)
    expect(second.settings.statusLine).toEqual(first.settings.statusLine)
  })

  it('leaves the rest of the settings untouched', () => {
    const { settings } = mergeStatusLine({ permissions: { allow: ['Read'] } }, SCRIPT, null)
    expect(settings.permissions).toEqual({ allow: ['Read'] })
  })

  it('tolerates settings that are not an object', () => {
    expect(mergeStatusLine(null, SCRIPT, null).changed).toBe(true)
    expect(mergeStatusLine('nonsense', SCRIPT, null).changed).toBe(true)
    expect(mergeStatusLine([1], SCRIPT, null).changed).toBe(true)
  })

  it('tolerates a statusLine that is not shaped as expected', () => {
    const { settings } = mergeStatusLine({ statusLine: 'just-a-string' }, SCRIPT, 'global.sh')
    expect((settings.statusLine as { command: string }).command).toContain("'global.sh'")
  })
})
