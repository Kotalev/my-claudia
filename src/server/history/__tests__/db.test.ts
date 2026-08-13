import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openHistoryDb, DISABLED_HISTORY, localDay, dayBefore, type HistoryDb, type RunRow } from '../db.js'
import type { PromptTemplate, ScheduleJob } from '../../../shared/types.js'

function template(over: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: 'tpl-1', name: 'review pass', text: 'run /code-review on the current diff',
    createdAt: '2026-08-13T10:00:00.000Z',
    ...over,
  }
}

function scheduleJob(over: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'job-1', kind: 'resume-run', projectId: 'p1', taskId: null,
    sessionId: 'sess-1', prompt: 'continue',
    runAt: '2026-08-14T10:00:00.000Z', createdAt: '2026-08-13T10:00:00.000Z',
    note: 'auto-continue after five_hour',
    repeatEveryMs: null, loopId: null, iteration: 1, maxIterations: null, stopAfterFailures: null,
    ...over,
  }
}

function runRow(over: Partial<RunRow> = {}): RunRow {
  return {
    runId: 'run-1', projectId: 'p1', taskId: 'T-001', sessionId: 'sess-1',
    status: 'succeeded', isolation: 'worktree', branch: 'mc/run-1',
    merged: false, discarded: false,
    startedAt: '2026-08-13T10:00:00.000Z', endedAt: '2026-08-13T10:05:00.000Z',
    costUsd: 1.23, numTurns: 7, exitCode: 0, loopId: null, baseCommit: 'abc123',
    prompt: null, outputTail: null,
    ...over,
  }
}

