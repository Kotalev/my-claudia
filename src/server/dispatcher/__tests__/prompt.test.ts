import { describe, it, expect } from 'vitest'
import { buildTaskPrompt } from '../prompt.js'
import type { Task } from '../../../tasks/types.js'

const task: Task = {
  id: 'T-042', status: 'todo', title: 'Add dark mode toggle',
  tags: ['ui', 'p2'], doneDate: null, note: null,
}

describe('buildTaskPrompt', () => {
  it('names the task id so the agent can find it in TASKS.md', () => {
    expect(buildTaskPrompt(task)).toContain('T-042')
  })

  it('includes the title as context', () => {
    expect(buildTaskPrompt(task)).toContain('Add dark mode toggle')
  })

  it('carries the tags through', () => {
    expect(buildTaskPrompt(task)).toContain('#ui #p2')
  })

  it('instructs the agent to update TASKS.md when done', () => {
    const prompt = buildTaskPrompt(task).toLowerCase()
    expect(prompt).toContain('tasks.md')
    expect(prompt).toContain('progress log')
  })

  it('reproduces shell metacharacters verbatim, since nothing escapes them', () => {
    const nasty: Task = { ...task, title: 'Fix `rm -rf $(pwd)` handling; see #1' }
    expect(buildTaskPrompt(nasty)).toContain('Fix `rm -rf $(pwd)` handling; see #1')
  })

  it('omits the tag clause when a task has no tags', () => {
    expect(buildTaskPrompt({ ...task, tags: [] })).not.toContain('tags:')
  })
})
