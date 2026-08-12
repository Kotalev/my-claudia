export type TaskStatus = 'todo' | 'in-progress' | 'done'

export interface Task {
  id: string
  status: TaskStatus
  title: string
  tags: string[]
  doneDate: string | null
  note: string | null
}

export interface ProgressEntry { raw: string }

/** A section heading we do not model, kept verbatim so a rewrite cannot delete it. */
export interface ExtraSection {
  heading: string
  lines: string[]
}

export interface TasksDoc {
  title: string
  tasks: Task[]
  progress: ProgressEntry[]
  /** Lines before the first heading. */
  preamble: string[]
  /** Non-task lines found inside a known section, kept in order, per section. */
  sectionExtras: Record<string, string[]>
  /** Whole sections we do not model, in the order they appeared. */
  extraSections: ExtraSection[]
}

export const SECTION_FOR_STATUS: Record<TaskStatus, string> = {
  todo: 'Todo',
  'in-progress': 'In progress',
  done: 'Done',
}

export const CHECKBOX_FOR_STATUS: Record<TaskStatus, string> = {
  todo: ' ',
  'in-progress': '~',
  done: 'x',
}
