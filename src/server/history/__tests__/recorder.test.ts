import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { HistoryRecorder } from '../recorder.js'
import type { HistoryDb, RunRow, SpendDayRow } from '../db.js'
import type { Dispatcher } from '../../dispatcher/index.js'
import type { RunHandle, SpendSummary } from '../../../shared/types.js'

/** Captures writes instead of touching SQLite — the recorder's job is mapping, not storage. */
function fakeDb(): HistoryDb & { runs: RunRow[]; spendDays: SpendDayRow[] } {
  const runs: RunRow[] = []
  const spendDays: SpendDayRow[] = []
  return {
    enabled: true,
    runs,
    spendDays,
    upsertRun: run => { runs.push(run) },
    upsertSpendDay: row => { spendDays.push(row) },
    listRuns: () => [],
    searchRuns: () => [],
    listUnresolvedWorktreeRuns: () => [],
    markRunResolved: () => { /* noop */ },
    listSpendDays: () => [],
    insertSchedule: () => { /* noop */ },
    deleteSchedule: () => { /* noop */ },
    listSchedules: () => [],
    insertTemplate: () => { /* noop */ },
    deleteTemplate: () => { /* noop */ },
    listTemplates: () => [],
    close: () => { /* noop */ },
  }
}

function handle(over: Partial<RunHandle> = {}): RunHandle {
  return {
    runId: 'run-1', projectId: 'p1', taskId: 'T-001', sessionId: 'sess-1',
    status: 'succeeded', startedAt: '2026-08-13T10:00:00.000Z',
    endedAt: '2026-08-13T10:05:00.000Z', exitCode: 0, costUsd: 0.5, numTurns: 3,
    isolation: 'worktree', branch: 'mc/run-1', worktreeDir: null, baseCommit: null,
    diffAvailable: false, merged: false, discarded: false,
    ...over,
  }
}

function summary(over: Partial<SpendSummary> = {}): SpendSummary {
  return {
    todayUsd: 4.2, sevenDayUsd: 10, thirtyDayUsd: 30,
    weekly: [], monthly: [], unpricedModels: [],
    updatedAt: '2026-08-13T12:00:00.000Z',
    ...over,
  }
}

describe('HistoryRecorder', () => {
  let db: ReturnType<typeof fakeDb>
  let recorder: HistoryRecorder

  beforeEach(() => {
    db = fakeDb()
    recorder = new HistoryRecorder(db)
  })

  it('ignores updates from a run that has not ended', () => {
    recorder.recordRun(handle({ endedAt: null, status: 'running' }))
    expect(db.runs).toEqual([])
  })

  it('records a finished run with every column mapped', () => {
    recorder.recordRun(handle())
    expect(db.runs).toEqual([{
      runId: 'run-1', projectId: 'p1', taskId: 'T-001', sessionId: 'sess-1',
      status: 'succeeded', isolation: 'worktree', branch: 'mc/run-1',
      merged: false, discarded: false,
      startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:05:00.000Z',
      costUsd: 0.5, numTurns: 3, exitCode: 0, loopId: null, baseCommit: null,
      prompt: null, outputTail: null,
    }])
  })

  it('defaults the optional worktree fields for pre-isolation handles', () => {
    recorder.recordRun(handle({ isolation: undefined, branch: undefined, merged: undefined, discarded: undefined }))
    expect(db.runs[0]).toMatchObject({ isolation: null, branch: null, merged: false, discarded: false })
  })

  it('re-records the run when merged flips, via the dispatcher update event', () => {
    const dispatcher = Object.assign(new EventEmitter(), { originalInput: () => undefined })
    recorder.attach(dispatcher as unknown as Dispatcher)
    dispatcher.emit('update', handle())
    dispatcher.emit('update', handle({ merged: true }))
    expect(db.runs).toHaveLength(2)
    expect(db.runs[1]?.merged).toBe(true)
  })

  describe('prompt and output tail', () => {
    /** An emitter that also answers originalInput, like the real Dispatcher. */
    function fakeDispatcher(prompts: Record<string, string> = {}) {
      const emitter = new EventEmitter() as EventEmitter & {
        originalInput(runId: string): { prompt: string } | undefined
      }
      emitter.originalInput = runId =>
        runId in prompts ? { prompt: prompts[runId]! } : undefined
      return emitter
    }

    it('persists the prompt and the accumulated output on the run-ended upsert', () => {
      const dispatcher = fakeDispatcher({ 'run-1': 'do the thing' })
      recorder.attach(dispatcher as unknown as Dispatcher)
      dispatcher.emit('output', { runId: 'run-1', chunk: 'hello ' })
      dispatcher.emit('output', { runId: 'run-1', chunk: 'world' })
      dispatcher.emit('update', handle())
      expect(db.runs[0]).toMatchObject({ prompt: 'do the thing', outputTail: 'hello world' })
    })

    it('keeps only the end of oversized output, capped at 32 KB', () => {
      const dispatcher = fakeDispatcher()
      recorder.attach(dispatcher as unknown as Dispatcher)
      dispatcher.emit('output', { runId: 'run-1', chunk: 'x'.repeat(40_000) })
      dispatcher.emit('output', { runId: 'run-1', chunk: 'THE END' })
      dispatcher.emit('update', handle())
      const tail = db.runs[0]?.outputTail
      expect(tail).toHaveLength(32 * 1024)
      expect(tail?.endsWith('THE END')).toBe(true)
    })

    it('drops the buffer once the run ends — a later re-record upserts null, cancelled runs included', () => {
      const dispatcher = fakeDispatcher()
      recorder.attach(dispatcher as unknown as Dispatcher)
      dispatcher.emit('output', { runId: 'run-1', chunk: 'output before cancel' })
      dispatcher.emit('update', handle({ status: 'cancelled', exitCode: null }))
      dispatcher.emit('update', handle({ status: 'cancelled', exitCode: null, merged: true }))
      expect(db.runs[0]?.outputTail).toBe('output before cancel')
      expect(db.runs[1]?.outputTail).toBeNull()
    })

    it('records null prompt/tail for a run without a dispatcher or output', () => {
      recorder.recordRun(handle())
      expect(db.runs[0]).toMatchObject({ prompt: null, outputTail: null })
    })

    it('keeps output buffered while the run is still going', () => {
      const dispatcher = fakeDispatcher()
      recorder.attach(dispatcher as unknown as Dispatcher)
      dispatcher.emit('output', { runId: 'run-1', chunk: 'part one, ' })
      dispatcher.emit('update', handle({ endedAt: null, status: 'running' }))
      dispatcher.emit('output', { runId: 'run-1', chunk: 'part two' })
      dispatcher.emit('update', handle())
      expect(db.runs).toHaveLength(1)
      expect(db.runs[0]?.outputTail).toBe('part one, part two')
    })
  })

  it('pins a spend summary onto its local calendar day', () => {
    recorder.recordSpend(summary())
    expect(db.spendDays).toHaveLength(1)
    const row = db.spendDays[0]
    expect(row?.costUsd).toBe(4.2)
    expect(row?.updatedAt).toBe('2026-08-13T12:00:00.000Z')
    expect(row?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('keeps a null todayUsd as null — "nothing priceable" is not zero', () => {
    recorder.recordSpend(summary({ todayUsd: null }))
    expect(db.spendDays[0]?.costUsd).toBeNull()
  })

  it('drops a summary whose timestamp is garbage', () => {
    recorder.recordSpend(summary({ updatedAt: 'not-a-date' }))
    expect(db.spendDays).toEqual([])
  })
})
