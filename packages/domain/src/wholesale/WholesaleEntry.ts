import type { Money } from '../common/Money.js'
import type { Weight } from '../common/Weight.js'
import type { IsoDate, IsoTimestamp } from '../common/time.js'
import type { Katt } from './Katt.js'

/**
 * A posted wholesale slip and its lines.
 *
 * `ISSUE` hands gold to the party; `SETTLEMENT` takes it back — in gold, in
 * cash, or in both. Both kinds move the same **gold** ledger, because a cash
 * payment against a gold debt is a gold-debt transaction that happens to be
 * paid in cash (docs/DECISIONS.md §10).
 */
export type WholesaleEntryKind = 'ISSUE' | 'SETTLEMENT'

export interface WholesaleLineItem {
  readonly id: string
  readonly lineNo: number
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  /** Derived from gross and katt, but stored, so a reprint is identical. */
  readonly khalis: Weight
  readonly ratePerTola: Money
  readonly amount: Money
  readonly remarks: string | null
  /**
   * The karat whose rate priced this line — migration 019.
   *
   * Stored beside the rate rather than instead of it: the rate is what the
   * line was charged, this is why. A reprint reads the rate; a reader asking
   * what the line WAS reads this.
   */
  readonly purity: string
  /** The shop's second free-text note. Never printed — migration 020. */
  readonly male: string | null
}

export interface WholesaleEntry {
  readonly id: string
  readonly branchId: string
  readonly partyId: string
  readonly kind: WholesaleEntryKind
  /**
   * The slip number, as a plain integer: 1, 2, 3.
   *
   * Not text, and not carrying a prefix. TEXT sorts lexically — 'WS-10' before
   * 'WS-9' — so the arrows that walk the book would step onto the wrong slip.
   * The prefix a shop wants printed is a display setting applied at the edge,
   * which is why putting one back is a settings change and not a migration.
   *
   * Issues and settlements are numbered from SEPARATE sequences, so both books
   * hold a slip 1. A reversal keeps the number of the slip it reverses: it is
   * the same document being corrected, not a new one.
   */
  readonly invoiceNumber: number
  readonly entryDate: IsoDate

  /**
   * The rate as it stood on `entryDate`, stored here at the moment of posting.
   * Never resolved again at read time — history does not move when the rate
   * changes. Null only for a gold-only settlement, which needs no rate.
   */
  readonly ratePerTola: Money | null

  readonly totalGross: Weight
  readonly totalKhalis: Weight
  readonly totalAmount: Money

  /** Settlement portions. Both zero on an ISSUE. */
  readonly settledGold: Weight
  readonly settledCash: Money
  /** What the cash portion bought at `ratePerTola`. Stored, not recomputed. */
  readonly settledCashAsGold: Weight

  /**
   * The signed effect on the party's gold ledger. Positive = the party owes the
   * shop more after this entry. This is the only column the running balance
   * sums, which is what keeps the balance and the entries from disagreeing.
   */
  readonly goldDelta: Weight
  /** Signed effect on the cash ledger, for cash movements unrelated to a gold debt. */
  readonly cashDelta: Money

  readonly isOverReturn: boolean
  readonly confirmedByUserId: string | null

  readonly reversesEntryId: string | null
  readonly reversedByEntryId: string | null

  readonly notes: string | null
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
}

export interface WholesaleEntryWithLines {
  readonly entry: WholesaleEntry
  readonly lines: readonly WholesaleLineItem[]
}

/**
 * One row of the party ledger, in the shape the slip's footer uses:
 * Previous → Current Issued → End Balance.
 */
export interface PartyLedgerRow {
  readonly entry: WholesaleEntry
  /** The gold balance before this entry. */
  readonly previousGold: Weight
  /** The gold balance after it. */
  readonly endGold: Weight
  readonly previousCash: Money
  readonly endCash: Money
}
