import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionWatcher } from '../index.js'
import { SessionStore } from '../session-store.js'
import { ProjectRegistry } from '../../registry.js'
import type { SessionSummary } from '../../../shared/types.js'

let claudeDir: string
let projectDir: string
let watcher: SessionWatcher | null = null

function line(uuid: string, text: string, ts = '2026-08-12T10:00:00.000Z') {
  return JSON.stringify({
    type: 'user', uuid, sessionId: 'sess-abc', timestamp: ts,
    cwd: '/work/demo', version: '2.1.0', message: { role: 'user', content: text },
  }) + '\n'
}

/** Waits for the watcher to emit a session summary, or rejects on timeout. */
function nextSession(w: SessionWatcher, timeoutMs = 10_000): Promise<SessionSummary> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no session event within timeout')), timeoutMs)
    w.once('session', (s: SessionSummary) => { clearTimeout(timer); resolve(s) })
  })
}

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'mc-claude-'))
  process.env.CLAUDE_CONFIG_DIR = claudeDir
  projectDir = join(claudeDir, 'projects', '-work-demo')
  await mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await watcher?.stop()
  watcher = null
  delete process.env.CLAUDE_CONFIG_DIR
})

describe('SessionWatcher', () => {
  it('picks up a transcript that already exists when it starts', async () => {
    await writeFile(join(projectDir, 'sess-abc.jsonl'), line('u1', 'hello there'))

    const store = new SessionStore()
    const registry = new ProjectRegistry(join(claudeDir, 'projects.json'))
    await registry.load()
    watcher = new SessionWatcher(registry, store)

    const seen = nextSession(watcher)
    await watcher.start()
    const summary = await seen

    expect(summary.sessionId).toBe('sess-abc')
    expect(summary.lastUserPrompt).toBe('hello there')
  })

  it('emits again when a line is appended to a watched transcript', async () => {
    const file = join(projectDir, 'sess-abc.jsonl')
    await writeFile(file, line('u1', 'first'))

    const store = new SessionStore()
    const registry = new ProjectRegistry(join(claudeDir, 'projects.json'))
    await registry.load()
    watcher = new SessionWatcher(registry, store)

    const initial = nextSession(watcher)
    await watcher.start()
    await initial

    const appended = nextSession(watcher)
    await appendFile(file, line('u2', 'second', '2026-08-12T10:05:00.000Z'))
    const summary = await appended

    expect(summary.lastUserPrompt).toBe('second')
    expect(summary.messageCount).toBe(2)
  })

  it('ignores non-jsonl files in the projects tree', async () => {
    await writeFile(join(projectDir, 'notes.txt'), 'not a transcript\n')
    await writeFile(join(projectDir, 'sess-abc.jsonl'), line('u1', 'only me'))

    const store = new SessionStore()
    const registry = new ProjectRegistry(join(claudeDir, 'projects.json'))
    await registry.load()
    watcher = new SessionWatcher(registry, store)

    const seen = nextSession(watcher)
    await watcher.start()
    await seen

    expect(store.all().map(s => s.sessionId)).toEqual(['sess-abc'])
  })
})
