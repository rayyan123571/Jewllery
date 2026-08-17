import type { IsoTimestamp } from '../common/time.js'
import type { Katt } from '../wholesale/Katt.js'
import type { Money } from '../common/Money.js'
import type { Weight } from '../common/Weight.js'

/**
 * The stock ledger: every movement of metal, as a row that is never edited.
 *
 * Stock is NOT a number on an item. It is the sum of an append-only ledger,
 * grouped by bucket — the same rule the party balance already follows
 * (`gold_delta_mg` is the only column a balance sums, and the balance itself is
 * never stored). When a jeweller finds himself three grams short, a ledger
 * answers "which movement" in seconds; a mutable balance answers nothing, and
 * the argument that follows is with his own money.
 *
 * Movements are SIGNED: incoming positive, outgoing negative. Cancelling a
 * posted purchase writes reversing rows with the opposite sign — it never
 * deletes the originals, so the pair nets to zero and both stay visible.
 *
 * Every row carries BOTH gross and khalis. Gross is the metal on the shelf;
 * khalis is what it is worth. A melt loses gross while preserving khalis, and
 * only a two-column ledger can show that happening.
 */

/**
 * Where a piece of metal sits.
 *
 * Most purchases are old gold destined for the melt, which is why SCRAP is the
 * default bucket on a purchase line — not FINISHED.
 */
export const STOCK_BUCKETS = ['FINISHED', 'SCRAP', 'BULLION'] as const
export type StockBucket = (typeof STOCK_BUCKETS)[number]

export function isStockBucket(value: string): value is StockBucket {
  return (STOCK_BUCKETS as readonly string[]).includes(value)
}

export const STOCK_MOVEMENT_KINDS = [
  'OPENING',
  'PURCHASE_IN',
  'SALE_OUT',
  'MELT_IN',
  'MELT_OUT',
  'ADJUSTMENT',
] as const
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number]

export function isStockMovementKind(value: string): value is StockMovementKind {
  return (STOCK_MOVEMENT_KINDS as readonly string[]).includes(value)
}

export interface StockMovement {
  readonly id: string
  readonly branchId: string
  /** When the movement happened, as a business fact. */
  readonly at: IsoTimestamp
  readonly kind: StockMovementKind
  readonly bucket: StockBucket
  /** Signed. Incoming positive, outgoing negative. */
  readonly gross: Weight
  /** Signed, same convention. */
  readonly khalis: Weight
  /** SNAPSHOT of the katt the movement was assessed at. Never re-resolved. */
  readonly katt: Katt | null
  /** SNAPSHOT of the rate the movement was priced at. Never re-resolved. */
  readonly ratePerTola: Money | null
  /** What produced this movement, e.g. 'purchase'. Null for a manual entry. */
  readonly refType: string | null
  readonly refId: string | null
  readonly itemName: string | null
  readonly note: string | null
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
}

/** One bucket's standing, always derived by summing the ledger. */
export interface StockBucketTotals {
  readonly bucket: StockBucket
  readonly gross: Weight
  readonly khalis: Weight
}
