import { useState } from 'react'
import { Bell, BellOff, BellRing, Volume2, VolumeX } from 'lucide-react'
import { enable, isEnabled, permission, setEnabled, supported } from '../shared/notifications.js'
import { isChimeEnabled, primeChime, setChimeEnabled } from '../shared/chime.js'
import { FOCUS_RING } from '../shared/focus.js'

/**
 * The whole opt-in. Browsers only grant notification permission from a real
 * click, so there is nowhere else this could live — and one button is the whole
 * feature, so there is no settings panel to put it in.
 */
export function NotifyButton() {
  const [state, setState] = useState(() => ({ perm: permission(), on: isEnabled() }))
  const [chime, setChime] = useState(() => isChimeEnabled())

  if (!supported()) return null

  const label = state.perm === 'denied'
    ? 'notifications blocked in the browser'
    : state.perm !== 'granted'
      ? 'notify me when a session waits'
      : state.on ? 'notifications on' : 'notifications off'

  if (state.perm === 'denied') {
    return (
      <span data-testid="notify-toggle" className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-faint">
        <BellOff aria-hidden="true" className="size-3.5" />
        {label}
      </span>
    )
  }

  const click = async (): Promise<void> => {
    if (state.perm !== 'granted') {
      const granted = await enable()
      setState({ perm: permission(), on: granted })
      return
    }
    setEnabled(!state.on)
    setState({ perm: permission(), on: !state.on })
  }

  const clickChime = (): void => {
    const next = !chime
    // Creating/resuming the AudioContext must happen inside this click, or the
    // autoplay policy leaves it suspended and the first chime is silent.
    if (next) primeChime()
    setChimeEnabled(next)
    setChime(next)
  }

  // aria-pressed only once permission is granted: before that the control is a
  // one-shot request, and aria-pressed={false} would announce a toggle that
  // does not exist. No aria-label — it would override the visible text as the
  // accessible name and break voice control.
  return (
    <>
      <button
        data-testid="notify-toggle"
        {...(state.perm === 'granted' ? { 'aria-pressed': state.on } : {})}
        onClick={() => { void click() }}
        className={`inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-[7px] font-mono text-[11.5px] ${state.on ? 'text-neutral-200' : 'text-muted'} hover:bg-neutral-875 hover:text-neutral-200 ${FOCUS_RING}`}
      >
        {state.perm === 'granted' && state.on
          ? <BellRing aria-hidden="true" className="size-3.5" />
          : <Bell aria-hidden="true" className="size-3.5" />}
        {label}
      </button>
      {state.perm === 'granted' && state.on && (
        <button
          data-testid="chime-toggle"
          aria-pressed={chime}
          onClick={clickChime}
          className={`inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-[7px] font-mono text-[11.5px] ${chime ? 'text-neutral-200' : 'text-muted'} hover:bg-neutral-875 hover:text-neutral-200 ${FOCUS_RING}`}
        >
          {chime
            ? <Volume2 aria-hidden="true" className="size-3.5" />
            : <VolumeX aria-hidden="true" className="size-3.5" />}
          {chime ? 'sound on' : 'sound off'}
        </button>
      )}
    </>
  )
}
