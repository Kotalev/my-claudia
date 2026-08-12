import type { ExtraSection, Task, TaskStatus, TasksDoc } from './types.js'

const STATUS_FOR_CHECKBOX: Record<string, TaskStatus> = {
  ' ': 'todo', '~': 'in-progress', x: 'done', X: 'done',
}

/** `- [ ] **T-003** Title `#tag` (note)` — the checkbox and id are the only required parts. */
const TASK_RE = /^-\s*\[([ ~xX])\]\s*\*\*(T-\d+)\*\*\s*(.*)$/
const TAG_RE = /`#([a-zA-Z0-9_-]+)`/g
const DATE_RE = /\((\d{4}-\d{2}-\d{2})\)\s*$/
const NOTE_RE = /\(([^)]*)\)\s*$/

function parseTaskLine(line: string, sectionStatus: TaskStatus | null): Task | null {
  const m = TASK_RE.exec(line.trim())
  if (!m) return null
  const [, box, id, rest = ''] = m

  const tags = [...rest.matchAll(TAG_RE)].map(t => t[1]!)
  let body = rest.replace(TAG_RE, ' ')

  const dateMatch = DATE_RE.exec(body)
  let doneDate: string | null = null
  let note: string | null = null
  if (dateMatch) {
    doneDate = dateMatch[1]!
    body = body.slice(0, dateMatch.index)
  } else {
    const noteMatch = NOTE_RE.exec(body)
    if (noteMatch) {
      note = noteMatch[1]!.trim()
      body = body.slice(0, noteMatch.index)
    }
  }

  return {
    id: id!,
    // The checkbox is authoritative; the section heading is only a fallback.
    status: STATUS_FOR_CHECKBOX[box!] ?? sectionStatus ?? 'todo',
    title: body.replace(/\s+/g, ' ').trim(),
    tags,
    doneDate,
    note,
  }
}

export function parseTasks(markdown: string): TasksDoc {
  const doc: TasksDoc = {
    title: 'Tasks', tasks: [], progress: [], preamble: [], sectionExtras: {}, extraSections: [],
  }
  let section: TaskStatus | 'progress' | null = null
  let extraSection: ExtraSection | null = null
  let sawSection = false
  let inFence = false

  const keepExtra = (line: string): void => {
    if (extraSection) { extraSection.lines.push(line); return }
    if (section === null || section === 'progress') return
    ;(doc.sectionExtras[section] ??= []).push(line)
  }

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()

    // Inside a fenced block nothing is markdown structure — a `# ` there is code.
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      keepExtra(line)
      continue
    }
    if (inFence) { keepExtra(line); continue }

    if (trimmed.startsWith('# ')) { doc.title = trimmed.slice(2).trim(); continue }

    if (trimmed.startsWith('## ')) {
      sawSection = true
      extraSection = null
      const heading = trimmed.slice(3).trim()
      switch (heading.toLowerCase()) {
        case 'todo': section = 'todo'; break
        case 'in progress': section = 'in-progress'; break
        case 'done': section = 'done'; break
        case 'progress log': section = 'progress'; break
        default:
          // Someone else's section. Keep it whole rather than deciding it is noise.
          section = null
          extraSection = { heading, lines: [] }
          doc.extraSections.push(extraSection)
      }
      continue
    }

    if (trimmed.length === 0) continue

    if (extraSection) { extraSection.lines.push(line); continue }

    if (section === 'progress') {
      if (trimmed.startsWith('- ')) doc.progress.push({ raw: trimmed.slice(2).trim() })
      continue
    }
    if (section === null) {
      if (!sawSection) doc.preamble.push(trimmed)
      continue
    }

    const task = parseTaskLine(line, section)
    if (task) doc.tasks.push(task)
    else keepExtra(line)
  }

  return doc
}

/** Ids are sequential and never reused, so this is max-seen + 1, not count + 1. */
export function nextTaskId(doc: TasksDoc): string {
  const highest = doc.tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(2))), 0)
  return `T-${String(highest + 1).padStart(3, '0')}`
}
