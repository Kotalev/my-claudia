import {
  CHECKBOX_FOR_STATUS, SECTION_FOR_STATUS,
  type Task, type TaskStatus, type TasksDoc,
} from './types.js'

const ORDER: TaskStatus[] = ['todo', 'in-progress', 'done']

function serializeTask(task: Task): string {
  const parts = [`- [${CHECKBOX_FOR_STATUS[task.status]}] **${task.id}** ${task.title}`.trimEnd()]
  for (const tag of task.tags) parts.push(`\`#${tag}\``)
  if (task.doneDate) parts.push(`(${task.doneDate})`)
  else if (task.note) parts.push(`(${task.note})`)
  return parts.join(' ')
}

export function serializeTasks(doc: TasksDoc): string {
  const out: string[] = [`# ${doc.title}`, '']

  for (const line of doc.preamble) out.push(line, '')

  for (const status of ORDER) {
    out.push(`## ${SECTION_FOR_STATUS[status]}`, '')
    for (const task of doc.tasks.filter(t => t.status === status)) out.push(serializeTask(task))
    // Prose, subheadings and anything else the section held. Emitted after the
    // tasks so a rewrite reorders content but never discards it.
    const extras = doc.sectionExtras[status] ?? []
    if (extras.length > 0) {
      out.push('')
      out.push(...extras)
    }
    out.push('')
  }

  out.push('## Progress log', '')
  for (const entry of doc.progress) out.push(`- ${entry.raw}`)
  out.push('')

  for (const section of doc.extraSections) {
    out.push(`## ${section.heading}`, '')
    out.push(...section.lines)
    out.push('')
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
