import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The one modal wrapper. Every dialog in the application uses it, so the
 * keyboard contract is written once rather than remembered five times.
 *
 * What it guarantees:
 *
 *   - **Escape closes.** Always, from anywhere inside.
 *   - **Enter confirms**, unless the caret is in a textarea, where Enter is a
 *     newline and stealing it would be indefensible.
 *   - **Focus is trapped.** Tab and Shift+Tab cycle within the dialog. Without
 *     this, Tab walks out into the screen behind — which is still rendered,
 *     still focusable, and now unreachable by the eye.
 *   - **Focus returns to whatever opened it.** Otherwise closing a dialog drops
 *     the caret at the top of the document and a keyboard operator has to find
 *     their place again.
 *
 * The backdrop deliberately does NOT close on click. These dialogs contain
 * typed data, and a misplaced click that silently discards a half-entered party
 * is a worse failure than an extra keystroke on Escape.
 */
export function Modal({
  label,
  onClose,
  onConfirm,
  wide = false,
  children,
}: {
  label: string
  onClose: () => void
  onConfirm?: () => void
  wide?: boolean
  children: ReactNode
}) {
  const card = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    // First focusable inside, so the keyboard starts in the dialog rather than
    // wherever it happened to be on the screen behind.
    const first = focusable(card.current)[0]
    first?.focus()
    return () => opener.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'Enter' && onConfirm) {
        const target = event.target as HTMLElement | null
        // Enter in a textarea is a newline; in a button it is that button.
        if (target?.tagName === 'TEXTAREA' || target?.tagName === 'BUTTON') return
        event.preventDefault()
        onConfirm()
        return
      }

      if (event.key === 'Tab') {
        const items = focusable(card.current)
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (!first || !last) return
        const active = document.activeElement
        if (event.shiftKey && (active === first || !card.current?.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, onConfirm])

  return (
    <div className="modal">
      <div
        className={`modal__card${wide ? ' modal__card--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={card}
      >
        {children}
      </div>
    </div>
  )
}

function focusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null)
}
