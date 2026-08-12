import { EventEmitter, once } from 'node:events'
import { join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { TaskStore } from '../../tasks/store.js'
import type { TasksDoc } from '../../tasks/types.js'
import type { ProjectRegistry } from '../registry.js'

const DEBOUNCE_MS = 200

export interface TasksChange { projectId: string; doc: TasksDoc }

export class TasksWatcher extends EventEmitter {
  #watcher: FSWatcher | null = null
  #timers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly registry: ProjectRegistry) { super() }

  async start(): Promise<void> {
    const dirs = this.registry.list().map(p => p.path)
    if (dirs.length === 0) return

    // Watch the project directories rather than the TASKS.md paths themselves:
    // a file that does not exist yet cannot be watched reliably on macOS, and a
    // project is allowed to have no backlog until someone creates one.
    this.#watcher = chokidar.watch(dirs, {
      ignoreInitial: true,
      alwaysStat: true,
      depth: 0,
      ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('/TASKS.md'),
    })
    this.#watcher.on('add', p => this.#schedule(p))
    this.#watcher.on('change', p => this.#schedule(p))

    // chokidar's initial scan is async: without waiting for 'ready', a change
    // made right after start() can land before the watch is actually armed.
    await once(this.#watcher, 'ready')
  }

  /** The registry changes at runtime, so the watch set is rebuilt rather than patched. */
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async stop(): Promise<void> {
    for (const t of this.#timers.values()) clearTimeout(t)
    this.#timers.clear()
    await this.#watcher?.close()
    this.#watcher = null
  }

  #schedule(filePath: string): void {
    const existing = this.#timers.get(filePath)
    if (existing) clearTimeout(existing)
    this.#timers.set(filePath, setTimeout(() => {
      this.#timers.delete(filePath)
      void this.#emitDoc(filePath)
    }, DEBOUNCE_MS))
  }

  async #emitDoc(filePath: string): Promise<void> {
    const project = this.registry.list().find(p => join(p.path, 'TASKS.md') === filePath)
    if (!project) return
    const doc = await new TaskStore(project.path).read()
    this.emit('tasks', { projectId: project.id, doc } satisfies TasksChange)
  }
}
