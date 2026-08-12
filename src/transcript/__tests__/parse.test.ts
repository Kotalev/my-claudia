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

describe('parseLine — usage telemetry', () => {
  const assistantLine = (usage: unknown, over: Record<string, unknown> = {}): string => JSON.stringify({
    type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
    requestId: 'req_011CdxbpqUT1FfWuzvZ9w3Pz', effort: 'medium',
    message: { id: 'msg_01ABC', model: 'claude-opus-5', role: 'assistant', content: [], usage },
    ...over,
  })

  const REAL_USAGE = {
    input_tokens: 15513,
    cache_creation_input_tokens: 24061,
    cache_read_input_tokens: 11241,
    cache_creation: { ephemeral_5m_input_tokens: 24061, ephemeral_1h_input_tokens: 0 },
    output_tokens: 7,
    service_tier: 'standard',
    inference_geo: 'not_available',
    iterations: [],
    server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
  }

  it('reads a real usage block', () => {
    const e = parseLine(assistantLine(REAL_USAGE))!
    expect(e.usage).toEqual({
      inputTokens: 15513,
      outputTokens: 7,
      cacheReadInputTokens: 11241,
      cacheCreationInputTokens: 24061,
      cacheCreation5mInputTokens: 24061,
      cacheCreation1hInputTokens: 0,
      thinkingTokens: null,
      webSearchRequests: 2,
      webFetchRequests: 1,
      serviceTier: 'standard',
      inferenceGeo: 'not_available',
      speed: null,
    })
  })

  it('reads the dedup key, which is the message id and not the uuid', () => {
    const e = parseLine(assistantLine(REAL_USAGE))!
    expect(e.messageId).toBe('msg_01ABC')
    expect(e.messageId).not.toBe(e.uuid)
    expect(e.requestId).toBe('req_011CdxbpqUT1FfWuzvZ9w3Pz')
  })

  it('reads model and effort', () => {
    const e = parseLine(assistantLine(REAL_USAGE))!
    expect(e.model).toBe('claude-opus-5')
    expect(e.effort).toBe('medium')
  })

  it('reads thinking tokens when the newer details block is present', () => {
    const e = parseLine(assistantLine({ ...REAL_USAGE, output_tokens_details: { thinking_tokens: 512 } }))!
    expect(e.usage?.thinkingTokens).toBe(512)
  })

  it('handles the older flat shape with no cache_creation split', () => {
    const e = parseLine(assistantLine({
      input_tokens: 2, cache_creation_input_tokens: 1132, cache_read_input_tokens: 409146,
      output_tokens: 251, service_tier: 'standard',
    }))!
    expect(e.usage).toMatchObject({
      cacheCreationInputTokens: 1132,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      webSearchRequests: 0,
    })
  })

  it('falls back to the 5m+1h split when only the nested block is present', () => {
    const e = parseLine(assistantLine({
      input_tokens: 1, output_tokens: 2,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 40 },
    }))!
    expect(e.usage?.cacheCreationInputTokens).toBe(140)
  })

  it('never reads iterations as a count — it is an array', () => {
    const e = parseLine(assistantLine({ ...REAL_USAGE, iterations: [{ a: 1 }, { b: 2 }] }))!
    expect(e.usage?.inputTokens).toBe(15513)
    expect(Object.values(e.usage!).every(v => typeof v !== 'object' || v === null)).toBe(true)
  })

  it('marks the synthetic sentinel, which is not a real model', () => {
    const e = parseLine(assistantLine(REAL_USAGE, { message: { model: '<synthetic>', role: 'assistant', content: [] } }))!
    expect(e.model).toBe('<synthetic>')
    expect(e.usage).toBeNull()
  })

  it('marks an api error rendered as an assistant turn', () => {
    const e = parseLine(assistantLine(REAL_USAGE, { isApiErrorMessage: true }))!
    expect(e.isApiError).toBe(true)
  })

  it('degrades to no usage rather than throwing on a wrong-typed block', () => {
    expect(parseLine(assistantLine(null))!.usage).toBeNull()
    expect(parseLine(assistantLine('420'))!.usage).toBeNull()
    expect(parseLine(assistantLine([1, 2]))!.usage).toBeNull()
  })

  it('reads absent, negative and non-numeric token counts as zero', () => {
    const e = parseLine(assistantLine({ input_tokens: -5, output_tokens: 'many', cache_read_input_tokens: null }))!
    expect(e.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 })
  })

  it('carries no usage on a user turn', () => {
    const e = parseLine(JSON.stringify({
      type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-08-12T10:00:00Z',
      message: { role: 'user', content: 'hi' },
    }))!
    expect(e.usage).toBeNull()
    expect(e.model).toBeNull()
    expect(e.isApiError).toBe(false)
  })
})
