import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { DispatchInput, QueuedDispatch, RunHandle } from '../../shared/types.js'
import type { Dispatcher } from './index.js'

/**
 * Sits in front of the Dispatcher so a dispatch that would hit the in-place
 * 1-per-project guard waits its turn instead of erroring. When any run for a
 * project ends, the oldest queued item for that project starts.
 *
 * In-memory only: a queue of unstarted work does not need to survive a
 * restart. Worktree-isolated inputs never queue — they never block.
 *
 * Events: `changed` with the full list after every mutation, ready to
 * broadcast; `started` with `{ queued, run }` when a queued item finally runs.
 */
export class DispatchQueue extends EventEmitter {
  #items: QueuedDispatch[] = []
  #dispatcher: Dispatcher

  constructor(dispatcher: Dispatcher) {
    super()
    this.#dispatcher = dispatcher
    // markResolved also fires 'update' on ended runs; draining again is a
    // harmless no-op when nothing is queued or the project is still held.
    dispatcher.on('update', (run: RunHandle) => {
      if (run.endedAt !== null) void this.#drain(run.projectId)
    })
  }

  /**
   * Starts the input now when the project is free, otherwise queues it.
   * Validation errors (a resume without a session id, a worktree that cannot
   * be created) still throw — the queue only absorbs the busy-project case.
   */
  async start(input: DispatchInput): Promise<{ run: RunHandle } | { queued: QueuedDispatch }> {
    if (this.#dispatcher.wouldBlock(input)) {
      const queued: QueuedDispatch = {
        queueId: randomUUID(),
        projectId: input.projectId,
        input,
        queuedAt: new Date().toISOString(),
      }
      this.#items.push(queued)
      this.emit('changed', this.list())
      return { queued }
    }
    const run = await this.#dispatcher.start(input)
    return { run }
  }

  /** Pending items, oldest first — the order they will start in. */
  list(): QueuedDispatch[] {
    return [...this.#items]
  }

  cancel(queueId: string): boolean {
    const idx = this.#items.findIndex(i => i.queueId === queueId)
    if (idx === -1) return false
    this.#items.splice(idx, 1)
    this.emit('changed', this.list())
    return true
  }

  async #drain(projectId: string): Promise<void> {
    const next = this.#items.find(i => i.projectId === projectId)
    if (!next) return
    // Another live run may still hold the project (the ended run was not the
    // last one). Leave the item queued; that run's end will drain it.
    if (this.#dispatcher.wouldBlock(next.input)) return
    // Removed before start so a second 'update' arriving mid-start cannot
    // launch the same item twice.
    this.#items = this.#items.filter(i => i.queueId !== next.queueId)
    try {
      const run = await this.#dispatcher.start(next.input)
      this.emit('started', { queued: next, run })
    } catch (err) {
      // A queued item that cannot start (its session vanished, spawn failed)
      // is dropped rather than retried forever.
      console.warn(`queued dispatch ${next.queueId} failed to start: ${(err as Error).message}`)
    }
    this.emit('changed', this.list())
  }
}
