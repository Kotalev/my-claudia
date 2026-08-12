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

describe('parseLine — what counts as a human prompt', () => {
  const userLine = (text: string) => JSON.stringify({
    type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
    message: { role: 'user', content: text },
  })

  it('marks a plain typed message as a human prompt', () => {
    expect(parseLine(userLine('build the thing'))!.isHumanPrompt).toBe(true)
  })

  it('does not mark slash-command output as a human prompt', () => {
    const e = parseLine(userLine('<local-command-stdout>Set effort level to medium</local-command-stdout>'))!
    expect(e.isHumanPrompt).toBe(false)
  })

  it('does not mark an injected system reminder as a human prompt', () => {
    expect(parseLine(userLine('<system-reminder>do not forget X</system-reminder>'))!.isHumanPrompt).toBe(false)
  })

  it('does not mark a command invocation wrapper as a human prompt', () => {
    expect(parseLine(userLine('<command-name>/effort</command-name>'))!.isHumanPrompt).toBe(false)
  })

  it('does not mark a background-task notification as a human prompt', () => {
    // The most common injected shape in real data by a wide margin: 1085 of them
    // across 262 transcripts, every one of which would otherwise be shown as the
    // last thing the user said.
    const e = parseLine(userLine('<task-notification>\n<task-id>wx4j3q51g</task-id>\n</task-notification>'))!
    expect(e.isHumanPrompt).toBe(false)
  })

  it('does not mark a `!` bash command or its output as a human prompt', () => {
    // Typed by a human, but it is a shell command, not a request to the agent.
    expect(parseLine(userLine('<bash-input>git status</bash-input>'))!.isHumanPrompt).toBe(false)
    expect(parseLine(userLine('<bash-stdout>On branch main</bash-stdout>'))!.isHumanPrompt).toBe(false)
  })

  it('does not mark an assistant message as a human prompt', () => {
    const line = JSON.stringify({
      type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    })
    expect(parseLine(line)!.isHumanPrompt).toBe(false)
  })

  it('does not mark a meta line as a human prompt', () => {
    const line = JSON.stringify({
      type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
      isMeta: true, message: { role: 'user', content: 'injected context' },
    })
    expect(parseLine(line)!.isHumanPrompt).toBe(false)
  })

  it('does not mark subagent traffic as a human prompt', () => {
    const line = JSON.stringify({
      type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
      isSidechain: true, message: { role: 'user', content: 'subagent instructions' },
    })
    expect(parseLine(line)!.isHumanPrompt).toBe(false)
  })

  it('does not mark a tool-result-only turn as a human prompt', () => {
    const line = JSON.stringify({
      type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    })
    expect(parseLine(line)!.isHumanPrompt).toBe(false)
  })
})
