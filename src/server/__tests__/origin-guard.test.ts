import { describe, it, expect } from 'vitest'
import { isAllowedHost, isAllowedOrigin } from '../origin-guard.js'

describe('isAllowedHost', () => {
  it('accepts the loopback host the server binds to', () => {
    expect(isAllowedHost('127.0.0.1:4517')).toBe(true)
    expect(isAllowedHost('localhost:4517')).toBe(true)
    expect(isAllowedHost('[::1]:4517')).toBe(true)
  })

  it('accepts the vite dev origin host', () => {
    expect(isAllowedHost('127.0.0.1:4518')).toBe(true)
    expect(isAllowedHost('localhost:4518')).toBe(true)
  })

  it('rejects a rebound external hostname pointing at loopback', () => {
    expect(isAllowedHost('evil.tld:4517')).toBe(false)
    expect(isAllowedHost('attacker.example.com')).toBe(false)
  })

  it('rejects a hostname that merely contains localhost', () => {
    expect(isAllowedHost('localhost.evil.tld:4517')).toBe(false)
    expect(isAllowedHost('notlocalhost:4517')).toBe(false)
  })

  it('rejects a missing host header', () => {
    expect(isAllowedHost(undefined)).toBe(false)
    expect(isAllowedHost('')).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  it('allows a request with no Origin (curl, same-origin navigation)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
  })

  it('allows loopback origins', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4518')).toBe(true)
    expect(isAllowedOrigin('http://localhost:4517')).toBe(true)
  })

  it('rejects a remote page opening a socket to the dashboard', () => {
    expect(isAllowedOrigin('https://evil.tld')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.tld')).toBe(false)
  })

  it('rejects an unparseable origin', () => {
    expect(isAllowedOrigin('not a url')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
  })
})
