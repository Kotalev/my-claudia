import type { AccountInfo, ProjectRecord, SessionSummary, SpendSummary } from '../../shared/types.js'

export interface SnapshotPayload {
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  tasks: Record<string, unknown>
  planLimits: unknown
  spend: SpendSummary
  account: AccountInfo | null
}

export type ServerEvent =
  | ({ type: 'snapshot' } & SnapshotPayload)
  | { type: 'session.updated'; session: SessionSummary }
  | { type: 'task.updated'; projectId: string; doc: unknown }
  | { type: 'dispatch.output'; runId: string; chunk: string }
  | { type: 'dispatch.updated'; run: unknown }
  | { type: 'plan.updated'; planLimits: unknown }
  | { type: 'spend.updated'; spend: SpendSummary }
  | { type: 'projects.updated'; projects: ProjectRecord[] }
  | { type: 'pong' }

type Send = (payload: string) => void

export class EventHub {
  #clients = new Set<Send>()
  #seq = 0

  constructor(private readonly snapshot: () => SnapshotPayload) {}

  addClient(send: Send): () => void {
    this.#clients.add(send)
    this.#unicast(send, { type: 'snapshot', ...this.snapshot() })
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
    if (msg.type === 'resnapshot') this.#unicast(send, { type: 'snapshot', ...this.snapshot() })
    else if (msg.type === 'ping') this.#unicast(send, { type: 'pong' })
  }

  /**
   * Sends to one client WITHOUT advancing the broadcast counter. Incrementing it
   * here would burn a sequence number the other clients never see, so every one
   * of them would detect a permanent gap and resnapshot on the next broadcast.
   */
  #unicast(send: Send, event: ServerEvent): void {
    try { send(JSON.stringify({ seq: this.#seq, ...event })) } catch { this.#clients.delete(send) }
  }
}
