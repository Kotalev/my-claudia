import type { ProjectRecord, SessionSummary } from '../../shared/types.js'

export interface SnapshotPayload {
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  tasks: Record<string, unknown>
}

export type ServerEvent =
  | ({ type: 'snapshot' } & SnapshotPayload)
  | { type: 'session.updated'; session: SessionSummary }
  | { type: 'task.updated'; projectId: string; doc: unknown }
  | { type: 'dispatch.output'; runId: string; chunk: string }
  | { type: 'dispatch.updated'; run: unknown }
  | { type: 'pong' }

type Send = (payload: string) => void

export class EventHub {
  #clients = new Set<Send>()
  #seq = 0

  constructor(private readonly snapshot: () => SnapshotPayload) {}

  addClient(send: Send): () => void {
    this.#clients.add(send)
    this.#emit(send, { type: 'snapshot', ...this.snapshot() })
    return () => { this.#clients.delete(send) }
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify({ seq: ++this.#seq, ...event })
    for (const send of [...this.#clients]) {
      try { send(payload) } catch { this.#clients.delete(send) }
    }
  }

  /** Clients ask for a fresh snapshot on a sequence gap; state is small, so no replay buffer. */
  handleClientMessage(raw: string, send: Send): void {
    let msg: { type?: string }
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.type === 'resnapshot') this.#emit(send, { type: 'snapshot', ...this.snapshot() })
    else if (msg.type === 'ping') this.#emit(send, { type: 'pong' })
  }

  #emit(send: Send, event: ServerEvent): void {
    try { send(JSON.stringify({ seq: ++this.#seq, ...event })) } catch { this.#clients.delete(send) }
  }
}