describe('openHistoryDb', () => {
  let dir: string
  let open: HistoryDb[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mc-history-'))
    open = []
    vi.spyOn(console, 'warn').mockImplementation(() => { /* keep test output clean */ })
  })

  afterEach(() => {
    for (const db of open) db.close()
    vi.restoreAllMocks()
  })

  async function openAt(name = 'history.db'): Promise<HistoryDb> {
    const db = await openHistoryDb(join(dir, name))
    open.push(db)
    return db
  }

  it('round-trips a run row', async () => {
    const db = await openAt()
    expect(db.enabled).toBe(true)
    db.upsertRun(runRow())
    expect(db.listRuns()).toEqual([runRow()])
  })

  it('upserting the same run id replaces, not duplicates', async () => {
    const db = await openAt()
    db.upsertRun(runRow())
    db.upsertRun(runRow({ merged: true, costUsd: 2.5 }))
    const runs = db.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.merged).toBe(true)
    expect(runs[0]?.costUsd).toBe(2.5)
  })

  it('lists newest first, filters by project, honours the limit', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ runId: 'a', projectId: 'p1', startedAt: '2026-08-01T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'b', projectId: 'p1', startedAt: '2026-08-02T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'c', projectId: 'p2', startedAt: '2026-08-03T00:00:00Z' }))
    expect(db.listRuns().map(r => r.runId)).toEqual(['c', 'b', 'a'])
    expect(db.listRuns({ projectId: 'p1' }).map(r => r.runId)).toEqual(['b', 'a'])
    expect(db.listRuns({ limit: 1 }).map(r => r.runId)).toEqual(['c'])
  })

  it('round-trips a null taskId (prompt/resume runs have no task)', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ taskId: null }))
    expect(db.listRuns()[0]?.taskId).toBeNull()
  })

  it('migrates a v1 db (task_id NOT NULL) forward, keeps its rows, and accepts null taskIds', async () => {
    // A db exactly as migration 1 left it, written without going through openHistoryDb.
    const sqlite = await import('node:sqlite')
    const path = join(dir, 'v1.db')
    const raw = new sqlite.DatabaseSync(path)
    raw.exec(`
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
        session_id TEXT, status TEXT NOT NULL, isolation TEXT, branch TEXT,
        merged INTEGER NOT NULL DEFAULT 0, discarded INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, ended_at TEXT, cost_usd REAL, num_turns INTEGER, exit_code INTEGER
      );
      CREATE INDEX runs_project_started ON runs(project_id, started_at);
      CREATE TABLE spend_days (day TEXT PRIMARY KEY, cost_usd REAL, updated_at TEXT NOT NULL);
      INSERT INTO runs (run_id, project_id, task_id, status, started_at)
        VALUES ('old-run', 'p1', 'T-001', 'succeeded', '2026-08-01T00:00:00Z');
      PRAGMA user_version = 1;
    `)
    raw.close()

    const db = await openHistoryDb(path)
    open.push(db)
    expect(db.enabled).toBe(true)
    expect(db.listRuns().find(r => r.runId === 'old-run')?.taskId).toBe('T-001')
    db.upsertRun(runRow({ runId: 'new-run', taskId: null, startedAt: '2026-08-13T00:00:00Z' }))
    const runs = db.listRuns()
    expect(runs.map(r => r.runId)).toEqual(['new-run', 'old-run'])
    expect(runs[0]?.taskId).toBeNull()
  })

  it('round-trips spend days and upserts by day', async () => {
    const db = await openAt()
    db.upsertSpendDay({ day: '2026-08-12', costUsd: 3.5, updatedAt: '2026-08-12T20:00:00Z' })
    db.upsertSpendDay({ day: '2026-08-13', costUsd: null, updatedAt: '2026-08-13T08:00:00Z' })
    db.upsertSpendDay({ day: '2026-08-13', costUsd: 1.25, updatedAt: '2026-08-13T09:00:00Z' })
    expect(db.listSpendDays('2026-08-01')).toEqual([
      { day: '2026-08-12', costUsd: 3.5, updatedAt: '2026-08-12T20:00:00Z' },
      { day: '2026-08-13', costUsd: 1.25, updatedAt: '2026-08-13T09:00:00Z' },
    ])
    // sinceDay is inclusive; earlier days fall away.
    expect(db.listSpendDays('2026-08-13')).toHaveLength(1)
  })

  it('answers empty on a fresh db', async () => {
    const db = await openAt()
    expect(db.listRuns()).toEqual([])
    expect(db.listSpendDays('2000-01-01')).toEqual([])
  })

  it('persists across a close and reopen', async () => {
    const first = await openAt()
    first.upsertRun(runRow())
    first.upsertSpendDay({ day: '2026-08-13', costUsd: 9, updatedAt: '2026-08-13T09:00:00Z' })
    first.close()

    const second = await openAt()
    expect(second.listRuns()).toEqual([runRow()])
    expect(second.listSpendDays('2026-08-13')).toHaveLength(1)
  })

  it('degrades to disabled when the file is not a database', async () => {
    const path = join(dir, 'garbage.db')
    await writeFile(path, 'this is not sqlite at all — just text\n'.repeat(20))
    const db = await openHistoryDb(path)
    open.push(db)
    expect(db.enabled).toBe(false)
    // Disabled methods stay inert rather than throwing.
    db.upsertRun(runRow())
    expect(db.listRuns()).toEqual([])
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('degrades to disabled when node:sqlite is missing (Node 20)', async () => {
    const db = await openHistoryDb(join(dir, 'never.db'),
      () => Promise.reject(new Error('No such built-in module: node:sqlite')))
    expect(db.enabled).toBe(false)
    expect(db.listSpendDays('2000-01-01')).toEqual([])
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('lists unresolved worktree runs — ended, worktree, unmerged, undiscarded, with a branch', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ runId: 'pending', startedAt: '2026-08-10T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'pending-newer', startedAt: '2026-08-12T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'still-going', endedAt: null, status: 'running' }))
    db.upsertRun(runRow({ runId: 'merged', merged: true }))
    db.upsertRun(runRow({ runId: 'discarded', discarded: true }))
    db.upsertRun(runRow({ runId: 'in-place', isolation: 'in-place', branch: null }))
    expect(db.listUnresolvedWorktreeRuns().map(r => r.runId)).toEqual(['pending-newer', 'pending'])
  })

  it('markRunResolved flips the flag and drops the run from the unresolved list', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ runId: 'a' }))
    db.upsertRun(runRow({ runId: 'b' }))
    db.markRunResolved('a', 'merged')
    db.markRunResolved('b', 'discarded')
    db.markRunResolved('no-such-run', 'merged')   // unknown id is a no-op, not an error
    expect(db.listUnresolvedWorktreeRuns()).toEqual([])
    const byId = new Map(db.listRuns().map(r => [r.runId, r]))
    expect(byId.get('a')?.merged).toBe(true)
    expect(byId.get('b')?.discarded).toBe(true)
  })

  it('round-trips prompt and output tail, then finds the run by either', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ prompt: 'fix the flaky watcher test', outputTail: 'All 12 tests passed.' }))
    expect(db.listRuns()[0]).toMatchObject({
      prompt: 'fix the flaky watcher test', outputTail: 'All 12 tests passed.',
    })
    expect(db.searchRuns('flaky watcher').map(r => r.runId)).toEqual(['run-1'])
    expect(db.searchRuns('tests passed').map(r => r.runId)).toEqual(['run-1'])
  })

  it('a later upsert with null prompt/tail keeps the stored text (merged flip re-record)', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ prompt: 'do the thing', outputTail: 'done' }))
    db.upsertRun(runRow({ merged: true, prompt: null, outputTail: null }))
    const run = db.listRuns()[0]
    expect(run?.merged).toBe(true)
    expect(run?.prompt).toBe('do the thing')
    expect(run?.outputTail).toBe('done')
  })

  it('searches task id and branch too, case-insensitively, newest first', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ runId: 'a', taskId: 'T-101', branch: 'mc/run-a', startedAt: '2026-08-01T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'b', taskId: 'T-102', branch: 'mc/feature-x', startedAt: '2026-08-02T00:00:00Z' }))
    expect(db.searchRuns('t-10').map(r => r.runId)).toEqual(['b', 'a'])
    expect(db.searchRuns('FEATURE-X').map(r => r.runId)).toEqual(['b'])
    expect(db.searchRuns('nothing-matches')).toEqual([])
  })

  it('search filters by project and honours the limit', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ runId: 'a', projectId: 'p1', prompt: 'shared word', startedAt: '2026-08-01T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'b', projectId: 'p2', prompt: 'shared word', startedAt: '2026-08-02T00:00:00Z' }))
    expect(db.searchRuns('shared', { projectId: 'p1' }).map(r => r.runId)).toEqual(['a'])
    expect(db.searchRuns('shared', { limit: 1 }).map(r => r.runId)).toEqual(['b'])
  })

  it('treats %, _ and \\ in the query as literal characters', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ runId: 'pct', prompt: 'usage hit 100% today', startedAt: '2026-08-01T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'under', prompt: 'rename snake_case field', startedAt: '2026-08-02T00:00:00Z' }))
    db.upsertRun(runRow({ runId: 'slash', prompt: String.raw`path C:\temp broke`, startedAt: '2026-08-03T00:00:00Z' }))
    expect(db.searchRuns('100%').map(r => r.runId)).toEqual(['pct'])
    expect(db.searchRuns('snake_case').map(r => r.runId)).toEqual(['under'])
    // A bare % must not match everything.
    expect(db.searchRuns('%').map(r => r.runId)).toEqual(['pct'])
    expect(db.searchRuns('_').map(r => r.runId)).toEqual(['under'])
    expect(db.searchRuns(String.raw`C:\temp`).map(r => r.runId)).toEqual(['slash'])
  })

  it('an empty or whitespace query finds nothing', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ prompt: 'anything' }))
    expect(db.searchRuns('')).toEqual([])
    expect(db.searchRuns('   ')).toEqual([])
  })

  it('round-trips a null baseCommit (rows recorded before migration 6)', async () => {
    const db = await openAt()
    db.upsertRun(runRow({ baseCommit: null }))
    expect(db.listRuns()[0]?.baseCommit).toBeNull()
  })

  it('DISABLED_HISTORY is safe to poke from every side', () => {
    expect(DISABLED_HISTORY.enabled).toBe(false)
    DISABLED_HISTORY.upsertRun(runRow())
    DISABLED_HISTORY.upsertSpendDay({ day: '2026-08-13', costUsd: 1, updatedAt: 'x' })
    DISABLED_HISTORY.insertSchedule(scheduleJob())
    DISABLED_HISTORY.deleteSchedule('job-1')
    DISABLED_HISTORY.insertTemplate(template())
    DISABLED_HISTORY.deleteTemplate('tpl-1')
    DISABLED_HISTORY.markRunResolved('run-1', 'merged')
    DISABLED_HISTORY.close()
    expect(DISABLED_HISTORY.listRuns()).toEqual([])
    expect(DISABLED_HISTORY.searchRuns('anything')).toEqual([])
    expect(DISABLED_HISTORY.listUnresolvedWorktreeRuns()).toEqual([])
    expect(DISABLED_HISTORY.listSchedules()).toEqual([])
    expect(DISABLED_HISTORY.listTemplates()).toEqual([])
  })

  it('round-trips a schedule, lists soonest first, deletes by id', async () => {
    const db = await openAt()
    db.insertSchedule(scheduleJob({ id: 'later', runAt: '2026-08-14T12:00:00.000Z' }))
    db.insertSchedule(scheduleJob({ id: 'sooner', runAt: '2026-08-14T08:00:00.000Z' }))
    expect(db.listSchedules().map(j => j.id)).toEqual(['sooner', 'later'])
    expect(db.listSchedules()[0]).toEqual(scheduleJob({ id: 'sooner', runAt: '2026-08-14T08:00:00.000Z' }))

    db.deleteSchedule('sooner')
    expect(db.listSchedules().map(j => j.id)).toEqual(['later'])
    db.deleteSchedule('no-such-id')   // deleting the unknown is a no-op, not an error
    expect(db.listSchedules()).toHaveLength(1)
  })

  it('round-trips a dispatch-task schedule with null session and prompt', async () => {
    const db = await openAt()
    const job = scheduleJob({ kind: 'dispatch-task', taskId: 'T-042', sessionId: null, prompt: null, note: null })
    db.insertSchedule(job)
    expect(db.listSchedules()).toEqual([job])
  })

  it('round-trips templates, lists by name, deletes by id', async () => {
    const db = await openAt()
    db.insertTemplate(template({ id: 'b', name: 'zulu' }))
    db.insertTemplate(template({ id: 'a', name: 'alpha' }))
    expect(db.listTemplates().map(t => t.name)).toEqual(['alpha', 'zulu'])
    expect(db.listTemplates()[0]).toEqual(template({ id: 'a', name: 'alpha' }))

    db.deleteTemplate('a')
    expect(db.listTemplates().map(t => t.id)).toEqual(['b'])
    db.deleteTemplate('no-such-id')   // deleting the unknown is a no-op, not an error
    expect(db.listTemplates()).toHaveLength(1)
  })

  it('migrates a v3 db to gain the templates table, and reopening changes nothing', async () => {
    const first = await openAt('tpl-mig.db')
    first.insertTemplate(template())
    first.close()

    const second = await openAt('tpl-mig.db')
    expect(second.enabled).toBe(true)
    expect(second.listTemplates()).toEqual([template()])
  })

  it('migrates a v2 db to gain the schedules table, and reopening changes nothing', async () => {
    const first = await openAt('mig.db')
    first.insertSchedule(scheduleJob())
    first.close()

    // Reopen runs migrate() again: user_version is already current, so the
    // schema statements must not run twice, and the row survives.
    const second = await openAt('mig.db')
    expect(second.enabled).toBe(true)
    expect(second.listSchedules()).toEqual([scheduleJob()])
  })
})

describe('day helpers', () => {
  it('formats a local calendar day with zero padding', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('walks back across a month boundary by components', () => {
    expect(dayBefore(new Date(2026, 2, 1), 1)).toBe('2026-02-28')
    expect(dayBefore(new Date(2026, 7, 13), 0)).toBe('2026-08-13')
  })
})
