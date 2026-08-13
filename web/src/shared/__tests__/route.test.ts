import { describe, expect, it } from 'vitest'
import { parseRoute, pathFor, type Route } from '../route.js'

describe('parseRoute — the shapes the app produces', () => {
  it('reads a project', () => {
    expect(parseRoute('/p/abc')).toEqual({ projectId: 'abc', sessionId: null })
  })

  it('reads a session opened from the overview', () => {
    expect(parseRoute('/s/sess-1')).toEqual({ projectId: null, sessionId: 'sess-1' })
  })

  it('reads a session opened from inside a project', () => {
    expect(parseRoute('/p/abc/s/sess-1')).toEqual({ projectId: 'abc', sessionId: 'sess-1' })
  })

  it('reads the overview', () => {
    expect(parseRoute('/')).toEqual({ projectId: null, sessionId: null })
  })

  it('reads the history screen', () => {
    expect(parseRoute('/history')).toEqual({ projectId: null, sessionId: null, history: true })
  })

  it('reads the digest screen, with or without trailing junk', () => {
    expect(parseRoute('/digest')).toEqual({ projectId: null, sessionId: null, digest: true })
    expect(parseRoute('/digest/junk')).toEqual({ projectId: null, sessionId: null, digest: true })
  })
})

describe('parseRoute — malformed input degrades, never throws', () => {
  it('reads an empty path as the overview', () => {
    expect(parseRoute('')).toEqual({ projectId: null, sessionId: null })
  })

  it('reads a bare prefix with no id as no id', () => {
    expect(parseRoute('/p/')).toEqual({ projectId: null, sessionId: null })
    expect(parseRoute('/s/')).toEqual({ projectId: null, sessionId: null })
  })

  it('ignores a path it does not recognise', () => {
    expect(parseRoute('/nonsense/deep/path')).toEqual({ projectId: null, sessionId: null })
  })

  it('ignores trailing junk after a session id', () => {
    expect(parseRoute('/p/abc/s/sess-1/junk/more')).toEqual({ projectId: 'abc', sessionId: 'sess-1' })
  })

  it('only matches a project at the start of the path', () => {
    expect(parseRoute('/x/p/abc').projectId).toBeNull()
  })

  it('keeps a malformed percent-escape verbatim rather than throwing', () => {
    expect(parseRoute('/p/%E0%A4%A')).toEqual({ projectId: '%E0%A4%A', sessionId: null })
  })
})

describe('pathFor', () => {
  it('builds every combination', () => {
    expect(pathFor({ projectId: null, sessionId: null })).toBe('/')
    expect(pathFor({ projectId: 'abc', sessionId: null })).toBe('/p/abc')
    expect(pathFor({ projectId: null, sessionId: 's1' })).toBe('/s/s1')
    expect(pathFor({ projectId: 'abc', sessionId: 's1' })).toBe('/p/abc/s/s1')
    expect(pathFor({ projectId: null, sessionId: null, history: true })).toBe('/history')
    expect(pathFor({ projectId: null, sessionId: null, digest: true })).toBe('/digest')
  })
})

describe('round trip', () => {
  const routes: Route[] = [
    { projectId: null, sessionId: null },
    { projectId: 'abc', sessionId: null },
    { projectId: null, sessionId: '13f5f648-f06d-47c9-b4ab-80730e9c0325' },
    { projectId: 'abc', sessionId: 'sess-1' },
    // Ids are server-generated hashes today, but nothing guarantees they stay
    // path-safe, and a slash would silently reparse as a different route.
    { projectId: 'a/b c', sessionId: 'x?y#z' },
  ]

  for (const route of routes) {
    it(`survives ${JSON.stringify(route)}`, () => {
      expect(parseRoute(pathFor(route))).toEqual(route)
    })
  }
})
