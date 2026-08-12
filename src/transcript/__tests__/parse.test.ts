import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseLine, parseLines } from '../parse.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../test/fixtures/${name}`, import.meta.url)), 'utf8')
    .split('\n').filter(l => l.length > 0)

describe('parseLine — malformed input', () => {
  it('returns null for invalid JSON instead of throwing', () => {
    expect(parseLine('{ this is not json at all')).toBeNull()
  })
  it('returns null for an empty line', () => {
    expect(parseLine('')).toBeNull()
  })
  it('returns null for a known type missing required fields', () => {
    expect(parseLine('{"type":"assistant"}')).toBeNull()
  })
  it('returns null for an unknown future type', () => {
    expect(parseLine('{"type":"totally-unknown-future-type","uuid":"x1"}')).toBeNull()
  })
})

describe('parseLine — content extraction', () => {
  const lines = fixture('transcript-malformed.jsonl')

  it('parses a string-content user message', () => {
    const e = parseLine(lines.find(l => l.includes('"u1"'))!)!
    expect(e.role).toBe('user')
    expect(e.text).toBe('hello')
    expect(e.toolCalls).toEqual([])
  })

  it('extracts visible text and tool calls but never thinking content', () => {
    const e = parseLine(lines.find(l => l.includes('"a1"'))!)!
    expect(e.role).toBe('assistant')
    expect(e.text).toBe('hi')
    expect(e.text).not.toContain('secret')
    expect(e.toolCalls).toEqual([{ id: 't1', name: 'Read', filePath: '/Users/dev/x.ts' }])
  })

  it('yields no text for a tool_result-only user message', () => {
    const e = parseLine(lines.find(l => l.includes('"u2"'))!)!
    expect(e.role).toBe('user')
    expect(e.text).toBeNull()
  })
})

describe('parseLines — stats', () => {
  it('counts skipped lines by reason and never throws', () => {
    const { entries, stats } = parseLines(fixture('transcript-malformed.jsonl'))
    expect(entries).toHaveLength(3)
    expect(stats.parsed).toBe(3)
    expect(stats.skippedInvalid).toBe(2)
    expect(stats.skippedUnknown).toBe(1)
  })

  it('parses a real transcript without throwing and records versions', () => {
    const { entries, stats } = parseLines(fixture('transcript-sample.jsonl'))
    expect(entries.length).toBeGreaterThan(10)
    expect(stats.versions.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.uuid).toBeTruthy()
      expect(['user', 'assistant', 'system']).toContain(e.role)
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false)
    }
  })

  it('does not count known bookkeeping lines as format drift', () => {
    const { stats } = parseLines(fixture('transcript-sample.jsonl'))
    expect(stats.skippedUnknown).toBe(0)
    expect(stats.skippedBookkeeping).toBeGreaterThan(0)
  })

  it('extracts file paths from real tool calls', () => {
    const { entries } = parseLines(fixture('transcript-sample.jsonl'))
    const withFiles = entries.flatMap(e => e.toolCalls).filter(t => t.filePath !== null)
    expect(withFiles.length).toBeGreaterThan(0)
  })
})
