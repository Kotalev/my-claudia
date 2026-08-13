import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INTERVAL_MS, startAlerts, type AlertDeps } from '../index.js'
import type { SessionStatus, SessionSummary } from '../../../shared/types.js'

/** Only the fields the alerter reads; the rest of the summary is irrelevant here. */
function session(
  id: string,
  status: SessionStatus,
  statusUpdatedAt: string | null,
  projectPath: string | null = null,
): SessionSummary {
  return {
    sessionId: id,
    status,
    projectPath,
    live: statusUpdatedAt === null ? null : { statusUpdatedAt },
  } as unknown as SessionSummary
}

function deps(overrides: Partial<AlertDeps> = {}): AlertDeps {
  return {
    getSessions: () => [],
    getFiveHour: () => null,
    ...overrides,
  }
}

/** ISO timestamp `minutes` before the (fake) clock's now. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

describe('startAlerts', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let running: { stop(): void }[]

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    process.env.MC_WEBHOOK_URL = 'http://127.0.0.1:9/hook'
    delete process.env.MC_ALERT_WAITING_MIN
    running = []
  })

  afterEach(() => {
    for (const r of running) r.stop()
    delete process.env.MC_WEBHOOK_URL
    delete process.env.MC_ALERT_WAITING_MIN
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function start(d: AlertDeps): void {
    running.push(startAlerts(d))
  }

  async function tick(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
  }

  function bodies(): { type: string; [k: string]: unknown }[] {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
  }

  it('is inert without MC_WEBHOOK_URL', async () => {
    delete process.env.MC_WEBHOOK_URL
    const getSessions = vi.fn(() => [session('s1', 'waiting', minutesAgo(60))])
    start(deps({ getSessions }))
    await tick(5)
    expect(getSessions).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fires one waiting alert per episode, not per tick', async () => {
    const s = session('abcd1234-rest', 'waiting', minutesAgo(6), '/home/u/proj')
    start(deps({ getSessions: () => [s] }))
    await tick(4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = bodies()[0]!
    expect(body.type).toBe('waiting')
    expect(body.sessionId).toBe('abcd1234-rest')
    expect(body.project).toBe('/home/u/proj')
    expect(typeof body.text).toBe('string')
    expect(typeof body.at).toBe('string')
  })

  it('does not fire before the waiting threshold', async () => {
    start(deps({ getSessions: () => [session('s1', 'waiting', minutesAgo(2))] }))
    await tick(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honours MC_ALERT_WAITING_MIN', async () => {
    process.env.MC_ALERT_WAITING_MIN = '1'
    start(deps({ getSessions: () => [session('s1', 'waiting', minutesAgo(2))] }))
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-arms when the session leaves waiting and fires for the next episode', async () => {
    let current = session('s1', 'waiting', minutesAgo(10))
    start(deps({ getSessions: () => [current] }))
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    current = session('s1', 'active', null)
    await tick()
    current = session('s1', 'waiting', minutesAgo(10))
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips a waiting session whose live process has no statusUpdatedAt', async () => {
    start(deps({ getSessions: () => [session('s1', 'waiting', null)] }))
    await tick(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fires one limit alert per 5h window and re-arms below 80', async () => {
    let pct = 92
    start(deps({ getFiveHour: () => ({ usedPercentage: pct }) }))
    await tick(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies()[0]).toMatchObject({ type: 'limit', usedPercentage: 92 })

    pct = 85   // dipped, but not below the re-arm line
    await tick()
    pct = 95
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    pct = 10   // window rolled over
    await tick()
    pct = 91
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('survives a network failure, cools down 60s, then retries the same episode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    start(deps({ getSessions: () => [session('s1', 'waiting', minutesAgo(10))] }))

    await tick()   // attempt fails
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)

    await tick()   // 30s later: still cooling down, no attempt
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await tick()   // 60s past the failure: retries and succeeds
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies()[1]).toMatchObject({ type: 'waiting', sessionId: 's1' })

    await tick(2)  // delivered once — the episode does not fire again
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('degrades on malformed deps output instead of crashing', async () => {
    start(deps({
      getSessions: () => null as unknown as SessionSummary[],
      getFiveHour: () => ({ usedPercentage: 'lots' as unknown as number }),
    }))
    await tick(2)
    expect(fetchMock).not.toHaveBeenCalled()

    start(deps({
      getSessions: () => { throw new Error('store gone') },
      getFiveHour: () => { throw new Error('no limits') },
    }))
    await tick(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stop() ends the checking', async () => {
    const handle = startAlerts(deps({ getSessions: () => [session('s1', 'waiting', minutesAgo(10))] }))
    handle.stop()
    await tick(3)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
