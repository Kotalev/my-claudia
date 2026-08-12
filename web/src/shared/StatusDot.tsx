import type { SessionStatus } from './types.js'
import { STATUS_LABELS } from './format.js'

const SIZES = {
  sm: { box: 'size-[11px]', core: 'size-1.5', ring: '-inset-0.5' },
  md: { box: 'size-3.5', core: 'size-2', ring: '-inset-[3px]' },
} as const

/**
 * The status indicator, redesigned so motion encodes state (the redesign's
 * core request): working ORBITS — a green dot with a ring in calm rotation;
 * waiting PULSES — an amber ping that reads from across the room; idle is a
 * static filled dot; done is a static outline. Reduced motion strips the
 * animation globally (index.css) and colour + form still carry the state.
 *
 * `labelled` is for callers that already print STATUS_LABELS as visible text;
 * they get the indicator without a duplicate announcement. `sr-only` is
 * absolutely positioned, so it stays out of flex flow and adds no gap.
 */
export function StatusDot(
  { status, labelled = false, size = 'md', className = '' }:
  { status: SessionStatus; labelled?: boolean; size?: 'sm' | 'md'; className?: string },
) {
  const s = SIZES[size]

  let visual
  switch (status) {
    case 'active':
      visual = (
        <span aria-hidden="true" className={`relative shrink-0 ${s.box} ${className}`} title={STATUS_LABELS[status]}>
          <span className={`absolute ${s.ring} animate-orbit rounded-full border-[1.5px] border-transparent border-t-work border-r-work/30`} />
          <span className={`absolute top-1/2 left-1/2 ${s.core} -translate-1/2 rounded-full bg-work shadow-[0_0_8px_rgb(61_220_132/0.55)]`} />
        </span>
      )
      break
    case 'waiting':
      visual = (
        <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center ${s.box} ${className}`} title={STATUS_LABELS[status]}>
          <span className={`absolute ${s.core} animate-pulse-ping rounded-full bg-alarm`} />
          <span className={`relative ${s.core} rounded-full bg-alarm`} />
        </span>
      )
      break
    case 'done':
      visual = (
        <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${s.box} ${className}`} title={STATUS_LABELS[status]}>
          <span className={`${s.core} rounded-full border-[1.5px] border-dim`} />
        </span>
      )
      break
    default: // idle
      visual = (
        <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${s.box} ${className}`} title={STATUS_LABELS[status]}>
          <span className={`${s.core} rounded-full bg-neutral-500`} />
        </span>
      )
  }

  return (
    <>
      {visual}
      {!labelled && <span className="sr-only">{STATUS_LABELS[status]}</span>}
    </>
  )
}
