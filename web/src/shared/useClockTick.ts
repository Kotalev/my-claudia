import { useEffect, useState } from 'react'

/**
 * Every relative timestamp in this app — `relativeTime`, `elapsed`, `agoLabel`,
 * `measuredAgo` — is computed at render, and a render only happens when a
 * socket message arrives. On a quiet machine a row goes on claiming "just now"
 * indefinitely, which turns the deliberate honesty caveats into the confident
 * lie they were written to prevent.
 *
 * 30s, so a "just now" (the sub-minute bucket in format.ts) can never be more
 * than one bucket stale.
 */
export function useClockTick(ms = 30_000): void {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}
