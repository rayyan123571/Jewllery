import { useEffect, useRef, useState } from 'react'

/**
 * A debounced type-ahead lookup, written once.
 *
 * The party selector and the retail customer selector need exactly the same
 * behaviour — a fast typist must fire one query, not one per keystroke, and an
 * empty box must return nothing rather than the whole list. This is that
 * behaviour, extracted so there is one implementation of it rather than two
 * that drift.
 *
 * Two details that matter and are easy to get wrong the second time:
 *
 *   - **An empty term returns nothing, immediately.** A type-ahead that dumps
 *     every customer on focus is slower to use than one that waits for a letter.
 *   - **The search function is held in a ref.** A caller passing an inline
 *     arrow would otherwise change its identity every render, the effect would
 *     re-run, and the debounce it exists to provide would never fire.
 */
export function useDebouncedSearch<T>(
  term: string,
  search: (term: string) => Promise<readonly T[]>,
  delayMs = 150,
): readonly T[] {
  const [matches, setMatches] = useState<readonly T[]>([])
  const latest = useRef(search)
  latest.current = search

  useEffect(() => {
    if (term.trim().length === 0) {
      setMatches([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void latest.current(term).then((found) => {
        // A reply that arrives after the term moved on would repopulate the
        // list with matches for text the operator has already deleted.
        if (!cancelled) setMatches(found)
      })
    }, delayMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, delayMs])

  return matches
}
