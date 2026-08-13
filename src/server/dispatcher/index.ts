export type { DispatchInput, RunHandle, RunStatus } from '../../shared/types.js'
import type { DispatchInput, RateLimitInfo, RunHandle, RunStatus } from '../../shared/types.js'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { renderStreamLine } from './stream.js'
import { createWorktree, isGitRepo } from './worktree.js'


interface Run extends RunHandle {
  /** The exact input that started the run, kept so a retry can replay it. Never on the public handle. */
  input: DispatchInput
  child: ChildProcess
  timer: NodeJS.Timeout
  buffer: string
  /** User messages written to stdin that have not yet been answered by a `result` event. */
  turnsInFlight: number
  /** stdin was ended (finishInput); no more steering is possible. */
  stdinEnded: boolean
  /** Fires while 'awaiting-input' so an unattended run cannot idle forever. */
  idleTimer: NodeJS.Timeout | null
}

export interface DispatcherOptions {
  claudeBin?: string
  /** Injected before the real flags; the test harness uses it to run a fake binary. */
  extraArgs?: string[]
  timeoutMs?: number
  /** How long a run may sit in 'awaiting-input' before its stdin is closed for it. */
  idleMs?: number
  /** Where linked worktrees live — outside every project tree. */
  worktreesRoot?: string
  /** Silence on stdout+stderr while 'running' before the stalled flag is raised. */
  stallAfterMs?: number
  /** Total lifetime before the longRunning flag is raised. Advisory — the hard timeout still kills. */
  warnAfterMs?: number
  /** How often the watchdog sweeps live runs. Tests shrink it; nothing else should. */
  watchdogIntervalMs?: number
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_IDLE_MS = 10 * 60 * 1000
const DEFAULT_STALL_MS = 5 * 60 * 1000
const DEFAULT_WARN_MS = 30 * 60 * 1000
const DEFAULT_WATCHDOG_INTERVAL_MS = 30_000

export class Dispatcher extends EventEmitter {
  #runs = new Map<string, Run>()
  #bin: string
  #extraArgs: string[]
  #timeoutMs: number
  #idleMs: number
  #worktreesRoot: string
  #stallAfterMs: number
  #warnAfterMs: number
  #watchdog: NodeJS.Timeout

  constructor(opts: DispatcherOptions = {}) {
    super()
    this.#bin = opts.claudeBin ?? 'claude'
    this.#extraArgs = opts.extraArgs ?? []
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    this.#worktreesRoot = opts.worktreesRoot ?? join(process.cwd(), '.worktrees')
    this.#stallAfterMs = opts.stallAfterMs ?? DEFAULT_STALL_MS
    this.#warnAfterMs = opts.warnAfterMs ?? DEFAULT_WARN_MS
    // One interval for every run, unref'd so an idle dispatcher never holds
    // the process open. Per-run timers would be cancelled/re-armed on every
    // output chunk; a sweep just reads timestamps.
    this.#watchdog = setInterval(() => this.#sweep(), opts.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS)
    this.#watchdog.unref()
  }

