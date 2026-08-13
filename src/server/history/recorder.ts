import type { Dispatcher } from '../dispatcher/index.js'
import type { RunHandle, SpendSummary } from '../../shared/types.js'
import { localDay, type HistoryDb } from './db.js'

/**
 * Feeds the history db from the two live streams it mirrors.
 *
 * Runs: the Dispatcher emits `update` with a RunHandle on every state change.
 * A run enters history once it has ended — mid-run updates are noise here —
 * and the later merged/discarded flips re-emit the same handle, so a plain
 * upsert of the whole row keeps the record current.
 *
 * Spend: the server calls `recordSpend` with each SpendSummary it broadcasts,
 * which pins the summary's `todayUsd` onto its local calendar day. Days
 * accumulate as the server lives through them; the ledger itself only holds a
 * rolling window in memory.
 */
export class HistoryRecorder {
  #db: HistoryDb

  constructor(db: HistoryDb) {
    this.#db = db
  }

  attach(dispatcher: Dispatcher): void {
    dispatcher.on('update', (run: RunHandle) => this.recordRun(run))
  }

  recordRun(run: RunHandle): void {
    if (run.endedAt === null) return
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
    })
  }

  recordSpend(spend: SpendSummary): void {
    const at = new Date(spend.updatedAt)
    if (Number.isNaN(at.getTime())) return
    this.#db.upsertSpendDay({ day: localDay(at), costUsd: spend.todayUsd, updatedAt: spend.updatedAt })
  }
}
