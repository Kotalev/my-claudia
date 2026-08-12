/**
 * One focus treatment for the whole app. Every interactive element here
 * reveals itself with `hover:` only; a keyboard user got the UA hairline,
 * which is close to invisible against neutral-950.
 *
 * The radius is deliberately not part of this string — each element keeps its
 * own `rounded-*`, and the outline follows it.
 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
