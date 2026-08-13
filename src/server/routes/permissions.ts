import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PermissionRequestInfo } from '../../shared/types.js'

/**
 * How long the sink holds a hook's reply open waiting for a dashboard click.
 * The forwarder curls with --max-time 25 and the hook entry itself times out
 * at 30, so 22s leaves room to answer `{}` while both are still listening —
 * an empty reply means "no opinion" and the terminal prompt appears as usual.
 */
const HOLD_MS = 22_000

export type PermissionBehavior = 'allow' | 'deny'

/**
 * One line a person can act on, never the raw payload: a tool_input can carry
 * a whole file body, and dumping it into a card (or a broadcast) helps nobody.
 */
export function summarizeToolInput(toolName: unknown, toolInput: unknown): string {
  const input = typeof toolInput === 'object' && toolInput !== null && !Array.isArray(toolInput)
    ? toolInput as Record<string, unknown>
    : null
  const pick = (key: string): string | null => {
    const value = input?.[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  let summary = toolName === 'Bash'
    ? pick('command')
    : pick('file_path') ?? pick('path') ?? pick('url') ?? pick('command')
  if (summary === null && input !== null) {
    try { summary = JSON.stringify(input) } catch { summary = null }
  }
  const oneLine = (summary ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.length > 120 ? oneLine.slice(0, 119) + '…' : oneLine
}

interface Held {
  info: PermissionRequestInfo
  resolve: (payload: unknown) => void
  timer: NodeJS.Timeout
}

/**
 * The pending prompts, each pinned to a hook reply the sink is holding open.
 * A decision resolves that reply with the documented hookSpecificOutput shape;
 * the hold window lapsing resolves it with `{}` and quietly forgets the id, so
 * a decision arriving after that is a 404, never a stale answer.
 */
export class PermissionBroker {
  #held = new Map<string, Held>()
  onRequested: (request: PermissionRequestInfo) => void = () => {}
  onResolved: (id: string, behavior: PermissionBehavior) => void = () => {}

  constructor(private readonly holdMs = HOLD_MS) {}

  /** For the snapshot: what a freshly opened tab must still be asked about. */
  list(): PermissionRequestInfo[] {
    return [...this.#held.values()].map(h => h.info)
  }

  hold(info: PermissionRequestInfo): Promise<unknown> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.#held.delete(info.id)
        resolve({})
      }, this.holdMs)
      timer.unref()
      this.#held.set(info.id, { info, resolve, timer })
      this.onRequested(info)
    })
  }

  decide(id: string, behavior: PermissionBehavior): boolean {
    const held = this.#held.get(id)
    if (!held) return false
    this.#held.delete(id)
    clearTimeout(held.timer)
    held.resolve({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior } },
    })
    this.onResolved(id, behavior)
    return true
  }
}

export function registerPermissionRoutes(app: FastifyInstance, broker: PermissionBroker): void {
  // The sink is a hook sink: 200 always, even to garbage. It gets its own
  // plugin scope so a body that is not JSON at all parses to null instead of
  // tripping Fastify's 400 — an error here would reach the user's session.
  void app.register(async scope => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, JSON.parse(body as string)) } catch { done(null, null) }
    })

    scope.post('/api/hooks/permission', async req => {
      const obj = typeof req.body === 'object' && req.body !== null
        ? req.body as Record<string, unknown>
        : null
      const sessionId = typeof obj?.session_id === 'string' ? obj.session_id : null
      const toolName = typeof obj?.tool_name === 'string' ? obj.tool_name : null
      // Unusable: answer "no opinion" immediately rather than hold anything.
      if (obj === null || sessionId === null || toolName === null) return {}

      const info: PermissionRequestInfo = {
        id: randomUUID(),
        sessionId,
        toolName,
        toolInputSummary: summarizeToolInput(toolName, obj.tool_input),
        cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
        createdAt: new Date().toISOString(),
      }
      // Held: this reply does not go out until a decision lands or the window closes.
      return broker.hold(info)
    })
  })

  app.post<{ Params: { id: string } }>('/api/permissions/:id/decision', async (req, reply) => {
    const behavior = (req.body as Record<string, unknown> | null)?.behavior
    if (behavior !== 'allow' && behavior !== 'deny') {
      return reply.code(400).send({ error: "behavior must be 'allow' or 'deny'" })
    }
    if (!broker.decide(req.params.id, behavior)) {
      return reply.code(404).send({ error: 'unknown or expired permission request' })
    }
    return { ok: true }
  })
}
