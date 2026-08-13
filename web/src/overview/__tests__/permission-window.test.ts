import { describe, it, expect } from 'vitest'
import { WINDOW_MS, remainingMs } from '../permission-window.js'

describe('remainingMs', () => {
  const created = '2026-08-13T10:00:00.000Z'
  const start = Date.parse(created)

  it('counts down from the full window', () => {
    expect(remainingMs(created, start)).toBe(WINDOW_MS)
    expect(remainingMs(created, start + 5_000)).toBe(WINDOW_MS - 5_000)
  })

  it('clamps at zero once the window has lapsed', () => {
    expect(remainingMs(created, start + WINDOW_MS)).toBe(0)
    expect(remainingMs(created, start + WINDOW_MS + 60_000)).toBe(0)
  })

  it('treats an unparseable createdAt as already expired, so a broken card hides itself', () => {
    expect(remainingMs('not a date', start)).toBe(0)
    expect(remainingMs('', start)).toBe(0)
  })
})
