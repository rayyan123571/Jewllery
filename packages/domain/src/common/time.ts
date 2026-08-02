/**
 * Two different things that both look like "a date", kept apart on purpose.
 *
 *   IsoTimestamp — an *instant*. When a row was written. Stored in UTC.
 *   IsoDate      — a *business day*. The day a rate takes effect, the day a
 *                  transaction belongs to. It has no time and no timezone.
 *
 * Conflating them is a real source of bugs in a shop system: a gold rate
 * effective "1 August" must apply to everything the shop did on 1 August, in
 * the shop's own local reckoning, regardless of what UTC instant the row was
 * written at. Storing that as a UTC timestamp puts a rate set at 9am in Lahore
 * onto the previous day, and every valuation made before noon uses yesterday's
 * price.
 *
 * Both are stored as TEXT and sort lexicographically, which is what makes
 * `ORDER BY effective_from DESC LIMIT 1` correct without any date parsing in
 * SQL.
 */

/** An instant in UTC, e.g. `2026-08-02T09:15:32.104Z`. Audit trails, row stamps. */
export type IsoTimestamp = string & { readonly __brand: 'IsoTimestamp' }

/** A business day in the shop's local reckoning, e.g. `2026-08-02`. */
export type IsoDate = string & { readonly __brand: 'IsoDate' }

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function toIsoTimestamp(value: Date | string): IsoTimestamp {
  const text = value instanceof Date ? value.toISOString() : value
  if (!TIMESTAMP_PATTERN.test(text)) {
    throw new TypeError(
      `"${text}" is not a UTC ISO timestamp (expected 2026-08-02T09:15:32.104Z).`,
    )
  }
  return text as IsoTimestamp
}

export function toIsoDate(value: string): IsoDate {
  if (!DATE_PATTERN.test(value)) {
    throw new TypeError(`"${value}" is not a business date (expected 2026-08-02).`)
  }
  return value as IsoDate
}

/**
 * The business day a local `Date` falls on.
 *
 * Uses the machine's local calendar deliberately. The shop PC is in the shop,
 * so its local day *is* the shop's trading day — which is exactly the reckoning
 * a rate effective "today" should follow.
 */
export function businessDayOf(instant: Date): IsoDate {
  const year = instant.getFullYear().toString().padStart(4, '0')
  const month = (instant.getMonth() + 1).toString().padStart(2, '0')
  const day = instant.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}` as IsoDate
}

/**
 * A source of "now", injected rather than called directly.
 *
 * Every service that needs the current time takes one of these. Tests pass a
 * fixed clock, so a rate-effective-from-today test does not quietly start
 * failing at midnight, and nothing in the application layer needs a real
 * calendar to be exercised.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

/** A clock stopped at a fixed instant, for tests and for reproducible seeds. */
export function fixedClock(instant: Date | string): Clock {
  const frozen = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(frozen.getTime())) {
    throw new TypeError(`fixedClock needs a valid instant, received ${String(instant)}`)
  }
  return { now: () => new Date(frozen.getTime()) }
}
