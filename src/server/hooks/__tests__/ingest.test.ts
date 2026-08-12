import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeHookEvent, applyHookEvent } from '../ingest.js'
import { SessionStore } from '../../watcher/session-store.js'
import type { ProjectRegistry } from '../../registry.js'
import type { ParseStats } from '../../../transcript/types.js'

const registry = { byEscapedDir: () => undefined } as unknown as ProjectRegistry
const stats: ParseStats = {
  parsed: 1, skippedUnknown: 0, skippedBookkeeping: 0, skippedInvalid: 0, versions: [],
}

afterEach(() => { vi.useRealTimers() })

describe('normalizeHookEvent', () => {
  it('accepts a well-formed hook payload', () => {
    const e = normalizeHookEvent({
      hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', transcript_path: '/t.jsonl',
    })
    expect(e?.session_id).toBe('s1')
    expect(e?.hook_event_name).toBe('SessionStart')
    expect(e?.cwd).toBe('/p')
  })

  it('rejects a payload with no session id', () => {
    expect(normalizeHookEvent({ hook_event_name: 'Stop' })).toBeNull()
  })

  it('rejects a payload with no event name', () => {
    expect(normalizeHookEvent({ session_id: 's1' })).toBeNull()
  })

  it('rejects non-object bodies instead of throwing', () => {
    expect(normalizeHookEvent(null)).toBeNull()
    expect(normalizeHookEvent('nope')).toBeNull()
    expect(normalizeHookEvent(42)).toBeNull()
  })

  it('tolerates unknown future event names', () => {
    expect(normalizeHookEvent({ hook_event_name: 'SomeFutureEvent', session_id: 's1' })?.hook_event_name)
      .toBe('SomeFutureEvent')
  })

  it('drops fields of the wrong type rather than passing them through', () => {
    const e = normalizeHookEvent({ hook_event_name: 'Stop', session_id: 's1', cwd: 42 })
    expect(e?.cwd).toBeUndefined()
  })
})

describe('applyHookEvent', () => {
  it('makes a session active even with no transcript entries yet', () => {
    const store = new SessionStore()
    const summary = applyHookEvent(store, registry, {
      hook_event_name: 'SessionStart', session_id: 's-new', cwd: '/p',
    })!
    expect(summary.sessionId).toBe('s-new')
    expect(summary.status).toBe('active')
  })

  it('keeps a session active on a hook even when its transcript looks stale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))
    const store = new SessionStore()
    store.apply('s1', [{
      uuid: 'u1', parentUuid: null, sessionId: 's1', timestamp: '2026-08-12T10:00:00.000Z',
      role: 'user', isSidechain: false, cwd: '/p', gitBranch: null, version: null,
      text: 'hi', toolCalls: [], isMeta: false,
    }], stats, null)
    expect(store.get('s1')!.status).toBe('idle')

    applyHookEvent(store, registry, { hook_event_name: 'PostToolUse', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('active')
  })

  it('marks the session done on SessionEnd', () => {
    const store = new SessionStore()
    applyHookEvent(store, registry, { hook_event_name: 'SessionStart', session_id: 's1' })
    applyHookEvent(store, registry, { hook_event_name: 'SessionEnd', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('done')
  })

  it('does not mark done on Stop — a stopped turn is not a finished session', () => {
    const store = new SessionStore()
    applyHookEvent(store, registry, { hook_event_name: 'SessionStart', session_id: 's1' })
    applyHookEvent(store, registry, { hook_event_name: 'Stop', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('active')
  })

  it('revives a session that was ended and then started again', () => {
    const store = new SessionStore()
    applyHookEvent(store, registry, { hook_event_name: 'SessionEnd', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('done')
    applyHookEvent(store, registry, { hook_event_name: 'SessionStart', session_id: 's1' })
    expect(store.get('s1')!.status).toBe('active')
  })
})
