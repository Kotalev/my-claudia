import type { ReactNode } from 'react'

/**
 * A failure the user caused by clicking something. `role="alert"` because it
 * is mounted in response to that click — without it a screen-reader user
 * hears nothing at all where the explanation is.
 */
export function ErrorLine(
  { testId, className = '', children }:
  { testId: string; className?: string; children: ReactNode },
) {
  return (
    <p role="alert" data-testid={testId} className={`text-sm text-red-300 ${className}`}>
      {children}
    </p>
  )
}
