import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TasksWatcher, type TasksChange } from '../tasks-watcher.js'
import { ProjectRegistry } from '../../registry.js'

let projectDir: string
let registry: ProjectRegistry
let watcher: TasksWatcher | null = null

const DOC = '# Tasks\n\n## Todo\n\n- [ ] **T-001** Written by hand\n\n## In progress\n\n## Done\n\n## Progress log\n'

function nextChange(w: TasksWatcher, timeoutMs = 10_000): Promise<TasksChange> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no tasks event within timeout')), timeoutMs)
    w.once('tasks', (c: TasksChange) => { clearTimeout(timer); resolve(c) })
  })
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'mc-tw-'))
  projectDir = root
  registry = new ProjectRegistry(join(root, 'projects.json'))
  await registry.load()
  await registry.add(projectDir)
})

afterEach(async () => { await watcher?.stop(); watcher = null })

describe('TasksWatcher', () => {
  it('emits the parsed doc when TASKS.md is created by hand', async () => {
    watcher = new TasksWatcher(registry)
    await watcher.start()
    const change = nextChange(watcher)
    await writeFile(join(projectDir, 'TASKS.md'), DOC)
    const { projectId, doc } = await change

    expect(projectId).toBe(registry.list()[0]!.id)
    expect(doc.tasks.map(t => t.id)).toEqual(['T-001'])
  })

  it('emits again when the file changes', async () => {
    await writeFile(join(projectDir, 'TASKS.md'), DOC)
    watcher = new TasksWatcher(registry)
    await watcher.start()

    const change = nextChange(watcher)
    await writeFile(join(projectDir, 'TASKS.md'), DOC.replace('Written by hand', 'Edited by hand'))
    const { doc } = await change

    expect(doc.tasks[0]!.title).toBe('Edited by hand')
  })

  it('starts without a watcher when no projects are registered', async () => {
    const empty = new ProjectRegistry(join(projectDir, 'empty.json'))
    await empty.load()
    watcher = new TasksWatcher(empty)
    await expect(watcher.start()).resolves.toBeUndefined()
  })
})
