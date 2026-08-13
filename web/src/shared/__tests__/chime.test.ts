import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The chime module caches its AudioContext at module scope, so every test gets
 * a fresh copy via resetModules + dynamic import — the same reason each test
 * installs its own fakes on globalThis first.
 */

type G = Record<string, unknown>
const g = globalThis as G

interface FakeOsc {
  type: string
  frequency: { value: number }
  started: number | undefined
  stopped: number | undefined
}

function installFakeAudio(state = 'running'): { oscs: FakeOsc[]; resumed: () => number } {
  const made = { oscs: [] as FakeOsc[], resumes: 0 }
  class FakeAudioContext {
    state = state
    currentTime = 0
    destination = {}
    resume(): Promise<void> { made.resumes += 1; this.state = 'running'; return Promise.resolve() }
    createOscillator(): unknown {
      const osc: FakeOsc & { connect: (n: unknown) => unknown; start: (t: number) => void; stop: (t: number) => void } = {
        type: '', frequency: { value: 0 }, started: undefined, stopped: undefined,
        connect: (n: unknown) => n,
        start(t: number) { this.started = t },
        stop(t: number) { this.stopped = t },
      }
      made.oscs.push(osc)
      return osc
    }
    createGain(): unknown {
      return {
        gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: (n: unknown) => n,
      }
    }
  }
  g.AudioContext = FakeAudioContext
  return { oscs: made.oscs, resumed: () => made.resumes }
}

function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  }
  return store
}

async function load() {
  vi.resetModules()
  return import('../chime.js')
}

beforeEach(() => { vi.resetModules() })
afterEach(() => {
  delete g.AudioContext
  delete g.localStorage
  delete g.Notification
})

describe('the preference', () => {
  it('round-trips through localStorage', async () => {
    installStorage()
    const chime = await load()
    expect(chime.isChimeEnabled()).toBe(false)   // off until opted in
    chime.setChimeEnabled(true)
    expect(chime.isChimeEnabled()).toBe(true)
    chime.setChimeEnabled(false)
    expect(chime.isChimeEnabled()).toBe(false)
  })

  it('treats anything but "1" as off', async () => {
    const store = installStorage()
    store.set('mc.chime', 'yes please')
    const chime = await load()
    expect(chime.isChimeEnabled()).toBe(false)
  })

  it('defaults to off when storage throws', async () => {
    g.localStorage = {
      getItem: () => { throw new Error('private mode') },
      setItem: () => { throw new Error('private mode') },
    }
    const chime = await load()
    expect(chime.isChimeEnabled()).toBe(false)
    expect(() => { chime.setChimeEnabled(true) }).not.toThrow()
  })

  it('defaults to off when storage does not exist at all', async () => {
    const chime = await load()
    expect(chime.isChimeEnabled()).toBe(false)
    expect(() => { chime.setChimeEnabled(true) }).not.toThrow()
  })
})

describe('priming', () => {
  it('does nothing where audio does not exist', async () => {
    const chime = await load()
    expect(() => { chime.primeChime() }).not.toThrow()
  })

  it('resumes a suspended context inside the opt-in click', async () => {
    const audio = installFakeAudio('suspended')
    const chime = await load()
    chime.primeChime()
    expect(audio.resumed()).toBe(1)
  })
})

describe('playing', () => {
  it('does nothing where audio does not exist', async () => {
    const chime = await load()
    expect(() => { chime.playChime() }).not.toThrow()
  })

  it('schedules two tones, the whole thing under half a second', async () => {
    const audio = installFakeAudio()
    const chime = await load()
    chime.playChime()
    expect(audio.oscs).toHaveLength(2)
    const [a, b] = audio.oscs as [FakeOsc, FakeOsc]
    expect(b.frequency.value).toBeGreaterThan(a.frequency.value)   // rising, not a buzzer
    expect(b.started).toBeGreaterThan(a.started!)
    expect(Math.max(a.stopped!, b.stopped!)).toBeLessThanOrEqual(0.5)
  })

  it('reuses one AudioContext across plays', async () => {
    installFakeAudio()
    const counter = { n: 0 }
    const Base = g.AudioContext as new () => object
    g.AudioContext = class extends Base { constructor() { super(); counter.n += 1 } }
    const chime = await load()
    chime.playChime()
    chime.playChime()
    expect(counter.n).toBe(1)
  })
})

describe('coupling to the notification', () => {
  const session = (id: string): unknown =>
    ({ sessionId: id, projectPath: '/p/proj', live: { name: 'proj', waitingFor: 'you' } })

  beforeEach(() => {
    class FakeNotification {
      static permission = 'granted'
      constructor(_title: string, _opts?: unknown) {}
      close(): void {}
    }
    g.Notification = FakeNotification
  })

  it('chimes when the notification is shown and the chime is opted in', async () => {
    installStorage()
    const audio = installFakeAudio()
    vi.resetModules()
    const chime = await import('../chime.js')
    const { fire } = await import('../notifications.js')
    chime.setChimeEnabled(true)
    fire(session('s1') as never, () => {})
    expect(audio.oscs).toHaveLength(2)
  })

  it('stays silent when the chime was never opted in', async () => {
    installStorage()
    const audio = installFakeAudio()
    vi.resetModules()
    const { fire } = await import('../notifications.js')
    fire(session('s1') as never, () => {})
    expect(audio.oscs).toHaveLength(0)
  })

  it('stays silent when the notification itself is suppressed', async () => {
    installStorage()
    const audio = installFakeAudio()
    delete g.Notification   // supported() is false: no notification, so no sound
    vi.resetModules()
    const chime = await import('../chime.js')
    const { fire } = await import('../notifications.js')
    chime.setChimeEnabled(true)
    fire(session('s1') as never, () => {})
    expect(audio.oscs).toHaveLength(0)
  })
})
