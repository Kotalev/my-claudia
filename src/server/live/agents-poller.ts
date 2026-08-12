import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LiveProcess, LiveState } from '../../shared/types.js'

const execFileAsync = promisify(execFile)

const POLL_MS = 30_000

/** The CLI is another program on the user's machine; it must never hang the dashboard. */
const CALL_TIMEOUT_MS = 5_000

/**
 * How many consecutive failures before we stop claiming to know what is running.
 * Keeping the last good answer smooths over one hiccup; keeping it forever pins
 * finished agents in the Live band with an animated dot and a growing elapsed
 * time, which is a lie the user cannot see through.
 */
const MAX_STALE_POLLS = 3

/**
 * Background agents are reported by the CLI until someone dismisses them, so a
 * run that was blocked on the user months ago is still listed. Nobody is going
 * to answer it: it is not a live process, it is litter, and showing it with an
 * animated dot next to sessions that really are running devalues the whole band.
 *
 * Seven days, matching the backfill window the watcher already uses for deciding
 * a transcript is too old to be worth reading.
 */
export const MAX_AGENT_AGE_MS = 7 * 24 * 60 * 60 * 1000

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function stateOf(o: Record<string, unknown>): LiveState {
  if (o.status === 'busy' || o.status === 'waiting') return o.status
  if (o.state === 'blocked') return 'blocked'
  if (o.state === 'running') return 'busy'
  return 'idle'
}

/**
 * Parses `claude agents --json`. Anything unusable is skipped rather than
 * failing the whole poll — one malformed entry must not hide the others.
 */
/**
 * Whether this entry is recent enough to call live. Only background agents are
 * aged out: an interactive process is proved alive by its pid, so a genuinely
 * long-running one stays however old it is.
 */
export function isFresh(proc: LiveProcess, now = Date.now()): boolean {
  if (proc.kind !== 'background') return true
  if (proc.startedAt === null) return true   // no age to judge; do not guess
  const age = now - Date.parse(proc.startedAt)
  return !Number.isFinite(age) || age <= MAX_AGENT_AGE_MS
}

export function parseAgentsJson(raw: string, now = Date.now()): LiveProcess[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: LiveProcess[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const sessionId = asString(o.sessionId)
    if (sessionId === null) continue
    const pid = typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 0 ? o.pid : null
    const proc: LiveProcess = {
      sessionId,
      pid,
      cwd: asString(o.cwd),
      name: asString(o.name),
      kind: o.kind === 'background' ? 'background' : 'interactive',
      entrypoint: null,
      version: null,
      startedAt: typeof o.startedAt === 'number' && Number.isFinite(o.startedAt)
        ? new Date(o.startedAt).toISOString()
        : null,
      state: stateOf(o),
      waitingFor: asString(o.waitingFor),
    }
    if (isFresh(proc, now)) out.push(proc)
  }
  return out
}

/**
 * Polls `claude agents --json`. This is the only source for background agents:
 * they have no pid and no file in the sessions registry, so a dashboard built on
 * the registry alone shows nothing of them at all.
 *
 * Everything here is fail-silent by design. A missing binary, a non-zero exit or
 * a future output format must leave the dashboard exactly as it was.
 */
export class AgentsPoller extends EventEmitter {
  #timer: NodeJS.Timeout | null = null
  #agents: LiveProcess[] = []
  #failures = 0
  #stopped = false

  constructor(private readonly bin: string = 'claude') { super() }

  list(): LiveProcess[] {
    return this.#agents
  }

  /** Whether the repeating poll is armed. Exists so a test can prove it is not. */
  pollingStarted(): boolean {
    return this.#timer !== null
  }

  async start(): Promise<void> {
    await this.poll()
    // stop() may have been called while that first poll was in flight; setting
    // the interval anyway would leave it running for the life of the process.
    if (this.#stopped) return
    this.#timer = setInterval(() => { void this.poll() }, POLL_MS)
    this.#timer.unref()   // a poll must never be the reason the process stays up
  }

  stop(): void {
    this.#stopped = true
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  async poll(): Promise<LiveProcess[]> {
    let stdout: string
    try {
      ;({ stdout } = await execFileAsync(this.bin, ['agents', '--json'], {
        timeout: CALL_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        shell: false,
      }))
    } catch {
      this.#failures++
      if (this.#failures < MAX_STALE_POLLS) return this.#agents   // ride out one hiccup
      if (this.#agents.length > 0) {
        this.#agents = []
        this.emit('change', this.#agents)
      }
      return this.#agents
    }
    this.#failures = 0
    this.#agents = parseAgentsJson(stdout)
    this.emit('change', this.#agents)
    return this.#agents
  }
}

/**
 * Merges the two live sources. The sessions registry wins for any session both
 * describe: it carries `version` and `entrypoint`, and its liveness was checked
 * against the real process rather than taken on the CLI's word.
 */
export function mergeLive(registry: LiveProcess[], agents: LiveProcess[]): LiveProcess[] {
  const byId = new Map<string, LiveProcess>()
  for (const a of agents) byId.set(a.sessionId, a)
  for (const r of registry) byId.set(r.sessionId, r)
  return [...byId.values()]
}
