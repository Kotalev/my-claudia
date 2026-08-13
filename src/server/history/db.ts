import type { DatabaseSync } from 'node:sqlite'
import type { PromptTemplate, ScheduleJob, ScheduleKind } from '../../shared/types.js'

/**
 * SQLite-backed history: finished runs and one spend figure per calendar day,
 * persisted to `mission-control.db` so restarts stop erasing the record.
 *
 * `node:sqlite` shipped in Node 22.5, so on Node 20 the module simply does not
 * exist. History is a nice-to-have, never worth the server: the module is
 * loaded dynamically, and any failure — missing module, unreadable file,
 * not-a-database garbage — degrades to a disabled handle whose methods are
 * no-ops. Callers check `enabled` only when they want to say "disabled" out
 * loud; calling the methods anyway is always safe.
 */

/** One persisted run, camelCase mirror of the `runs` table. */
export interface RunRow {
  runId: string
  projectId: string
  /** Null for runs that had no TASKS.md task behind them (prompt/resume runs). */
  taskId: string | null
  sessionId: string | null
  status: string
  isolation: string | null
  branch: string | null
  merged: boolean
  discarded: boolean
  startedAt: string
  endedAt: string | null
  costUsd: number | null
  numTurns: number | null
  exitCode: number | null
}

/** One calendar day of spend. `costUsd` null means "nothing priceable", not zero. */
export interface SpendDayRow {
  day: string
  costUsd: number | null
  updatedAt: string
}

export interface HistoryDb {
  readonly enabled: boolean
  upsertRun(run: RunRow): void
  upsertSpendDay(row: SpendDayRow): void
  /** Newest first by `startedAt`. `limit` is clamped to 1..1000, default 100. */
  listRuns(opts?: { projectId?: string | null; limit?: number }): RunRow[]
  /** Days at or after `sinceDay` (inclusive), oldest first. */
  listSpendDays(sinceDay: string): SpendDayRow[]
  insertSchedule(job: ScheduleJob): void
  deleteSchedule(id: string): void
  /** All persisted schedules, soonest `runAt` first. */
  listSchedules(): ScheduleJob[]
  insertTemplate(template: PromptTemplate): void
  deleteTemplate(id: string): void
  /** All saved prompt templates, by name. */
  listTemplates(): PromptTemplate[]
  close(): void
}

/** The local calendar day of a moment, as `YYYY-MM-DD`. Matches SpendLedger's bucketing. */
export function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** `daysBack` local calendar days before `now`. Component arithmetic, so DST cannot skip a day. */
export function dayBefore(now: Date, daysBack: number): string {
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack))
}

/**
 * Each entry moves `PRAGMA user_version` up by one. Append only — a later
 * round adds a new statement rather than editing an old one, so an existing
 * db file migrates forward from whatever version it is at.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    isolation TEXT,
    branch TEXT,
    merged INTEGER NOT NULL DEFAULT 0,
    discarded INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    cost_usd REAL,
    num_turns INTEGER,
    exit_code INTEGER
  );
  CREATE INDEX runs_project_started ON runs(project_id, started_at);
  CREATE TABLE spend_days (
    day TEXT PRIMARY KEY,
    cost_usd REAL,
    updated_at TEXT NOT NULL
  );
  `,
  // task_id loses NOT NULL: prompt and resume runs have no task. SQLite cannot
  // drop a column constraint in place, so the table is rebuilt. The old index
  // follows the renamed table and dies with it.
  `
  ALTER TABLE runs RENAME TO runs_v1;
  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    session_id TEXT,
    status TEXT NOT NULL,
    isolation TEXT,
    branch TEXT,
    merged INTEGER NOT NULL DEFAULT 0,
    discarded INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    cost_usd REAL,
    num_turns INTEGER,
    exit_code INTEGER
  );
  INSERT INTO runs SELECT * FROM runs_v1;
  DROP TABLE runs_v1;
  CREATE INDEX runs_project_started ON runs(project_id, started_at);
  `,
  // Scheduled jobs (T-064): auto-continue after a rate limit and timed task
  // dispatch must survive a server restart.
  `
  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT,
    session_id TEXT,
    prompt TEXT,
    run_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    note TEXT
  );
  `,
  // Prompt templates (T-065): saved prompts for the "new run" box.
  `
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
]

/** The handle everything gets when SQLite is not available. Inert, never throws. */
export const DISABLED_HISTORY: HistoryDb = {
  enabled: false,
  upsertRun() { /* disabled */ },
  upsertSpendDay() { /* disabled */ },
  listRuns: () => [],
  listSpendDays: () => [],
  // The Scheduler keeps its own in-memory job set and only mirrors it here, so
  // with these as no-ops schedules still work — they just die with the process.
  insertSchedule() { /* disabled */ },
  deleteSchedule() { /* disabled */ },
  listSchedules: () => [],
  // Same shape for templates: the route layer keeps its own in-memory map and
  // only mirrors it here, so templates survive as long as the process does.
  insertTemplate() { /* disabled */ },
  deleteTemplate() { /* disabled */ },
  listTemplates: () => [],
  close() { /* disabled */ },
}

