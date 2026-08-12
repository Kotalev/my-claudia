import { EventEmitter, once } from 'node:events'
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import chokidar, { type FSWatcher } from 'chokidar'
import { sessionsDir } from '../../shared/config.js'
import type { LiveProcess, LiveState } from '../../shared/types.js'

const execFileAsync = promisify(execFile)

/**
 * Only `<pid>.json`. The same directory holds `<pid>.<hash>.key` files, mode 600 —
 * those are secrets and must never be read, let alone forwarded to a browser.
 */
const SESSION_FILE_RE = /^(\d+)\.json$/

/**
 * A process must have started within this window of the session's own `startedAt`
 * for us to believe the pid still belongs to that session. Stale registry files
 * outlive their process (verified: one survived a SIGKILL indefinitely), so
 * without this a recycled pid would resurrect a dead session.
 */
const PID_REUSE_TOLERANCE_MS = 120_000

const DEBOUNCE_MS = 200

/**
 * Safety net. chokidar cannot watch a directory that does not exist yet, and on a
 * fresh config dir it never will — so without this the Live band would report
 * "nothing running" forever, however many sessions started.
 */
const RESCAN_MS = 15_000

export function isSessionFile(name: string): boolean {
  return SESSION_FILE_RE.test(name)
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function stateOf(status: unknown): LiveState {
  // Claude Code's own enum is busy | shell | idle | waiting (read out of the 2.1.228
  // binary). `shell` is a foreground shell command, which is the session working,
  // not blocked on anyone. `sdk-cli` entries carry no status at all, and an unknown
  // value must not invent activity — anything we do not recognise reads as idle.
  if (status === 'busy' || status === 'waiting') return status
  if (status === 'shell') return 'busy'
  return 'idle'
}

/**
 * Epoch milliseconds, as ISO. Accepts a string too: nothing in the current
 * release writes one, but this directory belongs to another program and a
 * format change here must not take the field's neighbours down with it.
 */
function asTimestamp(v: unknown): string | null {
  let at: number
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) at = v
  else if (typeof v === 'string') at = Date.parse(v)
  else return null
  // Date's range is +-8.64e15 ms; anything beyond makes toISOString throw, and a
  // throw here would take down refresh() and with it the whole registry. A
  // timestamp in nanoseconds is the plausible way to get there.
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Parses one registry file. Returns null for anything unusable rather than
 * throwing: this directory is written by another program, concurrently, and a
 * half-written file is normal rather than exceptional.
 */
export function parseSessionFile(raw: string): LiveProcess | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null
  const o = obj as Record<string, unknown>

  const sessionId = asString(o.sessionId)
  const pid = typeof o.pid === 'number' && Number.isInteger(o.pid) && o.pid > 0 ? o.pid : null
  if (sessionId === null || pid === null) return null

  // Null rather than the epoch: an unusable startedAt means we cannot run the
  // pid-reuse check, not that the process started in 1970 and must be dead.
  const startedAt = asTimestamp(o.startedAt)

  return {
    sessionId,
    pid,
    cwd: asString(o.cwd),
    name: asString(o.name),
    kind: 'interactive',
    entrypoint: asString(o.entrypoint),
    version: asString(o.version),
    startedAt,
    state: stateOf(o.status),
    waitingFor: asString(o.waitingFor),
    // No fallback to `updatedAt`: that one is rewritten on every touch, so it
    // would make an hour-old prompt look like it had just appeared. Missing means
    // unknown, and unknown must not be reported as fresh.
    statusUpdatedAt: asTimestamp(o.statusUpdatedAt),
  }
}

/**
 * Start times for the given pids, in epoch ms. `ps` prints `lstart` in local
 * time; the registry's own `procStart` string is UTC in the same format, so
 * comparing the two as text silently succeeds only for a UTC machine. We never
 * read `procStart` — `ps` is the stable signal.
 */