  list(): RunHandle[] {
    return [...this.#runs.values()].map(run => this.#handle(run))
  }

  get(runId: string): RunHandle | undefined {
    const run = this.#runs.get(runId)
    return run ? this.#handle(run) : undefined
  }

  /**
   * True when `start` would refuse this input right now because an in-place
   * run already holds its project. Worktree-isolated inputs never block. The
   * DispatchQueue asks this instead of catching the throw, so validation
   * errors (a resume without a session id) still surface as errors.
   */
  wouldBlock(input: DispatchInput): boolean {
    const kind = input.kind ?? 'task'
    if (kind !== 'resume' && isGitRepo(input.projectPath)) return false
    return [...this.#runs.values()].some(r => r.projectId === input.projectId && r.endedAt === null)
  }

  /** The exact input that started a run, for a retry. A copy — the caller may edit its prompt. */
  originalInput(runId: string): DispatchInput | undefined {
    const run = this.#runs.get(runId)
    return run ? { ...run.input } : undefined
  }

  async start(input: DispatchInput): Promise<RunHandle> {
    const kind = input.kind ?? 'task'
    if (kind === 'resume' && !input.resumeSessionId) {
      throw new Error('a resume run needs a resumeSessionId')
    }
    // A resumed session's history references paths inside the real project
    // tree, so resume runs always run in place — never in a worktree.
    const worktreeIsolated = kind !== 'resume' && isGitRepo(input.projectPath)
    if (!worktreeIsolated && this.wouldBlock(input)) {
      // In-place runs share the project directory, so they keep the old
      // 1-per-project guard. Worktree runs each get their own tree instead.
      throw new Error(`a run is already running for project ${input.projectId}`)
    }

    const runId = randomUUID()
    let branch: string | null = null
    let worktreeDir: string | null = null
    let baseCommit: string | null = null
    if (worktreeIsolated) {
      const wt = await createWorktree(input.projectPath, this.#worktreesRoot, runId)
      branch = wt.branch
      worktreeDir = wt.dir
      baseCommit = wt.base
    }

    // The prompt travels over stdin as a stream-json user message, never through
    // a shell string. No --bare: the target project's CLAUDE.md and hooks must load.
    // Verified 2026-08-13: `--resume` combines with `--input-format stream-json`
    // and continues the SAME session id with full first-turn context.
    const args = [...this.#extraArgs, '-p']
    if (kind === 'resume') args.push('--resume', input.resumeSessionId!)
    args.push('--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose')
    const child = spawn(this.#bin, args, {
      cwd: worktreeDir ?? input.projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
    // A run that dies mid-write must not crash the server with an EPIPE.
    child.stdin?.on('error', () => {})

    const run: Run = {
      runId,
      projectId: input.projectId,
      taskId: input.taskId,
      kind,
      // A resume run's session id is known before the child says a word; the
      // init event will only ever confirm it (verified: --resume keeps the id).
      sessionId: kind === 'resume' ? input.resumeSessionId! : null,
      costUsd: null, numTurns: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      isolation: worktreeIsolated ? 'worktree' : 'in-place',
      branch,
      worktreeDir,
      baseCommit,
      diffAvailable: worktreeIsolated,
      merged: false,
      discarded: false,
      lastRateLimit: null,
      loopId: input.loopId ?? null,
      lastOutputAt: new Date().toISOString(),
      stalled: false,
      longRunning: false,
      input: { ...input },
      child,
      buffer: '',
      turnsInFlight: 0,
      stdinEnded: false,
      idleTimer: null,
      timer: setTimeout(() => this.cancel(runId), this.#timeoutMs),
    }
    this.#runs.set(runId, run)
    this.#writeUserMessage(run, input.prompt)

    // Consume stdout eagerly: a slow consumer stalls claude's own output.
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.#consume(run, chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.#recordOutput(run)
      this.emit('output', { runId, chunk })
    })

    child.on('error', () => this.#finish(run, null, 'failed'))
    child.on('close', code => {
      if (run.status === 'cancelled') this.#finish(run, code, 'cancelled')
      else this.#finish(run, code, code === 0 ? 'succeeded' : 'failed')
    })

    this.#update(run)
    return this.#handle(run)
  }

  /**
   * Sends a follow-up user message into a live run's stdin, starting a new turn
   * in the same session. False once the run has ended or its input was closed.
   */
  steer(runId: string, text: string): boolean {
    const run = this.#runs.get(runId)
    if (!run || run.endedAt !== null || run.stdinEnded) return false
    this.#writeUserMessage(run, text)
    // The steered message is part of the run's story: show it in the feed.
    this.emit('output', { runId, chunk: `> you: ${text}\n` })
    if (run.status === 'awaiting-input') run.status = 'running'
    this.#clearIdle(run)
    // A steered run earned a fresh supervisor window.
    clearTimeout(run.timer)
    run.timer = setTimeout(() => this.cancel(runId), this.#timeoutMs)
    this.#update(run)
    return true
  }

  /** Ends the run's stdin so `claude` finishes up and exits on its own. */
  finishInput(runId: string): boolean {
    const run = this.#runs.get(runId)
    if (!run || run.endedAt !== null || run.stdinEnded) return false
    run.stdinEnded = true
    this.#clearIdle(run)
    run.child.stdin?.end()
    return true
  }

  cancel(runId: string): boolean {
    const run = this.#runs.get(runId)
    if (!run || run.endedAt !== null) return false
    run.status = 'cancelled'
    // SIGTERM aborts the turn cleanly, kills the child's process tree and runs
    // SessionEnd hooks, rather than orphaning a half-finished session.
    run.child.kill('SIGTERM')
    return true
  }

  /**
   * Records the outcome of a worktree run once the worktree itself is gone.
   * The git work happens in the routes; this only mutates the handle so every
   * client sees the run flip to merged/discarded over the socket.
   */
  markResolved(runId: string, outcome: 'merged' | 'discarded'): boolean {
    const run = this.#runs.get(runId)
    if (!run) return false
    run[outcome] = true
    run.diffAvailable = false
    run.worktreeDir = null
    this.#update(run)
    return true
  }

  /**
   * Splits stdout into whole lines, then emits a readable rendering of each and
   * watches for the session id. The init event carries it but is NOT guaranteed
   * to be the first line, so every line is checked until one is found.
   */
  #consume(run: Run, chunk: string): void {
    this.#recordOutput(run)
    run.buffer += chunk
    const lines = run.buffer.split('\n')
    run.buffer = lines.pop() ?? ''

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as {
          type?: string; subtype?: string; session_id?: string
          total_cost_usd?: unknown; num_turns?: unknown; rate_limit_info?: unknown
        }
        // The stream reports the account's rate-limit standing as it changes.
        // Only the latest one matters: it is what decides, at failure time,
        // whether the run died rate-limited and when to auto-continue.
        if (msg.type === 'rate_limit_event') {
          const info = parseRateLimitInfo(msg.rate_limit_info)
          if (info !== null) run.lastRateLimit = info
        }
        if (run.sessionId === null && msg.subtype === 'init' && msg.session_id) {
          run.sessionId = msg.session_id
          this.#update(run)
        }
        // The final event carries the run's own cost and turn count. Rendering
        // them into a text line lost them; the run panel wants the numbers.
        if (msg.type === 'result') {
          if (typeof msg.total_cost_usd === 'number' && Number.isFinite(msg.total_cost_usd)) {
            run.costUsd = msg.total_cost_usd
          }
          if (typeof msg.num_turns === 'number' && Number.isFinite(msg.num_turns)) {
            run.numTurns = msg.num_turns
          }
          // The turn is answered; with nothing else queued the process now sits
          // waiting on stdin. Surface that instead of pretending it still works,
          // and cap the wait so no zombie `claude` outlives an absent user.
          run.turnsInFlight = Math.max(0, run.turnsInFlight - 1)
          if (run.turnsInFlight === 0 && !run.stdinEnded && run.endedAt === null && run.status === 'running') {
            run.status = 'awaiting-input'
            run.idleTimer = setTimeout(() => this.finishInput(run.runId), this.#idleMs)
          }
          this.#update(run)
        }
      } catch { /* partial or non-JSON output is expected; keep scanning */ }
      const rendered = renderStreamLine(line)
      if (rendered !== null) this.emit('output', { runId: run.runId, chunk: `${rendered}\n` })
    }
  }

  /** One stream-json user message, one stdin line. Text goes through JSON.stringify only. */
  #writeUserMessage(run: Run, text: string): void {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
    run.child.stdin?.write(`${line}\n`)
    run.turnsInFlight += 1
  }

  /** Any child stdout/stderr proves the run is alive: refresh the clock and withdraw a stalled flag. */
  #recordOutput(run: Run): void {
    run.lastOutputAt = new Date().toISOString()
    if (run.stalled) {
      run.stalled = false
      this.#update(run)
    }
  }

  /**
   * The watchdog pass. Advisory only — neither flag touches the child; the
   * hard timeout in `start` keeps the killing job. 'awaiting-input' runs are
   * never stalled: they are waiting for us, not the other way round.
   */
  #sweep(): void {
    const now = Date.now()
    for (const run of this.#runs.values()) {
      if (run.endedAt !== null) continue
      let changed = false
      const quietSince = Date.parse(run.lastOutputAt ?? run.startedAt)
      if (run.status === 'running' && !run.stalled && now - quietSince >= this.#stallAfterMs) {
        run.stalled = true
        changed = true
      }
      if (!run.longRunning && now - Date.parse(run.startedAt) >= this.#warnAfterMs) {
        run.longRunning = true   // one-way: a run does not stop having run long
        changed = true
      }
      if (changed) this.#update(run)
    }
  }

  #clearIdle(run: Run): void {
    if (run.idleTimer !== null) { clearTimeout(run.idleTimer); run.idleTimer = null }
  }

