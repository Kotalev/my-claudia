import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialTailState, BACKFILL_MAX_BYTES } from '../backfill.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mc-backfill-')) })

describe('initialTailState', () => {
  it('reads a small recent transcript from the beginning', async () => {
    const file = join(dir, 'small.jsonl')
    await writeFile(file, '{"a":1}\n')
    expect((await initialTailState(file)).byteOffset).toBe(0)
  })

  it('starts at the end for a transcript older than the backfill window', async () => {
    const file = join(dir, 'stale.jsonl')
    await writeFile(file, '{"a":1}\n')
    const old = new Date('2020-01-01T00:00:00Z')
    await utimes(file, old, old)
    expect((await initialTailState(file)).byteOffset).toBe(8)
  })

  it('backfills only the last window of a very large transcript', async () => {
    const file = join(dir, 'big.jsonl')
    const size = BACKFILL_MAX_BYTES + 5000
    await writeFile(file, 'x'.repeat(size))
    expect((await initialTailState(file)).byteOffset).toBe(5000)
  })

  it('returns a fresh state for a missing file', async () => {
    expect((await initialTailState(join(dir, 'nope.jsonl'))).byteOffset).toBe(0)
  })
})
