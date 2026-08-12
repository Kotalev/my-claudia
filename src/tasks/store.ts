import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nextTaskId, parseTasks } from './parse.js'
import { serializeTasks } from './serialize.js'
import type { Task, TaskStatus, TasksDoc } from './types.js'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export class TaskStore {
  readonly filePath: string

  constructor(projectPath: string) {
    this.filePath = join(projectPath, 'TASKS.md')
  }

  async read(): Promise<TasksDoc> {
    const raw = await readFile(this.filePath, 'utf8').catch(() => '')
    return parseTasks(raw)
  }

  async addTask(input: { title: string; tags?: string[] }): Promise<Task> {
    // Re-read first: a Claude Code session may have edited the file since we last looked.
    const doc = await this.read()
    const task: Task = {
      id: nextTaskId(doc),
      status: 'todo',
      title: input.title.trim(),
      tags: input.tags ?? [],
      doneDate: null,
      note: null,
    }
    doc.tasks.push(task)
    await this.#write(doc)
    return task
  }

  async updateTask(
    id: string,
    patch: { status?: TaskStatus; title?: string; tags?: string[]; note?: string | null },
  ): Promise<Task> {
    const doc = await this.read()
    const task = doc.tasks.find(t => t.id === id)
    if (!task) throw new Error(`unknown task ${id}`)

    if (patch.title !== undefined) task.title = patch.title.trim()
    if (patch.tags !== undefined) task.tags = patch.tags
    if (patch.note !== undefined) task.note = patch.note
    if (patch.status !== undefined) {
      task.status = patch.status
      task.doneDate = patch.status === 'done' ? (task.doneDate ?? today()) : null
      if (patch.status === 'done') task.note = null   // the date takes the trailing slot
    }

    await this.#write(doc)
    return task
  }

  async appendProgress(line: string): Promise<void> {
    const doc = await this.read()
    doc.progress.unshift({ raw: line.trim() })   // newest first, per the format rules
    await this.#write(doc)
  }

  async #write(doc: TasksDoc): Promise<void> {
    await writeFile(this.filePath, serializeTasks(doc), 'utf8')
  }
}
