import { useEffect, useRef, type ReactNode } from 'react'

/**
 * In-app replacement for window.prompt/confirm. Built on the native <dialog>
 * element: showModal() gives focus trapping, Escape-to-close, and inert
 * background for free — onClose fires for every way out.
 */
export function Modal({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    // The close event is dispatched async: a stale one from StrictMode's dev
    // remount can land after showModal() reopened the dialog. Only a dialog
    // that is really closed counts.
    const handleClose = () => { if (!dialog.open) onCloseRef.current() }
    dialog.addEventListener('close', handleClose)
    return () => {
      // Listener off before close(): StrictMode's dev remount runs this
      // cleanup, and its close event must not count as the user closing.
      dialog.removeEventListener('close', handleClose)
      dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      data-testid="modal"
      // A click on the dialog element itself (not its content) is a click on
      // the backdrop: ::backdrop swallows no events, they land on the dialog.
      onClick={e => { if (e.target === ref.current) ref.current?.close() }}
      className="m-auto w-full max-w-md rounded-[10px] border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop:bg-black/60"
    >
      <div className="space-y-3 p-5">
        <h2 className="font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase text-faint">{title}</h2>
        {children}
      </div>
    </dialog>
  )
}
