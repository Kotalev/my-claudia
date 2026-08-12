import type { Task } from '../../tasks/types.js'

/**
 * Built as a single string and passed to claude as one argv element, so the
 * task text needs no escaping — it is never seen by a shell.
 */
export function buildTaskPrompt(task: Task): string {
  const tags = task.tags.length > 0 ? ` (tags: ${task.tags.map(t => `#${t}`).join(' ')})` : ''
  return [
    `Work on task ${task.id} from TASKS.md in this repository.`,
    ``,
    `${task.id}: ${task.title}${tags}`,
    ``,
    `Follow the task workflow in CLAUDE.md: move ${task.id} to In progress with [~] before you`,
    `start, append a line to the Progress log after each meaningful milestone, and when the work`,
    `is finished move ${task.id} to Done with [x] and today's date plus a final Progress log line.`,
  ].join('\n')
}
