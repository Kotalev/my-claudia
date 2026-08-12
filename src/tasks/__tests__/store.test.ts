import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskStore } from '../store.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mc-tasks-')) })

describe('TaskStore', () => {
  it('returns an empty doc when TASKS.md does not exist', async () => {
    const doc = await new TaskStore(dir).read()
    expect(doc.tasks).toEqual([])
  })

  it('creates TASKS.md on first add with a sequential id', async () => {
    const store = new TaskStore(dir)
    const task = await store.addTask({ title: 'First thing', tags: ['p1'] })
    expect(task.id).toBe('T-001')
    expect(task.status).toBe('todo')
    const raw = await readFile(join(dir, 'TASKS.md'), 'utf8')
    expect(raw).toContain('- [ ] **T-001** First thing `#p1`')
  })

  it('never reuses an id, even after a task is deleted from the file by hand', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'One' })
    await store.addTask({ title: 'Two' })
    await writeFile(join(dir, 'TASKS.md'),
      '# Tasks\n\n## Todo\n\n- [ ] **T-002** Two\n\n## In progress\n\n## Done\n\n## Progress log\n')
    const third = await store.addTask({ title: 'Three' })
    expect(third.id).toBe('T-003')
  })

  it('moves a task between sections when its status changes', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Move me' })
    const updated = await store.updateTask('T-001', { status: 'in-progress' })
    expect(updated.status).toBe('in-progress')
    const raw = await readFile(join(dir, 'TASKS.md'), 'utf8')
    expect(raw).toMatch(/## In progress\n\n- \[~\] \*\*T-001\*\* Move me/)
  })

  it('stamps a date when a task is marked done', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Finish me' })
    const done = await store.updateTask('T-001', { status: 'done' })
    expect(done.doneDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('clears the done date when a task is reopened', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Reopen me' })
    await store.updateTask('T-001', { status: 'done' })
    const reopened = await store.updateTask('T-001', { status: 'todo' })
    expect(reopened.doneDate).toBeNull()
  })

  it('rejects an unknown task id', async () => {
    const store = new TaskStore(dir)
    await expect(store.updateTask('T-999', { status: 'done' })).rejects.toThrow(/unknown task/i)
  })

  it('prepends progress log lines so newest is first', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'X' })
    await store.appendProgress('2026-08-12 10:00 T-001 — started')
    await store.appendProgress('2026-08-12 11:00 T-001 — finished')
    const doc = await store.read()
    expect(doc.progress[0]!.raw).toContain('finished')
  })

  it('picks up an external edit made between two writes', async () => {
    const store = new TaskStore(dir)
    await store.addTask({ title: 'Mine' })
    const raw = await readFile(join(dir, 'TASKS.md'), 'utf8')
    await writeFile(join(dir, 'TASKS.md'),
      raw.replace('- [ ] **T-001** Mine', '- [ ] **T-001** Mine\n- [ ] **T-005** Theirs'))
    const added = await store.addTask({ title: 'Next' })
    expect(added.id).toBe('T-006')
    const doc = await store.read()
    expect(doc.tasks.map(t => t.id)).toContain('T-005')
  })
})
