/**
 * Opt-in audio chime, played only at the moment a desktop notification is
 * actually shown — never when the notification itself was suppressed.
 *
 * WebAudio, not an <audio> asset: two short sine tones need no file, and the
 * autoplay policy is satisfied by creating (or resuming) the AudioContext
 * inside the user's opt-in click via `primeChime`. Everything here is a no-op
 * where audio does not exist — the test environment is node.
 */

const STORAGE_KEY = 'mc.chime'

export function isChimeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false   // private mode, or storage disabled: off is the safe default
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch { /* nothing to do; the toggle simply will not persist */ }
}

let ctx: AudioContext | null = null

/**
 * Must be called from the opt-in click: an AudioContext created outside a user
 * gesture starts suspended, and some browsers never let it out again.
 */
export function primeChime(): void {
  if (typeof AudioContext === 'undefined') return
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
}

/** Two rising tones, ~0.3s total, at a gain nobody will jump at. */
export function playChime(): void {
  if (typeof AudioContext === 'undefined') return
  ctx ??= new AudioContext()
  const t0 = ctx.currentTime
  for (const [freq, at] of [[880, 0], [1174.66, 0.12]] as const) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t0 + at)
    gain.gain.exponentialRampToValueAtTime(0.1, t0 + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0 + at)
    osc.stop(t0 + at + 0.18)
  }
}
