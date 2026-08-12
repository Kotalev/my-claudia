import type { ReactNode } from 'react'

/**
 * The one horizontal measure in the app. `page` for the dashboards, where
 * density is the point; `reading` for the transcript, where line length is.
 */
export function Container(
  { width = 'page', className = '', children }:
  { width?: 'page' | 'reading'; className?: string; children: ReactNode },
) {
  const measure = width === 'reading' ? 'max-w-reading' : 'max-w-page'
  return <div className={`mx-auto w-full ${measure} ${className}`}>{children}</div>
}

/**
 * The screen shell: dark ground, one padding scale, one centred measure. The
 * padding was a flat `p-8`, which spent a sixth of a 390px viewport on margin
 * and was the only structure a 1440px one had.
 *
 * `min-h-dvh` rather than `min-h-screen`: 100vh on mobile Safari is taller
 * than the visible area, which leaves a scroll jump.
 */
export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-neutral-950 p-4 text-neutral-100 sm:p-6 lg:p-8">
      <Container>{children}</Container>
    </main>
  )
}
