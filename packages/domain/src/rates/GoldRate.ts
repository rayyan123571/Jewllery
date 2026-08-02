import type { Money } from '../common/Money.js'
import type { IsoDate, IsoTimestamp } from '../common/time.js'
import type { Purity } from './Purity.js'

/**
 * A gold rate, recorded as history rather than as a single mutable number.
 *
 * This is the one piece of modelling the earlier prototype got right and is
 * worth carrying forward. A rate is not a setting that gets overwritten; it is
 * a fact about a period of time. Every valuation must use the rate that was in
 * force **on the day of the transaction**, not the rate showing today —
 * otherwise reprinting last month's statement silently reprices it, and the
 * paper the customer is holding stops matching the screen.
 *
 * Rows are never updated or deleted. Correcting a rate means recording a new
 * one, which is the same principle as never editing a posted transaction
 * (docs/DECISIONS.md §6).
 */
export interface GoldRate {
  readonly id: string
  readonly branchId: string
  readonly purity: Purity
  /**
   * Per **tola**, in paisa. Never a float, and never converted to per-gram at
   * storage time — see Money.valueOfAtTolaRate for why that would lose money.
   */
  readonly ratePerTola: Money
  /** The first business day this rate applies to. */
  readonly effectiveFrom: IsoDate
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
  /** Free text — "market drop", "corrected typo". Shown in the rate history. */
  readonly note: string | null
}

/** A rate to be recorded. The id and createdAt are assigned on write. */
export interface NewGoldRate {
  readonly branchId: string
  readonly purity: Purity
  readonly ratePerTola: Money
  readonly effectiveFrom: IsoDate
  readonly createdByUserId: string
  readonly note: string | null
}
