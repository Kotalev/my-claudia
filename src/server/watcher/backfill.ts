import { stat } from 'node:fs/promises'
import { createTailState, type TailState } from './tail.js'

/** Transcripts untouched for longer than this are not backfilled at startup. */
const BACKFILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** At most this much history is read from any single transcript on first sight. */
export const BACKFILL_MAX_BYTES = 1024 * 1024

/**
 * Decides where to start tailing a transcript we have never seen.
 *
 * A real ~/.claude/projects tree is gigabytes across hundreds of sessions.
 * Reading all of it at startup costs minutes of IO and unbounded memory for
 * history nobody is looking at, so old files are watched from their current
 * end and large ones are backfilled only from their last window.
 */
export async function initialTailState(
  filePath: string,
  now = Date.now(),
): Promise<TailState> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return createTailState()

  if (now - info.mtimeMs > BACKFILL_MAX_AGE_MS) {
    // Stale session: start at the end. If it ever changes we pick up from there.
    return { byteOffset: info.size, partial: '' }
  }
  if (info.size > BACKFILL_MAX_BYTES) {
    // Start mid-file; the first (partial) line read from here is dropped by the
    // parser as invalid JSON, which is exactly what we want.
    return { byteOffset: info.size - BACKFILL_MAX_BYTES, partial: '' }
  }
  return createTailState()
}