type SqliteModule = typeof import('node:sqlite')

/**
 * Opens (or creates) the history db at `path` in WAL mode and migrates it to
 * the current schema. Any failure logs one warning and returns the disabled
 * handle — history never sinks the server.
 *
 * `loadSqlite` exists for tests: the default dynamic import throws on Node 20
 * exactly like an injected loader that rejects.
 */
export async function openHistoryDb(
  path: string,
  loadSqlite: () => Promise<SqliteModule> = () => import('node:sqlite'),
): Promise<HistoryDb> {
  try {
    const sqlite = await loadSqlite()
    const db = new sqlite.DatabaseSync(path)
    try {
      db.exec('PRAGMA journal_mode = WAL')
      migrate(db)
    } catch (err) {
      db.close()
      throw err
    }
    return new SqliteHistoryDb(db)
  } catch (err) {
    console.warn(`history disabled — SQLite unavailable at ${path}: ${(err as Error).message}`)
    return DISABLED_HISTORY
  }
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined
  let version = Number(row?.user_version ?? 0)
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]
    if (sql === undefined) break
    db.exec(sql)
    version += 1
    db.exec(`PRAGMA user_version = ${version}`)
  }
}

class SqliteHistoryDb implements HistoryDb {
  readonly enabled = true
  #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  // Writes and reads swallow their own errors: a db that turns sour at
  // runtime (disk full, file replaced underneath) loses history, not the
  // server. Reads answer empty rather than 500.

