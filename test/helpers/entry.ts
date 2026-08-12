import type { TranscriptEntry } from '../../src/transcript/types.js'

/**
 * A parsed entry with every field defaulted, so a test states only what it is
 * about. Tests that spelled the whole shape out had to be edited every time the
 * transcript parser learned a new field, which is churn with no signal in it.
 */
export function makeEntry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  const base: TranscriptEntry = {
    uuid: 'u1', parentUuid: null, sessionId: 's1', timestamp: '2026-08-12T10:00:00.000Z',
    role: 'user', isSidechain: false, cwd: '/p', gitBranch: 'main', version: '2.1.0',
    text: 'do the thing', toolCalls: [], isMeta: false, isHumanPrompt: false,
    messageId: null, requestId: null, model: null, usage: null, effort: null,
    isApiError: false, isCompactBoundary: false, compact: null,
    ...over,
  }
  // Mirror what the parser would decide, unless a test states it explicitly.
  return over.isHumanPrompt !== undefined
    ? base
    : { ...base, isHumanPrompt: base.role === 'user' && !base.isMeta && !base.isSidechain }
}
