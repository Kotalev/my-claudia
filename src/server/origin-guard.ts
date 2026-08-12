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
 */

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function hostnameOf(hostHeader: string): string {
  // Strip the port, handling bracketed IPv6 literals.
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1)
  const colon = hostHeader.lastIndexOf(':')
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon)
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  return ALLOWED_HOSTNAMES.has(hostnameOf(hostHeader))
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  // No Origin at all is a non-browser client (curl) or a same-origin navigation.
  if (origin === undefined) return true
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname)
  } catch {
    return false
  }
}