  upsertRun(run: RunRow): void {
    try {
      this.#db.prepare(`
        INSERT INTO runs (run_id, project_id, task_id, session_id, status, isolation, branch,
          merged, discarded, started_at, ended_at, cost_usd, num_turns, exit_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          session_id = excluded.session_id,
          status = excluded.status,
          branch = excluded.branch,
          merged = excluded.merged,
          discarded = excluded.discarded,
          ended_at = excluded.ended_at,
          cost_usd = excluded.cost_usd,
          num_turns = excluded.num_turns,
          exit_code = excluded.exit_code
      `).run(
        run.runId, run.projectId, run.taskId, run.sessionId, run.status, run.isolation,
        run.branch, run.merged ? 1 : 0, run.discarded ? 1 : 0, run.startedAt, run.endedAt,
        run.costUsd, run.numTurns, run.exitCode,
      )
    } catch { /* history loss is acceptable; a crash is not */ }
  }

  upsertSpendDay(row: SpendDayRow): void {
    try {
      this.#db.prepare(`
        INSERT INTO spend_days (day, cost_usd, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET cost_usd = excluded.cost_usd, updated_at = excluded.updated_at
      `).run(row.day, row.costUsd, row.updatedAt)
    } catch { /* see upsertRun */ }
  }

  listRuns(opts: { projectId?: string | null; limit?: number } = {}): RunRow[] {
    const limit = Math.max(1, Math.min(1000, Math.floor(opts.limit ?? 100)))
    try {
      const rows = opts.projectId
        ? this.#db.prepare(
            'SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
          ).all(opts.projectId, limit)
        : this.#db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit)
      return rows.map(toRunRow)
    } catch {
      return []
    }
  }

  listSpendDays(sinceDay: string): SpendDayRow[] {
    try {
      const rows = this.#db.prepare(
        'SELECT day, cost_usd, updated_at FROM spend_days WHERE day >= ? ORDER BY day',
      ).all(sinceDay)
      return rows.map(r => ({
        day: str(r.day),
        costUsd: num(r.cost_usd),
        updatedAt: str(r.updated_at),
      }))
    } catch {
      return []
    }
  }

  insertSchedule(job: ScheduleJob): void {
    try {
      this.#db.prepare(`
        INSERT OR REPLACE INTO schedules (id, kind, project_id, task_id, session_id, prompt, run_at, created_at, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(job.id, job.kind, job.projectId, job.taskId, job.sessionId, job.prompt, job.runAt, job.createdAt, job.note)
    } catch { /* see upsertRun */ }
  }

  deleteSchedule(id: string): void {
    try {
      this.#db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
    } catch { /* see upsertRun */ }
  }

  listSchedules(): ScheduleJob[] {
    try {
      const rows = this.#db.prepare('SELECT * FROM schedules ORDER BY run_at').all()
      return rows.map(toScheduleJob)
    } catch {
      return []
    }
  }

  insertTemplate(template: PromptTemplate): void {
    try {
      this.#db.prepare(`
        INSERT OR REPLACE INTO templates (id, name, text, created_at) VALUES (?, ?, ?, ?)
      `).run(template.id, template.name, template.text, template.createdAt)
    } catch { /* see upsertRun */ }
  }

  deleteTemplate(id: string): void {
    try {
      this.#db.prepare('DELETE FROM templates WHERE id = ?').run(id)
    } catch { /* see upsertRun */ }
  }

  listTemplates(): PromptTemplate[] {
    try {
      const rows = this.#db.prepare('SELECT * FROM templates ORDER BY name').all()
      return rows.map(r => ({
        id: str(r.id),
        name: str(r.name),
        text: str(r.text),
        createdAt: str(r.created_at),
      }))
    } catch {
      return []
    }
  }

  close(): void {
    try {
      this.#db.close()
    } catch { /* already closed */ }
  }
}

// SQLite answers `unknown` per column; coerce defensively — a hand-edited db
// file must degrade to odd-looking rows, never to a crash.
function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '')
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'bigint') return Number(v)
  return null
}

function toScheduleJob(r: Record<string, unknown>): ScheduleJob {
  // An unrecognised kind in a hand-edited row degrades to a job the scheduler
  // will refuse to execute, not a crash here.
  return {
    id: str(r.id),
    kind: str(r.kind) as ScheduleKind,
    projectId: str(r.project_id),
    taskId: strOrNull(r.task_id),
    sessionId: strOrNull(r.session_id),
    prompt: strOrNull(r.prompt),
    runAt: str(r.run_at),
    createdAt: str(r.created_at),
    note: strOrNull(r.note),
  }
}

function toRunRow(r: Record<string, unknown>): RunRow {
  return {
    runId: str(r.run_id),
    projectId: str(r.project_id),
    taskId: strOrNull(r.task_id),
    sessionId: strOrNull(r.session_id),
    status: str(r.status),
    isolation: strOrNull(r.isolation),
    branch: strOrNull(r.branch),
    merged: num(r.merged) === 1,
    discarded: num(r.discarded) === 1,
    startedAt: str(r.started_at),
    endedAt: strOrNull(r.ended_at),
    costUsd: num(r.cost_usd),
    numTurns: num(r.num_turns),
    exitCode: num(r.exit_code),
  }
}
