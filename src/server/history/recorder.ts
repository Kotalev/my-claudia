import type { Dispatcher } from '../dispatcher/index.js'
import type { RunHandle, SpendSummary } from '../../shared/types.js'
import { localDay, type HistoryDb } from './db.js'

/** How much of a run's output survives into history — the end, where results live. */
const TAIL_CAP = 32 * 1024

/**
 * Feeds the history db from the two live streams it mirrors.
 *
 * Runs: the Dispatcher emits `update` with a RunHandle on every state change.
 * A run enters history once it has ended — mid-run updates are noise here —
 * and the later merged/discarded flips re-emit the same handle, so a plain
 * upsert of the whole row keeps the record current. Output chunks accumulate
 * in a per-run tail buffer (capped, end kept) so the first post-end upsert can
 * persist them; the prompt comes from the dispatcher's `originalInput`.
 *
 * Spend: the server calls `recordSpend` with each SpendSummary it broadcasts,
 * which pins the summary's `todayUsd` onto its local calendar day. Days
 * accumulate as the server lives through them; the ledger itself only holds a
 * rolling window in memory.
 */
export class HistoryRecorder {
  #db: HistoryDb
  #dispatcher: Dispatcher | null = null
  #tails = new Map<string, string>()

  constructor(db: HistoryDb) {
    this.#db = db
  }

  attach(dispatcher: Dispatcher): void {
    this.#dispatcher = dispatcher
    dispatcher.on('output', ({ runId, chunk }: { runId: string; chunk: string }) =>
      this.recordOutput(runId, chunk))
    dispatcher.on('update', (run: RunHandle) => this.recordRun(run))
  }

  recordOutput(runId: string, chunk: string): void {
    const tail = (this.#tails.get(runId) ?? '') + chunk
    this.#tails.set(runId, tail.length > TAIL_CAP ? tail.slice(-TAIL_CAP) : tail)
  }

  recordRun(run: RunHandle): void {
    if (run.endedAt === null) return
    // Any ended run — succeeded, failed or cancelled — consumes its buffer.
    // Later re-records (merged/discarded flips) upsert null here; the db keeps
    // the stored value via COALESCE.
    const outputTail = this.#tails.get(run.runId) ?? null
    this.#tails.delete(run.runId)
    this.#db.upsertRun({
      runId: run.runId,
      projectId: run.projectId,
      taskId: run.taskId,
      sessionId: run.sessionId,
      status: run.status,
      isolation: run.isolation ?? null,
      branch: run.branch ?? null,
      merged: run.merged ?? false,
      discarded: run.discarded ?? false,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      costUsd: run.costUsd,
      numTurns: run.numTurns,
      exitCode: run.exitCode,
      loopId: run.loopId ?? null,
      baseCommit: run.baseCommit ?? null,
      prompt: this.#dispatcher?.originalInput(run.runId)?.prompt ?? null,
      outputTail,
    })
  }

  recordSpend(spend: SpendSummary): void {
    const at = new Date(spend.updatedAt)
    if (Number.isNaN(at.getTime())) return
    this.#db.upsertSpendDay({ day: localDay(at), costUsd: spend.todayUsd, updatedAt: spend.updatedAt })
  }
}
