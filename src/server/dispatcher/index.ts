export type { RunHandle, RunStatus } from '../../shared/types.js'
import type { RunHandle, RunStatus } from '../../shared/types.js'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { renderStreamLine } from './stream.js'


interface Run extends RunHandle {
  child: ChildProcess
  timer: NodeJS.Timeout
  buffer: string
}

export interface DispatcherOptions {
  claudeBin?: string
  /** Injected before the real flags; the test harness uses it to run a fake binary. */
  extraArgs?: string[]
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

export class Dispatcher extends EventEmitter {
  #runs = new Map<string, Run>()
  #bin: string
  #extraArgs: string[]
  #timeoutMs: number

  constructor(opts: DispatcherOptions = {}) {
    super()
    this.#bin = opts.claudeBin ?? 'claude'
    this.#extraArgs = opts.extraArgs ?? []
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  list(): RunHandle[] {
    return [...this.#runs.values()].map(run => this.#handle(run))
  }

  get(runId: string): RunHandle | undefined {
    const run = this.#runs.get(runId)
    return run ? this.#handle(run) : undefined
  }

  start(input: { projectId: string; projectPath: string; taskId: string; prompt: string }): RunHandle {
    const live = [...this.#runs.values()].find(r => r.projectId === input.projectId && r.endedAt === null)
    if (live) throw new Error(`a run is already running for project ${input.projectId}`)

    const runId = randomUUID()
    // The prompt is one argv element — never interpolated into a shell string.
    // No --bare: the target project's CLAUDE.md and hooks must load.
    const args = [...this.#extraArgs, '-p', input.prompt, '--output-format', 'stream-json', '--verbose']
    const child = spawn(this.#bin, args, {
      cwd: input.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    const run: Run = {
      runId,
      projectId: input.projectId,
      taskId: input.taskId,
      sessionId: null, costUsd: null, numTurns: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      child,
      buffer: '',
      timer: setTimeout(() => this.cancel(runId), this.#timeoutMs),
    }
    this.#runs.set(runId, run)

    // Consume stdout eagerly: a slow consumer stalls claude's own output.
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.#consume(run, chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => this.emit('output', { runId, chunk }))

    child.on('error', () => this.#finish(run, null, 'failed'))
    child.on('close', code => {
      if (run.status === 'cancelled') this.#finish(run, code, 'cancelled')
      else this.#finish(run, code, code === 0 ? 'succeeded' : 'failed')
    })

    this.#update(run)
    return this.#handle(run)
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
   * Splits stdout into whole lines, then emits a readable rendering of each and
   * watches for the session id. The init event carries it but is NOT guaranteed
   * to be the first line, so every line is checked until one is found.
   */
  #consume(run: Run, chunk: string): void {
    run.buffer += chunk
    const lines = run.buffer.split('\n')
    run.buffer = lines.pop() ?? ''

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as {
          type?: string; subtype?: string; session_id?: string
          total_cost_usd?: unknown; num_turns?: unknown
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
          this.#update(run)
        }
      } catch { /* partial or non-JSON output is expected; keep scanning */ }
      const rendered = renderStreamLine(line)
      if (rendered !== null) this.emit('output', { runId: run.runId, chunk: `${rendered}\n` })
    }
  }

  #finish(run: Run, code: number | null, status: RunStatus): void {
    if (run.endedAt !== null) return
    clearTimeout(run.timer)
    run.endedAt = new Date().toISOString()
    run.exitCode = code
    run.status = status
    this.#update(run)
  }

  #handle(run: Run): RunHandle {
    const { child: _child, timer: _timer, buffer: _buffer, ...handle } = run
    return handle
  }

  #update(run: Run): void {
    this.emit('update', this.#handle(run))
  }
}
