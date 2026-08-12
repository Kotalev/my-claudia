import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTailState, readNewLines } from '../tail.js'

let file: string
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mc-tail-'))
  file = join(dir, 'session.jsonl')
})

describe('readNewLines', () => {
  it('reads all complete lines on first pass', async () => {
    await writeFile(file, '{"a":1}\n{"a":2}\n')
    const { lines, state } = await readNewLines(file, createTailState())
    expect(lines).toEqual(['{"a":1}', '{"a":2}'])
    expect(state.byteOffset).toBe(16)
  })

  it('returns only appended lines on the second pass', async () => {
    await writeFile(file, '{"a":1}\n')
    const first = await readNewLines(file, createTailState())
    await appendFile(file, '{"a":2}\n')
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual(['{"a":2}'])
  })

  it('returns nothing when the file has not grown', async () => {
    await writeFile(file, '{"a":1}\n')
    const first = await readNewLines(file, createTailState())
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual([])
  })

  it('holds back a partial trailing line until its newline arrives', async () => {
    await writeFile(file, '{"a":1}\n{"partial":')
    const first = await readNewLines(file, createTailState())
    expect(first.lines).toEqual(['{"a":1}'])
    expect(first.state.partial).toBe('{"partial":')

    await appendFile(file, 'true}\n')
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual(['{"partial":true}'])
  })

  it('resets and re-reads when the file shrinks', async () => {
    await writeFile(file, '{"a":1}\n{"a":2}\n')
    const first = await readNewLines(file, createTailState())
    await writeFile(file, '{"b":1}\n')
    const second = await readNewLines(file, first.state)
    expect(second.lines).toEqual(['{"b":1}'])
    expect(second.state.byteOffset).toBe(8)
  })

  it('returns nothing for a missing file instead of throwing', async () => {
    const { lines } = await readNewLines(join(tmpdir(), 'nope-does-not-exist.jsonl'), createTailState())
    expect(lines).toEqual([])
  })

  it('handles multibyte characters split across reads', async () => {
    await writeFile(file, '{"t":"здравей"}\n')
    const { lines } = await readNewLines(file, createTailState())
    expect(JSON.parse(lines[0]!).t).toBe('здравей')
  })
})

describe('readNewLines — concurrent appends', () => {
  it('does not consume bytes beyond the size it recorded', async () => {
    // Simulates Claude appending while we read: the extra bytes must be left for
    // the next pass, not silently swallowed into a garbled partial line.
    await writeFile(file, '{"a":1}\n')
    const first = readNewLines(file, createTailState())
    await appendFile(file, '{"a":2}\n')
    const { lines, state } = await first

    const second = await readNewLines(file, state)
    const all = [...lines, ...second.lines]
    expect(all).toEqual(['{"a":1}', '{"a":2}'])
    for (const l of all) expect(() => JSON.parse(l)).not.toThrow()
  })
})
