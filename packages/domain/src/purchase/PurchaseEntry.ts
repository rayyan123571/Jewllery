import type { IsoDate, IsoTimestamp } from '../common/time.js'
import type { Katt } from '../wholesale/Katt.js'
import type { Money } from '../common/Money.js'
import type { StockBucket } from '../stock/StockLedger.js'
import type { Weight } from '../common/Weight.js'

/**
 * A purchase: the shop buying gold over the counter, usually old gold that is
 * headed for the melt.
 *
 * The same two rules the wholesale slip lives by apply here:
 *
 *   - The rate and katt a line was priced at are STORED on the line. Reopening
 *     the invoice recomputes from those stored figures, never from today's
 *     rate — otherwise tomorrow's rate silently rewrites yesterday's invoice
 *     and a customer holding the printed slip is looking at different numbers
 *     than the screen.
 *   - Khalis and amount are derived from gross, katt and rate, but stored, so
 *     a reprint is byte-identical and the printed column adds up.
 *
 * A purchase is numbered from its own book (`invoice_sequences` key
 * 'purchase'). A held purchase has taken a number but has NOT happened yet: it
 * writes no stock movements until it is posted. Cancelling a posted purchase
 * flips the status and writes reversing stock rows; the purchase row and its
 * lines are never deleted, and the number stays burned.
 */
export const PURCHASE_STATUSES = ['held', 'posted', 'cancelled'] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]

export function isPurchaseStatus(value: string): value is PurchaseStatus {
  return (PURCHASE_STATUSES as readonly string[]).includes(value)
}

export interface PurchaseLineItem {
  readonly id: string
  readonly lineNo: number
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  /** Derived from gross and katt, but stored, so a reprint is identical. */
  readonly khalis: Weight
  /** The rate THIS line was priced at. Defaults from the header, per line. */
  readonly ratePerTola: Money
  readonly amount: Money
  /** Which stock bucket the metal lands in when the purchase posts. */
  readonly bucket: StockBucket
  readonly remarks: string | null
}

export interface PurchaseEntry {
  readonly id: string
  readonly branchId: string
  readonly partyId: string
  /** Plain integer; the prefix is a DISPLAY setting, never stored. */
  readonly invoiceNumber: number
  readonly entryDate: IsoDate
  readonly status: PurchaseStatus
  /** The header default rate, SNAPSHOT at save time. */
  readonly ratePerTola: Money
  readonly totalGross: Weight
  readonly totalKhalis: Weight
  readonly totalAmount: Money
  readonly notes: string | null
  readonly cancelledAt: IsoTimestamp | null
  readonly cancelReason: string | null
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}

export interface PurchaseEntryWithLines {
  readonly entry: PurchaseEntry
  readonly lines: readonly PurchaseLineItem[]
}