export async function processStartTimes(pids: number[]): Promise<Map<number, number>> {
  const found = new Map<number, number>()
  if (pids.length === 0) return found
  let stdout: string
  try {
    // LC_ALL=C: `ps` prints lstart in the current locale, and Date.parse returns
    // NaN for a French or German month name — which would silently disable the
    // pid-reuse guard rather than fail loudly.
    ;({ stdout } = await execFileAsync('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], {
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    }))
  } catch {
    return found   // no ps, or every pid gone: caller falls back to kill(pid, 0)
  }
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (!m?.[1] || !m[2]) continue
    const at = Date.parse(m[2])
    if (Number.isFinite(at)) found.set(Number(m[1]), at)
  }
  return found
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false   // ESRCH; EPERM would also land here, and a process we cannot
                   // signal is not one of ours anyway
  }
}

export function isLive(proc: LiveProcess, starts: Map<number, number>): boolean {
  if (proc.pid === null) return true          // background agents are vouched for by the CLI
  if (!pidAlive(proc.pid)) return false
  const started = starts.get(proc.pid)
  if (started === undefined) return true      // ps told us nothing; kill() said alive
  if (proc.startedAt === null) return true    // no session start time to compare against
  return Math.abs(started - Date.parse(proc.startedAt)) <= PID_REUSE_TOLERANCE_MS
}

/**
 * Watches Claude Code's own live-session registry. This is the primary liveness
 * signal: it knows a session is `waiting` on the user, which neither transcript
 * growth nor hook events can tell us.
 */
export class SessionsRegistry extends EventEmitter {
  #watcher: FSWatcher | null = null
  #timer: NodeJS.Timeout | null = null
  #rescan: NodeJS.Timeout | null = null
  #live: LiveProcess[] = []

  constructor(private readonly dir: string = sessionsDir()) { super() }

  list(): LiveProcess[] {
    return this.#live
  }

  async start(): Promise<void> {
    await this.refresh()
    // depth 0: the directory itself only. Watching files individually would miss
    // the ones created after start, and the key files must never be opened.
    // A missing directory is normal on a fresh config dir; the rescan below is
    // what makes the registry appear when Claude Code first creates it.
    this.#watcher = chokidar.watch(this.dir, { depth: 0, ignoreInitial: true })
    const poke = (): void => this.#schedule()
    this.#watcher.on('add', poke)
    this.#watcher.on('change', poke)
    this.#watcher.on('unlink', poke)
    await once(this.#watcher, 'ready')

    this.#rescan = setInterval(() => { void this.refresh() }, RESCAN_MS)
    this.#rescan.unref()
  }

  async stop(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    if (this.#rescan) clearInterval(this.#rescan)
    this.#rescan = null
    await this.#watcher?.close()
    this.#watcher = null
  }

  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.refresh()
    }, DEBOUNCE_MS)
  }

  /** Re-reads the directory and emits `change` with the current live set. */
  async refresh(): Promise<LiveProcess[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch (err) {
      // A directory that does not exist yet genuinely means nothing is running.
      // Anything else — a permissions change, the path replaced by a file — means
      // we cannot see, which is not the same as seeing nothing. Reporting an empty
      // set there would take every live session through `done` and back again on
      // recovery, a transition the UI treats as real.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return this.#live
      names = []
    }
    const parsed: LiveProcess[] = []
    for (const name of names) {
      if (!isSessionFile(name)) continue
      const raw = await readFile(join(this.dir, name), 'utf8').catch(() => null)
      if (raw === null) continue
      const proc = parseSessionFile(raw)
      if (proc) parsed.push(proc)
    }
    const starts = await processStartTimes(parsed.map(p => p.pid).filter((p): p is number => p !== null))
    const live = parsed.filter(p => isLive(p, starts))
    const changed = JSON.stringify(live) !== JSON.stringify(this.#live)
    this.#live = live
    // The rescan runs every 15s; emitting unchanged state would make the store
    // recompute and rebroadcast every session for nothing.
    if (changed) this.emit('change', this.#live)
    return this.#live
  }
}
