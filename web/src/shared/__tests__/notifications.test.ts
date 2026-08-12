import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  shouldNotify, fire, reconcile, STALE_MS, COOLDOWN_MS, type NotifyDecision,
} from '../notifications.js'
import type { SessionSummary } from '../types.js'

const NOW = Date.parse('2026-08-12T12:00:00.000Z')

function decision(over: Partial<NotifyDecision> = {}): NotifyDecision {
  return {
    prev: 'active',
    next: 'waiting',
    kind: 'interactive',
    statusUpdatedAt: new Date(NOW - 1000).toISOString(),
    enabled: true,
    permission: 'granted',
    lastNotifiedAt: undefined,
    now: NOW,
    focused: false,
    ...over,
  }
}

describe('shouldNotify — the case it exists for', () => {
  it('fires when a session blocks on the user', () => {
    expect(shouldNotify(decision())).toBe(true)
  })

  it('fires for a tab in the background', () => {
    expect(shouldNotify(decision({ focused: false }))).toBe(true)
  })
})

describe('shouldNotify — silence', () => {
  it('says nothing when the user never opted in', () => {
    expect(shouldNotify(decision({ enabled: false }))).toBe(false)
  })

  it('says nothing without permission', () => {
    expect(shouldNotify(decision({ permission: 'default' }))).toBe(false)
    expect(shouldNotify(decision({ permission: 'denied' }))).toBe(false)
  })

  it('says nothing for a status that is not waiting', () => {
    for (const next of ['active', 'idle', 'done'] as const) {
      expect(shouldNotify(decision({ next }))).toBe(false)
    }
  })

  it('says nothing the first time it sees a session', () => {
    // The snapshot seeds the table on connect and on every reconnect. Firing here
    // would mean a burst of notifications for blocks the user already knows about.
    expect(shouldNotify(decision({ prev: undefined }))).toBe(false)
  })

  it('says nothing when the session was already waiting', () => {
    expect(shouldNotify(decision({ prev: 'waiting' }))).toBe(false)
  })

  it('says nothing for a background agent', () => {
    expect(shouldNotify(decision({ kind: 'background' }))).toBe(false)
  })

  it('says nothing when the transition cannot be dated', () => {
    expect(shouldNotify(decision({ statusUpdatedAt: null }))).toBe(false)
    expect(shouldNotify(decision({ statusUpdatedAt: 'not a date' }))).toBe(false)
  })

  it('says nothing about a prompt that has been open all afternoon', () => {
    expect(shouldNotify(decision({ statusUpdatedAt: new Date(NOW - 10 * 60 * 1000).toISOString() }))).toBe(false)
  })

  it('says nothing about the session the user is looking at', () => {
    expect(shouldNotify(decision({ focused: true }))).toBe(false)
  })

  it('does not repeat itself inside the cooldown', () => {
    expect(shouldNotify(decision({ prev: 'active', lastNotifiedAt: NOW - 5_000 }))).toBe(false)
  })
})

describe('shouldNotify — boundaries', () => {
  it('fires at exactly the staleness limit', () => {
    expect(shouldNotify(decision({ statusUpdatedAt: new Date(NOW - STALE_MS).toISOString() }))).toBe(true)
  })

  it('fires at exactly the cooldown', () => {
    expect(shouldNotify(decision({ lastNotifiedAt: NOW - COOLDOWN_MS }))).toBe(true)
  })

  it('tolerates a timestamp from the future rather than treating it as stale', () => {
    expect(shouldNotify(decision({ statusUpdatedAt: new Date(NOW + 30_000).toISOString() }))).toBe(true)
  })
})

describe('withdrawing what is no longer true', () => {
  interface Fake { tag: string; closed: boolean }
  let fired: Fake[]

  beforeEach(() => {
    fired = []
    class FakeNotification {
      permission = 'granted'
      closed = false
      tag: string
      constructor(_title: string, opts?: { tag?: string }) {
        this.tag = opts?.tag ?? ''
        fired.push(this as unknown as Fake)
      }
      close(): void { this.closed = true }
    }
    ;(globalThis as Record<string, unknown>).Notification = FakeNotification
  })
  afterEach(() => { delete (globalThis as Record<string, unknown>).Notification })

  const session = (id: string): SessionSummary =>
    ({ sessionId: id, projectPath: '/p/proj', live: { name: 'proj', waitingFor: 'you' } } as unknown as SessionSummary)

  it('closes a notification whose session is no longer waiting in the snapshot', () => {
    fire(session('s1'), () => {})
    expect(fired).toHaveLength(1)

    // The user answered in the terminal while this tab was disconnected, so the
    // transition out of waiting was never delivered as a delta.
    reconcile([])
    expect(fired[0]!.closed).toBe(true)
  })

  it('leaves a session that is still waiting alone', () => {
    fire(session('s1'), () => {})
    reconcile(['s1'])
    expect(fired[0]!.closed).toBe(false)
  })

  it('closes one and keeps the other', () => {
    fire(session('s1'), () => {})
    fire(session('s2'), () => {})
    reconcile(['s2'])
    expect(fired.map(f => f.closed)).toEqual([true, false])
  })

  it('does nothing when there is nothing open', () => {
    expect(() => { reconcile(['s1']) }).not.toThrow()
  })
})
