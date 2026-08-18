import { useEffect, useState } from 'react'
import type { LiveGoldDto } from '../../shared/ipc.js'

/** What the hook exposes: bid/ask plus the PREVIOUS bid, so a caller can flash on the tick. */
export interface LiveGoldState {
  readonly bid: number | null
  readonly ask: number | null
  readonly prevBid: number | null
  readonly ok: boolean
}

const INITIAL: LiveGoldState = { bid: null, ask: null, prevBid: null, ok: false }

/**
 * The live gold spot ticker's state — ported from GoldLab's `useLiveGold`.
 *
 * Subscribes to main's poll pushes and keeps the previous bid so the UI can
 * tick green/red. bid/ask stay at the LAST GOOD values when the feed drops
 * (`ok` goes false); both are null until a first value ever arrives.
 *
 * Guarded for a `window.api` that has no `liveGold` — an older preload during
 * a rolling update, or a test harness that never mounts the Dashboard for
 * real. Either way the box just shows "--" instead of throwing.
 */
export function useLiveGold(): LiveGoldState {
  const [state, setState] = useState<LiveGoldState>(INITIAL)

  useEffect(() => {
    const api = window.api?.liveGold
    if (!api) return undefined
    let mounted = true

    const apply = (data: LiveGoldDto | null): void => {
      if (!mounted || !data) return
      setState((old) => ({
        bid: data.bid,
        ask: data.ask,
        prevBid: old.bid,
        ok: data.ok,
      }))
    }

    const off = api.onUpdate(apply)
    // Seed immediately with one fetch instead of waiting for the next poll push.
    void api.get().then(apply).catch(() => {})
    return () => {
      mounted = false
      off()
    }
  }, [])

  return state
}
