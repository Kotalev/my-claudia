import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseLine } from '../../transcript/parse.js'
import type { EntryUsage, TranscriptEntry } from '../../transcript/types.js'
import { addInto, emptyTotals, isCountable, maxUsage } from '../watcher/usage.js'
import { estimateCost } from '../../shared/pricing.js'
import type { RateBucket, SpendSummary, TokenTotals } from '../../shared/types.js'

const SEP = '\u0000'

/**
 * Days of history kept, counting today. One more than the 30-day window needs,
 * so a bucket is never pruned while it can still contribute to a figure.
 */
const RETENTION_DAYS = 31

const DAY_MS = 24 * 60 * 60 * 1000

/** The local calendar day of a moment, as `YYYY-MM-DD`. Sorts as it compares. */
function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** `daysBack` local calendar days before `now`. Component arithmetic, so DST cannot skip a day. */
function dayBefore(now: Date, daysBack: number): string {
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack))
}

interface Recorded {
  day: string
  bucketKey: string
  usage: EntryUsage
}

interface ProjectSpend {
  /** `localDay × rateKey` → totals. Key: `day SEP model SEP speed SEP geo`. */
  buckets: Map<string, TokenTotals>
  /** messageId (or uuid) → what it contributed, so a re-read replaces rather than doubles. */
  seen: Map<string, Recorded>
}

/**
 * Account-wide spend, bucketed by local calendar day and rate, per registered
 * project. Fed twice — an initial scan of each project's transcripts and the
 * live entry stream — and the per-message dedup map makes the overlap
 * idempotent, exactly like `UsageAccumulator`.
 */
export class SpendLedger {
  #projects = new Map<string, ProjectSpend>()
  /**
   * Bumped on every removeProject, so an unawaited scan started before the
   * removal notices and stops instead of lazily resurrecting the project via
   * addEntry. Monotonic per id: a re-registration scans under the new epoch.
   */
  #epochs = new Map<string, number>()
  #lastPruneDay = ''

