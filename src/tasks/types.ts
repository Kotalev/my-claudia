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

export interface TasksDoc {
  title: string
  tasks: Task[]
  progress: ProgressEntry[]
  preamble: string[]
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
