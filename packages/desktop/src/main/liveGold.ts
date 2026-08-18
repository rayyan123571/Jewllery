import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import type { BrowserWindow } from 'electron'
import { IPC_M2, type LiveGoldDto } from '../shared/ipc.js'

/**
 * The live gold spot ticker — display-only reference, ported from the GoldLab
 * reference implementation's `electron/liveGold.cjs`.
 *
 * Fetches the XAUUSD spot as JSON in the MAIN process (the renderer would hit
 * CORS) from a fast quote feed, sanity-gates it, and pushes {bid, ask, ts, ok}
 * to the window on every tick — near real-time, MT5 Market-Watch style.
 *
 * It touches NOTHING the shop's figures depend on: not `gold_rates`, not any
 * calculation, not a receipt. The 24K rate on the Dashboard is still the one
 * the shop types, per DECISIONS — this is a second, independent number shown
 * beside it so the shop can see the international market move without leaving
 * the screen. See RateCard's own comment for why the typed rate stays typed.
 *
 * Robustness rules (kept exactly as GoldLab found them): on ANY failure, keep
 * the last good value (`ok: false` so the UI can greet it as stale rather than
 * drop it); never let a bad number through (1000 < price < 20000 — the sane
 * range for an XAUUSD spot, wildly outside what a parse failure or a wrong feed
 * would return); never block or delay startup (the first poll fires only after
 * the window has finished loading); log a warning once per outage, not once
 * per second.
 */

const PRIMARY_URL =
  process.env.JEWELLERY_GOLD_URL ??
  'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD'
const FALLBACK_URL =
  process.env.JEWELLERY_GOLD_URL_FALLBACK ?? 'https://data-asg.goldprice.org/dbXRates/USD'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const FOCUSED_MS = 1_000 // poll every 1s while the window is focused (MT5-like)
const BLURRED_MS = 60_000 // back off to 60s when blurred/minimized
const TIMEOUT_MS = 6_000

// ── Adaptive back-off ───────────────────────────────────────────────────────
// The poll runs in the MAIN process, which is also the process answering every
// database IPC call. On a fast link a fetch costs ~100 ms and polling once a
// second is free. On a slow one a single request can run over a second, and a
// fixed 1s re-arm would leave this process doing near-continuous DNS, TLS and
// parsing — every query the operator triggers would queue behind it.
//
// So the gap between polls scales with how expensive the last poll actually
// was: wait at least SLOW_FACTOR x its duration. A healthy connection is
// unaffected (3 x 100 ms is under the 1s floor, so it still polls every
// second); a struggling one automatically stops flooding the process, and
// recovers the moment the network does — there is no sticky penalty, each
// delay is computed from the most recent request alone. SLOW_CAP_MS keeps a
// timed-out fetch (6s) from pushing the next poll beyond 20s.
const SLOW_FACTOR = 3
const SLOW_CAP_MS = 20_000
let lastFetchMs = 0

let win: BrowserWindow | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let stopped = false
let warned = false
let last: LiveGoldDto = { bid: null, ask: null, price: null, ts: null, ok: false }

