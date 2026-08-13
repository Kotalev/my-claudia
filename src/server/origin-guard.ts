/**
 * Loopback binding alone does not make a local server private:
 *
 * - DNS rebinding lets a remote page resolve its own hostname to 127.0.0.1 and
 *   then read our responses as same-origin, so the Host header must be checked.
 * - WebSockets are exempt from the same-origin policy and send no preflight, so
 *   any page the user visits could otherwise open /ws and receive the snapshot.
 *
 * SPEC.md section 4 waives auth *because* the server is loopback-only; these
 * checks are what makes that reasoning hold.
 *
 * MC_HOST widens this: a non-loopback bind adds the configured host to the
 * allowlist, and a wildcard bind (0.0.0.0 / ::) accepts any host, because the
 * Host header then carries whichever LAN address the client dialed. In both
 * cases the token stays mandatory — it is the only key on a non-loopback bind.
 */

import { HOST } from '../shared/config.js'

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

/** IPv6 literals arrive bracketed in Host/Origin but MC_HOST is written bare. */
function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function hostnameOf(hostHeader: string): string {
  // Strip the port, handling bracketed IPv6 literals.
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1)
  const colon = hostHeader.lastIndexOf(':')
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon)
}

export function isAllowedHost(hostHeader: string | undefined, boundHost: string = HOST): boolean {
  if (!hostHeader) return false
  if (WILDCARD_HOSTS.has(boundHost)) return true
  const hostname = hostnameOf(hostHeader)
  return ALLOWED_HOSTNAMES.has(hostname) || unbracket(hostname) === unbracket(boundHost)
}

export function isAllowedOrigin(origin: string | undefined, boundHost: string = HOST): boolean {
  // No Origin at all is a non-browser client (curl) or a same-origin navigation.
  if (origin === undefined) return true
  if (WILDCARD_HOSTS.has(boundHost)) return true
  try {
    const hostname = new URL(origin).hostname
    return ALLOWED_HOSTNAMES.has(hostname) || unbracket(hostname) === unbracket(boundHost)
  } catch {
    return false
  }
}
