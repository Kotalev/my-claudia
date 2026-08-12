import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseTasks, nextTaskId } from '../parse.js'
import { serializeTasks } from '../serialize.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${name}`, import.meta.url)), 'utf8')

describe('parseTasks', () => {
  it('reads ids, statuses, titles and tags from the spec format', () => {
    const doc = parseTasks(fixture('tasks-sample.md'))
    expect(doc.tasks.map(t => t.id)).toEqual(['T-003', 'T-002', 'T-001'])
    expect(doc.tasks.map(t => t.status)).toEqual(['todo', 'in-progress', 'done'])
    expect(doc.tasks[0]!.title).toBe('Add dark mode toggle')
    expect(doc.tasks[0]!.tags).toEqual(['ui', 'p2'])
    expect(doc.tasks[2]!.doneDate).toBe('2026-08-12')
    expect(doc.tasks[1]!.note).toBe('session: 8f3a…')
  })

  it('keeps progress log lines verbatim and newest first', () => {
    const doc = parseTasks(fixture('tasks-messy.md'))
    expect(doc.progress).toHaveLength(2)
    expect(doc.progress[0]!.raw).toContain('T-002 — parser handles tool_use lines')
  })

  it('skips lines that are not tasks rather than throwing', () => {
    const doc = parseTasks(fixture('tasks-messy.md'))
    expect(doc.tasks.map(t => t.id)).toEqual(['T-010', 'T-011', 'T-002', 'T-001'])
  })

  it('tolerates irregular whitespace', () => {
    const doc = parseTasks(fixture('tasks-messy.md'))
    const t11 = doc.tasks.find(t => t.id === 'T-011')!
    expect(t11.title).toBe('Extra whitespace')
    expect(t11.tags).toEqual(['p3'])
  })

  it('returns an empty doc for empty input', () => {
    const doc = parseTasks('')
    expect(doc.tasks).toEqual([])
    expect(doc.progress).toEqual([])
  })

  it('trusts the checkbox over the section heading', () => {
    const doc = parseTasks('# Tasks\n\n## Todo\n\n- [x] **T-001** Actually done\n')
    expect(doc.tasks[0]!.status).toBe('done')
  })
})

describe('round-trip', () => {
  for (const name of ['tasks-sample.md', 'tasks-messy.md']) {
    it(`parse -> serialize -> parse is stable for ${name}`, () => {
      const once = parseTasks(fixture(name))
      const twice = parseTasks(serializeTasks(once))
      expect(twice).toEqual(once)
    })
  }

  it('serialize -> parse -> serialize is byte-identical', () => {
    const doc = parseTasks(fixture('tasks-sample.md'))
    const a = serializeTasks(doc)
    expect(serializeTasks(parseTasks(a))).toBe(a)
  })

  it('emits all sections even when empty', () => {
    const out = serializeTasks(parseTasks(''))
    expect(out).toContain('## Todo')
    expect(out).toContain('## In progress')
    expect(out).toContain('## Done')
    expect(out).toContain('## Progress log')
  })

  it('round-trips this repository own TASKS.md', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../../TASKS.md', import.meta.url)), 'utf8')
    const once = parseTasks(raw)
    expect(once.tasks.length).toBeGreaterThan(5)
    expect(parseTasks(serializeTasks(once))).toEqual(once)
  })
})

describe('nextTaskId', () => {
  it('is one past the highest existing id', () => {
    expect(nextTaskId(parseTasks(fixture('tasks-messy.md')))).toBe('T-012')
  })
  it('starts at T-001 for an empty doc', () => {
    expect(nextTaskId(parseTasks(''))).toBe('T-001')
  })
})