  addEntry(projectId: string, entry: TranscriptEntry): void {
    if (!isCountable(entry) || !entry.usage) return

    const at = new Date(entry.timestamp)
    if (Number.isNaN(at.getTime())) return
    const day = localDay(at)

    const now = new Date()
    if (day < dayBefore(now, RETENTION_DAYS - 1)) return
    this.#pruneIfDayChanged(now)

    const project = this.#project(projectId)
    const key = entry.messageId ?? entry.uuid
    const prior = project.seen.get(key)

    if (!prior) {
      const bucketKey = [day, entry.model ?? 'unknown', entry.usage.speed ?? '', entry.usage.inferenceGeo ?? ''].join(SEP)
      project.seen.set(key, { day, bucketKey, usage: entry.usage })
      addInto(this.#bucket(project, bucketKey), entry.usage, 1)
      return
    }
    // Same message reported again — replace its contribution in the bucket it
    // first landed in, taking the maximum of the two reports.
    const merged = maxUsage(prior.usage, entry.usage)
    const bucket = this.#bucket(project, prior.bucketKey)
    addInto(bucket, prior.usage, -1)
    addInto(bucket, merged, 1)
    project.seen.set(key, { day: prior.day, bucketKey: prior.bucketKey, usage: merged })
  }

  removeProject(projectId: string): void {
    this.#projects.delete(projectId)
    this.#epochs.set(projectId, this.#epoch(projectId) + 1)
  }

  /**
   * Bounded initial read of one project's transcripts. Files untouched for
   * longer than the retention window cannot contribute a countable day, so they
   * are skipped without being opened. Unreadable files and directories are
   * skipped silently — the ledger must never sink the server over one transcript.
   */
  async scanProject(projectId: string, escapedDirPath: string): Promise<void> {
    // Captured before the first await, so a removeProject issued while the
    // readdir is pending already invalidates this scan.
    const epoch = this.#epoch(projectId)
    let names: string[]
    try {
      names = await readdir(escapedDirPath)
    } catch {
      return
    }
    const cutoffMs = Date.now() - RETENTION_DAYS * DAY_MS
    for (const name of names) {
      if (this.#epoch(projectId) !== epoch) return
      if (!name.endsWith('.jsonl')) continue
      const path = join(escapedDirPath, name)
      try {
        const info = await stat(path)
        if (!info.isFile() || info.mtimeMs < cutoffMs) continue
      } catch {
        continue
      }
      await this.#scanFile(projectId, path, epoch)
    }
  }

  async #scanFile(projectId: string, path: string, epoch: number): Promise<void> {
    try {
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
      for await (const line of lines) {
        if (this.#epoch(projectId) !== epoch) return
        const entry = parseLine(line)
        if (entry) this.addEntry(projectId, entry)
      }
    } catch {
      // A file that vanished or turned unreadable mid-scan is expected churn.
    }
  }

  summary(now = new Date()): SpendSummary {
    this.#prune(now)
    const today = localDay(now)
    const sevenDayStart = dayBefore(now, 6)
    const thirtyDayStart = dayBefore(now, 29)

    const todayBuckets = new Map<string, TokenTotals>()
    const sevenDayBuckets = new Map<string, TokenTotals>()
    const thirtyDayBuckets = new Map<string, TokenTotals>()

    for (const project of this.#projects.values()) {
      for (const [key, totals] of project.buckets) {
        const day = key.slice(0, key.indexOf(SEP))
        const rateKey = key.slice(key.indexOf(SEP) + 1)
        if (day >= thirtyDayStart) mergeInto(thirtyDayBuckets, rateKey, totals)
        if (day >= sevenDayStart) mergeInto(sevenDayBuckets, rateKey, totals)
        if (day === today) mergeInto(todayBuckets, rateKey, totals)
      }
    }

    const thirtyDay = estimateCost(toRateBuckets(thirtyDayBuckets))
    return {
      todayUsd: estimateCost(toRateBuckets(todayBuckets)).usd,
      sevenDayUsd: estimateCost(toRateBuckets(sevenDayBuckets)).usd,
      thirtyDayUsd: thirtyDay.usd,
      unpricedModels: thirtyDay.unpricedModels,
      updatedAt: now.toISOString(),
    }
  }

  #epoch(projectId: string): number {
    return this.#epochs.get(projectId) ?? 0
  }

  #project(projectId: string): ProjectSpend {
    let project = this.#projects.get(projectId)
    if (!project) {
      project = { buckets: new Map(), seen: new Map() }
      this.#projects.set(projectId, project)
    }
    return project
  }

  #bucket(project: ProjectSpend, key: string): TokenTotals {
    let bucket = project.buckets.get(key)
    if (!bucket) {
      bucket = emptyTotals()
      project.buckets.set(key, bucket)
    }
    return bucket
  }

  #pruneIfDayChanged(now: Date): void {
    const today = localDay(now)
    if (today === this.#lastPruneDay) return
    this.#prune(now)
  }

  #prune(now: Date): void {
    this.#lastPruneDay = localDay(now)
    const cutoff = dayBefore(now, RETENTION_DAYS - 1)
    for (const project of this.#projects.values()) {
      for (const key of project.buckets.keys()) {
        if (key.slice(0, key.indexOf(SEP)) < cutoff) project.buckets.delete(key)
      }
      for (const [id, recorded] of project.seen) {
        if (recorded.day < cutoff) project.seen.delete(id)
      }
    }
  }
}

function mergeInto(buckets: Map<string, TokenTotals>, rateKey: string, totals: TokenTotals): void {
  let target = buckets.get(rateKey)
  if (!target) {
    target = emptyTotals()
    buckets.set(rateKey, target)
  }
  for (const k of Object.keys(target) as (keyof TokenTotals)[]) {
    target[k] += totals[k]
  }
}

function toRateBuckets(buckets: Map<string, TokenTotals>): RateBucket[] {
  return [...buckets.entries()].map(([key, totals]) => {
    const [model = 'unknown', speed = '', geo = ''] = key.split(SEP)
    return {
      model,
      speed: speed === '' ? null : speed,
      inferenceGeo: geo === '' ? null : geo,
      totals,
    }
  })
}
