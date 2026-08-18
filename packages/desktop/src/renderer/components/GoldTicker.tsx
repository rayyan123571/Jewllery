import { useEffect, useRef, useState } from 'react'
import { useLiveGold } from './useLiveGold.js'

/**
 * The live gold spot box — Dashboard only, display-only reference.
 *
 * Ported from GoldLab's `StatusBar` ticker: bid (bold, larger) and ask
 * (smaller, muted) side by side, flashing green on an uptick and red on a
 * downtick, fading back over ~600ms so a fast 1s feed still reads as motion
 * rather than a strobe. Stale grey ALWAYS wins over a flash — a dropped feed
 * must never keep ticking colour after it has stopped actually moving.
 *
 * This is the international XAUUSD spot, not the shop's own rate: the figure
 * every bill prices against is still the one typed onto the rate card beside
 * it. The title makes that explicit for anyone who hovers.
 */
export function GoldTicker() {
  const { bid, ask, prevBid, ok } = useLiveGold()
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    if (bid === null || prevBid === null || bid === prevBid) return undefined
    setFlash(bid > prevBid ? 'up' : 'down')
    const timer = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(timer)
  }, [bid, prevBid])

  // The dot never having gone green yet is a distinct state from having gone
  // grey again — both read the same here, which is the point: neither one has
  // a live figure to show right now.
  const everSeen = useRef(false)
  if (bid !== null) everSeen.current = true

  const state = !ok ? 'stale' : flash === 'up' ? 'up' : flash === 'down' ? 'down' : 'flat'

  return (
    <div
      className={`gold-ticker gold-ticker--${state}`}
      title="Live gold spot (bid / ask) — reference only, separate from the rate and every calculation"
      data-gold-ticker
    >
      <span className={`gold-ticker__dot${ok ? ' is-live' : ''}`} aria-hidden="true" />
      <span className="gold-ticker__label">Gold spot</span>
      <span className="gold-ticker__figures">
        <span className="gold-ticker__bid">{bid !== null ? bid.toFixed(2) : '—'}</span>
        <span className="gold-ticker__sep">/</span>
        <span className="gold-ticker__ask">{ask !== null ? ask.toFixed(2) : '—'}</span>
      </span>
      {!ok && everSeen.current ? <span className="gold-ticker__offline">offline</span> : null}
    </div>
  )
}
