import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeHooks, installHooks, isInstalled, HOOK_EVENTS } from '../installer.js'

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
    expect(commands).toContain(SCRIPT)
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

describe('installHooks', () => {
  it('creates .claude/settings.json when absent, with no backup', async () => {
    const result = await installHooks(dir, SCRIPT)
    expect(result.backupPath).toBeNull()
    const written = JSON.parse(await readFile(result.settingsPath, 'utf8'))
    expect(written.hooks.SessionStart).toBeDefined()
    expect(await isInstalled(dir, SCRIPT)).toBe(true)
  })

  it('backs up an existing settings file before writing', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    const original = JSON.stringify({ model: 'opus' }, null, 2)
    await writeFile(join(dir, '.claude', 'settings.json'), original)

    const result = await installHooks(dir, SCRIPT)
    expect(result.backupPath).toBeTruthy()
    expect(await readFile(result.backupPath!, 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(result.settingsPath, 'utf8')).model).toBe('opus')
  })

  it('backs up a corrupt settings file rather than losing it', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(join(dir, '.claude', 'settings.json'), '{ broken json')

    const result = await installHooks(dir, SCRIPT)
    expect(await readFile(result.backupPath!, 'utf8')).toBe('{ broken json')
    const files = await readdir(join(dir, '.claude'))
    expect(files.some(f => f.startsWith('settings.json.backup-'))).toBe(true)
  })

  it('reports nothing installed on a second run', async () => {
    await installHooks(dir, SCRIPT)
    expect((await installHooks(dir, SCRIPT)).installed).toEqual([])
  })

  it('reports not installed for a project with no settings', async () => {
    expect(await isInstalled(dir, SCRIPT)).toBe(false)
  })
})
