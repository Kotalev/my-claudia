import { EventEmitter, once } from 'node:events'
import { basename, dirname } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { projectsDir } from '../../shared/config.js'
import { parseLines } from '../../transcript/parse.js'
import type { ProjectRegistry } from '../registry.js'
import { readNewLines, type TailState } from './tail.js'
import { initialTailState } from './backfill.js'
import type { SessionStore } from './session-store.js'

const DEBOUNCE_MS = 150

/**
 * A real projects tree holds hundreds of transcripts. chokidar reports them all
 * in one initial scan, so without a cap every one would be read and parsed at
 * once — hundreds of megabytes of buffers and a blocked event loop at boot.
 */
const MAX_CONCURRENT_DRAINS = 4

export class SessionWatcher extends EventEmitter {
  #watcher: FSWatcher | null = null
  #tails = new Map<string, TailState>()
  #timers = new Map<string, NodeJS.Timeout>()
  #queue: string[] = []
  #queued = new Set<string>()
  #running = 0

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly store: SessionStore,
  ) { super() }

  async start(): Promise<void> {
    // chokidar dropped glob support in v4, so watch the tree and filter files
    // ourselves. Directories must stay unignored or nothing below them is seen.
    this.#watcher = chokidar.watch(projectsDir(), {
      ignoreInitial: false,
      alwaysStat: true,
      ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('.jsonl'),
      // No awaitWriteFinish: Claude writes continuously and it would add latency.
      // Duplicate/spurious fsevents are free because readNewLines checks growth itself.
    })
    this.#watcher.on('add', p => this.#schedule(p))
    this.#watcher.on('change', p => this.#schedule(p))

    // chokidar's initial scan is async: without waiting for 'ready', a change
    // made right after start() can land before the watch is actually armed.
    await once(this.#watcher, 'ready')
  }

  async stop(): Promise<void> {
    for (const t of this.#timers.values()) clearTimeout(t)
    this.#timers.clear()
    this.#queue = []
    this.#queued.clear()
    await this.#watcher?.close()
    this.#watcher = null
  }

  #schedule(filePath: string): void {
    const existing = this.#timers.get(filePath)
    if (existing) clearTimeout(existing)
    this.#timers.set(filePath, setTimeout(() => {
      this.#timers.delete(filePath)
      this.#enqueue(filePath)
    }, DEBOUNCE_MS))
  }

  #enqueue(filePath: string): void {
    if (this.#queued.has(filePath)) return   // one pending drain per file is enough
    this.#queued.add(filePath)
    this.#queue.push(filePath)
    this.#pump()
  }

  #pump(): void {
    while (this.#running < MAX_CONCURRENT_DRAINS && this.#queue.length > 0) {
      const filePath = this.#queue.shift()!
      this.#queued.delete(filePath)
      this.#running++
      void this.#drain(filePath)
        .catch(() => { /* a single unreadable transcript must not stop the watcher */ })
        .finally(() => { this.#running--; this.#pump() })
    }
  }

  async #drain(filePath: string): Promise<void> {
    const state = this.#tails.get(filePath) ?? await initialTailState(filePath)
    const { lines, state: next } = await readNewLines(filePath, state)
    this.#tails.set(filePath, next)
    if (lines.length === 0) return

    const { entries, stats } = parseLines(lines)
    if (entries.length === 0 && stats.skippedUnknown === 0) return

    const sessionId = entries[0]?.sessionId ?? basename(filePath, '.jsonl')
    const project = this.registry.byEscapedDir(basename(dirname(filePath))) ?? null
    const summary = this.store.apply(sessionId, entries, stats, project)
    this.emit('session', summary)
  }
}
