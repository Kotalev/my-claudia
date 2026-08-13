import { readFile, writeFile } from 'node:fs/promises'
import type { InterruptedRun, RunHandle } from '../../shared/types.js'

/**
 * Mirrors live runs to a JSON file so a run survives the server as a record,
 * even though its process cannot. Written eagerly on every change — stopping
 * the dev server is a Ctrl+C straight to the process group, so no shutdown
 * hook can be relied upon to run.
 *
 * Two populations share the file: `leftovers` were loaded at startup (runs a
 * previous process abandoned — the ones offered for resume) and `live` mirrors
 * the current dispatcher. A clean run end deletes its mirror entry; whatever
 * is in the file when the process dies becomes the next process's leftovers.
 */
export class InterruptedRunStore {
  #leftovers: InterruptedRun[] = []
  #live = new Map<string, InterruptedRun>()
  /** Serialises writes: a later persist never overtakes an earlier one. */
  #writing: Promise<void> = Promise.resolve()

  constructor(private readonly storePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      const parsed = JSON.parse(raw) as { runs?: unknown }
      this.#leftovers = Array.isArray(parsed?.runs)
        ? parsed.runs.filter((r): r is InterruptedRun =>
            typeof r === 'object' && r !== null
            && typeof (r as InterruptedRun).runId === 'string'
            && typeof (r as InterruptedRun).projectId === 'string'
            && typeof (r as InterruptedRun).prompt === 'string')
        : []
    } catch {
      // Missing or corrupt store: start empty rather than block startup.
      this.#leftovers = []
    }
  }

  /** The previous process's abandoned runs — what the UI offers to resume. */
  list(): InterruptedRun[] { return [...this.#leftovers] }

  /** Mirror a live run of the current process. Upserts by runId. */
  record(run: RunHandle, prompt: string): void {
    this.#live.set(run.runId, {
      runId: run.runId,
      projectId: run.projectId,
      taskId: run.taskId,
      kind: run.kind ?? 'task',
      prompt,
      sessionId: run.sessionId,
      status: run.status,
      startedAt: run.startedAt,
      updatedAt: new Date().toISOString(),
    })
    this.#persist()
  }

  /** A run ended cleanly in this process — its mirror entry has served its purpose. */
  drop(runId: string): void {
    if (this.#live.delete(runId)) this.#persist()
  }

  /** Removes a leftover after it was resumed or dismissed. False when unknown. */
  removeLeftover(runId: string): boolean {
    const before = this.#leftovers.length
    this.#leftovers = this.#leftovers.filter(r => r.runId !== runId)
    if (this.#leftovers.length === before) return false
    this.#persist()
    return true
  }

  /** Settles once every write issued so far has hit the disk. Tests await this. */
  flush(): Promise<void> { return this.#writing }

  #persist(): void {
    const runs = [...this.#leftovers, ...this.#live.values()]
    this.#writing = this.#writing.then(() =>
      writeFile(this.storePath, JSON.stringify({ runs }, null, 2) + '\n', 'utf8'),
    ).catch(() => {
      // An unwritable mirror must never break dispatching itself.
    })
  }
}
