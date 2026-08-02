import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Inline "ghost" autocomplete, carried across from the reference implementation
 * (GoldLab `src/components/GhostNameInput.jsx`).
 *
 * The technique: a mirror <div> and the real <input> share the SAME class, so
 * every box metric — font, size, weight, letter-spacing, line-height, padding,
 * border — matches automatically. The input is then made transparent inline (an
 * inline style always beats class specificity), so the mirror's grey completion
 * shows through, aligned exactly after the typed text.
 *
 * The behaviour rules are the reference's, and each one is there for a reason:
 *
 *   - **Prefix matches only.** A completion that appears mid-word is worse than
 *     none: the operator cannot predict it, so they stop trusting it.
 *   - **Tab or Right-Arrow accepts.** Never Enter — Enter submits, and a
 *     completion the operator had not noticed must not be able to ride along
 *     with a save.
 *   - **Backspace never completes.** Deleting is how you escape a suggestion;
 *     re-suggesting the thing being deleted traps the user in it.
 */
export function GhostInput({
  value,
  onChange,
  onAccept,
  suggestions,
  className,
  placeholder,
  inputRef,
  onKeyDown,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  onAccept?: (accepted: string) => void
  /** Candidate completions. Only prefix matches are offered. */
  suggestions: readonly string[]
  className?: string
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  const [ghost, setGhost] = useState('')
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const previousLength = useRef(value.length)

  useEffect(() => {
    const grew = value.length > previousLength.current
    previousLength.current = value.length

    // Deleting must never re-suggest, or the user cannot escape the completion.
    if (!grew || value.trim() === '') {
      setGhost('')
      return
    }

    const lower = value.toLowerCase()
    const match = suggestions.find(
      (candidate) =>
        candidate.toLowerCase().startsWith(lower) && candidate.length > value.length,
    )
    setGhost(match ?? '')
  }, [value, suggestions])

  const accept = (): void => {
    if (!ghost) return
    onChange(ghost)
    onAccept?.(ghost)
    setGhost('')
  }

  const completion = ghost ? ghost.slice(value.length) : ''

  return (
    <span className="ghost">
      {/* The mirror. Shares the input's class so its metrics match exactly. */}
      <span className={`${className ?? ''} ghost__mirror`} aria-hidden="true">
        <span className="ghost__typed">{value}</span>
        <span className="ghost__completion">{completion}</span>
      </span>
      <input
        ref={ref}
        className={className}
        // Inline, so it beats any class the caller passes.
        style={{ background: 'transparent', position: 'relative' }}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.key === 'Tab' || event.key === 'ArrowRight') && ghost) {
            event.preventDefault()
            accept()
            return
          }
          onKeyDown?.(event)
        }}
        onBlur={() => setGhost('')}
      />
    </span>
  )
}
