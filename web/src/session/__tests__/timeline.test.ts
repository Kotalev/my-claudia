import { describe, expect, it } from 'vitest'
import type { ToolCall, TranscriptEntry } from '../../shared/types.js'
import { activityFiles, activitySummary, buildChapters, buildTimeline } from '../timeline.js'

let seq = 0
function entry(over: Partial<TranscriptEntry>): TranscriptEntry {
  seq += 1
  return {
    uuid: `u-${seq}`,
    parentUuid: null,
    sessionId: 's',
    timestamp: '2026-08-12T14:00:00.000Z',
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

function call(name: string, filePath: string | null = null): ToolCall {
  seq += 1
  return { id: `t-${seq}`, name, filePath } as ToolCall
}

describe('buildTimeline', () => {
  it('keeps prose entries, merges tool-only stretches, folds bookkeeping', () => {
    const items = buildTimeline([
      entry({ role: 'user', text: 'do the thing' }),
      entry({ toolCalls: [call('Edit', '/a/b.ts')] }),
      entry({ toolCalls: [call('Bash')] }),
      entry({}), // bookkeeping
      entry({}),
      entry({ text: 'done' }),
    ])
    expect(items.map(i => i.kind)).toEqual(['entry', 'activity', 'hidden', 'entry'])
    const activity = items[1]
    if (activity?.kind !== 'activity') throw new Error('expected activity')
    expect(activity.entries).toHaveLength(2)
    const hidden = items[2]
    if (hidden?.kind !== 'hidden') throw new Error('expected hidden')
    expect(hidden.count).toBe(2)
  })

  it('surfaces a compaction boundary as its own item, splitting runs', () => {
    const items = buildTimeline([
      entry({}),
      entry({ isCompactBoundary: true }),
      entry({}),
    ])
    expect(items.map(i => i.kind)).toEqual(['hidden', 'compaction', 'hidden'])
  })

  it('degrades on empty input', () => {
    expect(buildTimeline([])).toEqual([])
  })

  it('an entry carrying both text and tool calls stays a prose entry', () => {
    const items = buildTimeline([entry({ text: 'running tests', toolCalls: [call('Bash')] })])
    expect(items.map(i => i.kind)).toEqual(['entry'])
  })
})

describe('activitySummary / activityFiles', () => {
  it('counts per tool and lists distinct basenames', () => {
    const calls = [
      call('Edit', '/x/TASKS.md'),
      call('Edit', '/x/TASKS.md'),
      call('Edit', '/x/src/usage/ledger.ts'),
      call('Bash'),
      call('Read', '/x/a.ts'),
      call('Read', '/x/b.ts'),
    ]
    expect(activitySummary(calls)).toBe('Edit ×3 · Bash · Read ×2')
    expect(activityFiles(calls)).toBe('TASKS.md, ledger.ts, a.ts, +1')
  })

  it('degrades on no calls and no paths', () => {
    expect(activitySummary([])).toBe('')
    expect(activityFiles([call('Bash')])).toBe('')
  })
})

describe('buildChapters', () => {
  it('marks human prompts and compactions, skipping machine user turns and empty text', () => {
    const chapters = buildChapters([
      entry({ role: 'user', text: 'първи промпт' }),
      entry({ role: 'user', text: null }),
      entry({ role: 'user', text: '   ' }),
      // Machine content replayed as a user turn — the parser says so.
      entry({ role: 'user', text: 'injected reminder', isMeta: true, isHumanPrompt: false }),
      entry({ role: 'user', text: 'subagent instructions', isSidechain: true, isHumanPrompt: false }),
      entry({ isCompactBoundary: true }),
      entry({ role: 'user', text: `${'x'.repeat(60)}\nsecond line` }),
    ])
    expect(chapters.map(c => c.isCompaction)).toEqual([false, true, false])
    expect(chapters[0]!.label).toBe('първи промпт')
    // Long first lines are clipped for the rail; the entry keeps the full text.
    expect(chapters[2]!.label).toBe(`${'x'.repeat(42)}…`)
  })

  it('degrades on empty input', () => {
    expect(buildChapters([])).toEqual([])
  })
})