  #finish(run: Run, code: number | null, status: RunStatus): void {
    if (run.endedAt !== null) return
    clearTimeout(run.timer)
    this.#clearIdle(run)
    run.endedAt = new Date().toISOString()
    run.exitCode = code
    run.status = status
    this.#update(run)
    // A failed run whose last rate-limit standing was anything but 'allowed'
    // (open set: 'rejected', 'queued', whatever future values appear) died
    // rate-limited; the server can re-arm it once the window resets.
    if (status === 'failed' && run.lastRateLimit != null && run.lastRateLimit.status !== 'allowed') {
      this.emit('rate-limited', this.#handle(run))
    }
  }

  #handle(run: Run): RunHandle {
    const {
      input: _input, child: _child, timer: _timer, buffer: _buffer,
      turnsInFlight: _turns, stdinEnded: _stdinEnded, idleTimer: _idleTimer,
      ...handle
    } = run
    return handle
  }

  #update(run: Run): void {
    this.emit('update', this.#handle(run))
  }
}

/**
 * Tolerant read of a `rate_limit_event`'s payload. Anything without a string
 * `status` is not usable — null, so the previous good value survives garbage.
 */
function parseRateLimitInfo(raw: unknown): RateLimitInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const info = raw as { status?: unknown; resetsAt?: unknown; rateLimitType?: unknown }
  if (typeof info.status !== 'string') return null
  return {
    status: info.status,
    resetsAt: typeof info.resetsAt === 'number' && Number.isFinite(info.resetsAt) ? info.resetsAt : null,
    rateLimitType: typeof info.rateLimitType === 'string' ? info.rateLimitType : null,
  }
}
