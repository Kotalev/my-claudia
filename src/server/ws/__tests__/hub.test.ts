import { describe, it, expect, vi } from 'vitest'
import { EventHub } from '../hub.js'

const emptySnapshot = () => ({ projects: [], sessions: [], tasks: {}, planLimits: null })

describe('EventHub', () => {
  it('sends a full snapshot carrying the current sequence the moment a client connects', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    const msg = JSON.parse(send.mock.calls[0]![0] as string)
    expect(msg.type).toBe('snapshot')
    expect(msg.seq).toBe(0)   // the snapshot is the client's baseline, not an event
  })

  it('numbers broadcasts monotonically so clients can detect gaps', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'a' } as never })
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'b' } as never })
    const seqs = send.mock.calls.map(c => JSON.parse(c[0] as string).seq)
    expect(seqs).toEqual([0, 1, 2])
  })

  it('stops sending to a client after it disconnects', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    const disconnect = hub.addClient(send)
    disconnect()
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'a' } as never })
    expect(send).toHaveBeenCalledTimes(1)   // the snapshot only
  })

  it('re-sends a snapshot when a client reports a sequence gap', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    send.mockClear()
    hub.handleClientMessage(JSON.stringify({ type: 'resnapshot' }), send)
    expect(JSON.parse(send.mock.calls[0]![0] as string).type).toBe('snapshot')
  })

  it('answers a ping with a pong', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send); send.mockClear()
    hub.handleClientMessage(JSON.stringify({ type: 'ping' }), send)
    expect(JSON.parse(send.mock.calls[0]![0] as string).type).toBe('pong')
  })

  it('ignores a malformed client message instead of throwing', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send); send.mockClear()
    expect(() => hub.handleClientMessage('not json', send)).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('drops a client whose send throws rather than failing the broadcast', () => {
    const hub = new EventHub(emptySnapshot)
    const bad = vi.fn(() => { throw new Error('socket closed') })
    const good = vi.fn()
    hub.addClient(bad)
    hub.addClient(good)
    expect(() => hub.broadcast({ type: 'session.updated', session: {} as never })).not.toThrow()
    expect(good).toHaveBeenCalledTimes(2)
  })
})

describe('EventHub — sequence isolation', () => {
  it('does not desync existing clients when a new client connects', () => {
    const hub = new EventHub(emptySnapshot)
    const a = vi.fn()
    hub.addClient(a)
    hub.broadcast({ type: 'session.updated', session: {} as never })
    a.mockClear()

    hub.addClient(vi.fn())          // B's snapshot must not consume a sequence number
    hub.broadcast({ type: 'session.updated', session: {} as never })

    const seqs = a.mock.calls.map(c => JSON.parse(c[0] as string).seq)
    expect(seqs).toEqual([2])       // A saw 1 then 2: contiguous, no gap
  })

  it('does not desync other clients when one is answered with a pong', () => {
    const hub = new EventHub(emptySnapshot)
    const a = vi.fn()
    const b = vi.fn()
    hub.addClient(a)
    hub.addClient(b)
    hub.broadcast({ type: 'session.updated', session: {} as never })
    a.mockClear()

    hub.handleClientMessage(JSON.stringify({ type: 'ping' }), b)
    hub.broadcast({ type: 'session.updated', session: {} as never })

    const seqs = a.mock.calls.map(c => JSON.parse(c[0] as string).seq)
    expect(seqs).toEqual([2])
  })

  it('gives a resnapshot the current sequence so the client resyncs exactly', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    hub.broadcast({ type: 'session.updated', session: {} as never })
    send.mockClear()

    hub.handleClientMessage(JSON.stringify({ type: 'resnapshot' }), send)
    const snap = JSON.parse(send.mock.calls[0]![0] as string)
    expect(snap.type).toBe('snapshot')
    expect(snap.seq).toBe(1)        // matches the last broadcast, not one past it
  })
})
