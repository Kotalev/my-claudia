import { describe, it, expect, vi } from 'vitest'
import { EventHub } from '../hub.js'

const emptySnapshot = () => ({ projects: [], sessions: [], tasks: {} })

describe('EventHub', () => {
  it('sends a full snapshot as seq 1 the moment a client connects', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    const msg = JSON.parse(send.mock.calls[0]![0] as string)
    expect(msg.type).toBe('snapshot')
    expect(msg.seq).toBe(1)
  })

  it('numbers broadcasts monotonically so clients can detect gaps', () => {
    const hub = new EventHub(emptySnapshot)
    const send = vi.fn()
    hub.addClient(send)
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'a' } as never })
    hub.broadcast({ type: 'session.updated', session: { sessionId: 'b' } as never })
    const seqs = send.mock.calls.map(c => JSON.parse(c[0] as string).seq)
    expect(seqs).toEqual([1, 2, 3])
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