/** GET with browser-ish headers, a 6s timeout and up to 3 redirects. Never rejects — a failed fetch is a normal state here, not an exception. */
function httpGet(url: string, redirectsLeft = 3): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: string | null): void => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    try {
      const mod = url.startsWith('http:') ? http : https
      const req = mod.get(
        url,
        {
          headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache', Accept: 'application/json,text/html,*/*' },
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const status = res.statusCode ?? 0
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
            res.resume()
            let next: string | null = null
            try {
              next = new URL(res.headers.location, url).toString()
            } catch {
              next = null
            }
            if (!next) return done(null)
            httpGet(next, redirectsLeft - 1).then(done)
            return
          }
          if (status !== 200) {
            res.resume()
            return done(null)
          }
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            body += chunk
            if (body.length > 3_000_000) {
              try {
                req.destroy()
              } catch {
                // Already gone — the abort below still fires `done`.
              }
              done(null)
            }
          })
          res.on('end', () => done(body))
          res.on('error', () => done(null))
        },
      )
      req.on('timeout', () => {
        try {
          req.destroy()
        } catch {
          // Destroying an already-closed socket is a no-op we don't need to see.
        }
        done(null)
      })
      req.on('error', () => done(null))
    } catch {
      done(null)
    }
  })
}

/** A gold shop must never show parsed garbage — both sources end at the same sanity gate. */
function sane(value: number): number | null {
  return Number.isFinite(value) && value > 1000 && value < 20_000 ? value : null
}

/** Swissquote: an array of platform objects, each with spreadProfilePrices[] of {spreadProfile, bid, ask}. Takes the FIRST profile's bid/ask. */
function parseSwissquote(body: string | null): { bid: number; ask: number } | null {
  if (!body) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  for (const entry of parsed as Array<{ spreadProfilePrices?: Array<{ bid: unknown; ask: unknown }> }>) {
    const profiles = entry?.spreadProfilePrices
    if (Array.isArray(profiles) && profiles.length) {
      const bid = sane(parseFloat(String(profiles[0]?.bid)))
      const ask = sane(parseFloat(String(profiles[0]?.ask)))
      if (bid !== null && ask !== null) return { bid, ask }
    }
  }
  return null
}

/** goldprice.org: { items: [ { xauPrice } ] } — one spot number, used for both bid and ask when the primary is unavailable. */
function parseGoldprice(body: string | null): { bid: number; ask: number } | null {
  if (!body) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const items = (parsed as { items?: unknown })?.items
  const first = Array.isArray(items) ? (items[0] as { xauPrice?: unknown }) : null
  const value = first ? sane(parseFloat(String(first.xauPrice))) : null
  return value !== null ? { bid: value, ask: value } : null
}

async function fetchOnce(): Promise<LiveGoldDto> {
  let quote = parseSwissquote(await httpGet(PRIMARY_URL))
  if (!quote) quote = parseGoldprice(await httpGet(FALLBACK_URL))
  if (quote) {
    // price === bid for backward compatibility with anything reading the alias.
    last = { bid: quote.bid, ask: quote.ask, price: quote.bid, ts: new Date().toISOString(), ok: true }
    warned = false
  } else {
    if (!warned) {
      console.warn('[live-gold] fetch/parse failed — keeping last good value')
      warned = true
    }
    last = { ...last, ok: false }
  }
  return last
}

async function tick(): Promise<void> {
  if (stopped) return
  const prevBid = last.bid
  const prevOk = last.ok
  const started = Date.now()
  await fetchOnce()
  lastFetchMs = Date.now() - started
  // Don't push a redundant frame when the bid is unchanged. Always push on an
  // ok-state change so the UI can grey out / recover promptly even when the
  // bid happens to be identical either side of an outage.
  const shouldSend = last.bid !== prevBid || last.ok !== prevOk
  try {
    if (shouldSend && win && !win.isDestroyed()) win.webContents.send(IPC_M2.liveGoldPush, last)
  } catch {
    // The window closed between the check and the send — nothing to do.
  }
  schedule()
}

function schedule(delay?: number): void {
  if (stopped) return
  if (timer) clearTimeout(timer)
  let focused = false
  try {
    focused = !!(win && !win.isDestroyed() && win.isFocused())
  } catch {
    focused = false
  }
  // Focused: never faster than FOCUSED_MS, and never faster than SLOW_FACTOR x
  // the cost of the previous fetch. Blurred keeps its own fixed 60s. An
  // explicit delay (refocus wake, first poll) always wins.
  let next: number
  if (delay !== undefined) next = delay
  else if (!focused) next = BLURRED_MS
  else next = Math.min(SLOW_CAP_MS, Math.max(FOCUSED_MS, lastFetchMs * SLOW_FACTOR))
  timer = setTimeout(() => void tick(), next)
}

/** Starts polling for `window`. Call once, after the window has finished loading. */
export function startLiveGold(window: BrowserWindow): void {
  win = window
  stopped = false
  try {
    window.on('focus', () => schedule(300)) // wake instantly on refocus
  } catch {
    // A window that cannot take a focus listener just polls on the blurred cadence.
  }
  schedule(800)
}

export function stopLiveGold(): void {
  stopped = true
  if (timer) clearTimeout(timer)
}

export function fetchLiveGoldOnce(): Promise<LiveGoldDto> {
  return fetchOnce()
}

export function getLastLiveGold(): LiveGoldDto {
  return last
}
