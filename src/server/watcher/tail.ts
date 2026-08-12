import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export interface TailState {
  byteOffset: number
  /** A JSONL line can be observed mid-write; hold the tail until its newline arrives. */
  partial: string
}

export function createTailState(): TailState {
  return { byteOffset: 0, partial: '' }
}

async function readFrom(filePath: string, start: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = createReadStream(filePath, { start })
    stream.on('data', c => chunks.push(c as Buffer))
    stream.on('error', reject)
    // Decode once at the end so multibyte characters split across chunks survive.
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/**
 * Reads whatever was appended since the last call. chokidar events are only a
 * poke — fsevents fires duplicates and even fires on open — so growth is
 * decided here by comparing size against the stored offset.
 */
export async function readNewLines(
  filePath: string,
  state: TailState,
): Promise<{ lines: string[]; state: TailState }> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return { lines: [], state }

  let { byteOffset, partial } = state
  if (info.size < byteOffset) {
    // Truncated or rewritten (compaction, a new Claude Code version). Start over;
    // callers dedupe by line uuid so the re-read does not double-count.
    byteOffset = 0
    partial = ''
  }
  if (info.size === byteOffset) return { lines: [], state: { byteOffset, partial } }

  const chunk = await readFrom(filePath, byteOffset)
  const combined = partial + chunk
  const pieces = combined.split('\n')
  const nextPartial = pieces.pop() ?? ''
  const lines = pieces.filter(l => l.length > 0)

  return { lines, state: { byteOffset: info.size, partial: nextPartial } }
}
