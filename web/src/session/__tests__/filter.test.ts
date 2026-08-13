import { describe, expect, it } from 'vitest'
import type { ToolCall, TranscriptEntry } from '../../shared/types.js'
import { collectToolNames, filterEntries, isFilterActive } from '../filter.js'

let seq = 0
function entry(over: Partial<TranscriptEntry>): TranscriptEntry {
  seq += 1
  return {
    uuid: `u-${seq}`,
    parentUuid: null,
    sessionId: 's',
    timestamp: '2026-08-13T09:00:00.000Z',
    role: 'assistant',
    isSidechain: false,
    cwd: null,
    gitBranch: null,
    version: null,
    text: null,
    toolCalls: [],
    isMeta: false,
    messageId: null,
    requestId: null,
    model: null,
    usage: null,
    effort: null,
    isApiError: false,
    isCompactBoundary: false,
    compact: null,
    isHumanPrompt: over.role === 'user' && over.text != null,
    ...over,
  }
}

function call(name: string): ToolCall {
  seq += 1
  return { id: `t-${seq}`, name, filePath: null } as ToolCall
}

describe('filterEntries', () => {
  const fixture = [
    entry({ role: 'user', text: 'Fix the Watcher bug' }),
    entry({ text: 'looking at the watcher now', toolCalls: [call('Read')] }),
    entry({ toolCalls: [call('Edit'), call('Bash')] }), // tool-only, no text
    entry({ text: 'done' }),
    entry({}), // bookkeeping: no text, no tools
  ]

  it('matches visible text case-insensitively', () => {
    const out = filterEntries(fixture, { query: 'WATCHER', tool: null })
    expect(out.map(e => e.text)).toEqual(['Fix the Watcher bug', 'looking at the watcher now'])
  })

  it('excludes entries with no text from a text query', () => {
    const out = filterEntries(fixture, { query: 'e', tool: null })
    expect(out.every(e => e.text !== null)).toBe(true)
  })

  it('tool filter keeps only entries using that tool', () => {
    const out = filterEntries(fixture, { query: '', tool: 'Edit' })
    expect(out).toHaveLength(1)
    expect(out[0]!.toolCalls.map(c => c.name)).toEqual(['Edit', 'Bash'])
  })

  it('an unknown tool matches nothing rather than throwing', () => {
    expect(filterEntries(fixture, { query: '', tool: 'NoSuchTool' })).toEqual([])
  })

  it('empty query and no tool returns the input unchanged', () => {
    expect(filterEntries(fixture, { query: '', tool: null })).toBe(fixture)
    // Whitespace-only is still an empty query.
    expect(filterEntries(fixture, { query: '   ', tool: null })).toBe(fixture)
  })

  it('combined filters AND together', () => {
    const out = filterEntries(fixture, { query: 'watcher', tool: 'Read' })
    expect(out.map(e => e.text)).toEqual(['looking at the watcher now'])
    expect(filterEntries(fixture, { query: 'watcher', tool: 'Edit' })).toEqual([])
  })

  it('degrades on empty input', () => {
    expect(filterEntries([], { query: 'x', tool: 'Edit' })).toEqual([])
  })
})

describe('isFilterActive', () => {
  it('is false for empty and whitespace-only, true for either half', () => {
    expect(isFilterActive({ query: '', tool: null })).toBe(false)
    expect(isFilterActive({ query: '  ', tool: null })).toBe(false)
    expect(isFilterActive({ query: 'x', tool: null })).toBe(true)
    expect(isFilterActive({ query: '', tool: 'Bash' })).toBe(true)
  })
})

describe('collectToolNames', () => {
  it('lists distinct names in first-use order', () => {
    const names = collectToolNames([
      entry({ toolCalls: [call('Edit'), call('Bash')] }),
      entry({ toolCalls: [call('Edit'), call('Read')] }),
    ])
    expect(names).toEqual(['Edit', 'Bash', 'Read'])
  })

  it('degrades on empty input and tool-free entries', () => {
    expect(collectToolNames([])).toEqual([])
    expect(collectToolNames([entry({ text: 'hi' })])).toEqual([])
  })
})
