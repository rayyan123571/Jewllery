import type { IsoTimestamp } from '../common/time.js'
import type { Katt } from '../wholesale/Katt.js'
import type { Weight } from '../common/Weight.js'

/**
 * A PIECE: one physical article. This is the stock.
 *
 * Two "22K ladies ring" are not interchangeable — one is 4.200 g and the other
 * 5.800 g — so every article gets its own row with its own weight, its own
 * katt, its own tag. "How many rings" is a COUNT of these rows; "how much
 * khalis" is a SUM over them. Neither is ever a stored counter.
 *
 * A piece is never deleted. Its status changes — sold, melted, out with a
 * karigar, lost — and every change is recorded as an event, so a piece's full
 * history reads like the ledger it is: purchased on, moved, issued, sold.
 *
 * Bulk goods that genuinely sell by weight — loose chain, coins — are STILL
 * pieces, one row per physical unit. A second "bulk" path would double every
 * report and the two halves would drift.
 */

export const PIECE_STATUSES = [
  'IN_STOCK',
  'SOLD',
  'MELTED',
  'ISSUED_TO_KARIGAR',
  'TRANSFERRED',
  'LOST',
] as const
export type PieceStatus = (typeof PIECE_STATUSES)[number]

export function isPieceStatus(value: string): value is PieceStatus {
  return (PIECE_STATUSES as readonly string[]).includes(value)
}

/** What created the piece. The row it points at is the piece's birth record. */
export const PIECE_SOURCES = ['OPENING', 'PURCHASE', 'KARIGAR_RECEIPT'] as const
export type PieceSource = (typeof PIECE_SOURCES)[number]

export interface Piece {
  readonly id: string
  readonly branchId: string
  /** Unique per branch. Printed on the physical tag; barcodes read it back. */
  readonly tagNumber: number
  readonly itemId: string
  /** The whole article on the scale, stones included. */
  readonly gross: Weight
  readonly stone: Weight
  readonly stoneCount: number
  /** gross − stone: the metal. Stored, and CHECKed against its parts. */
  readonly net: Weight
  /** SNAPSHOT — the same rule as a purchase line. Never re-resolved. */
  readonly katt: Katt
  /** Pure content of the NET weight. A stone is not gold. */
  readonly khalis: Weight
  readonly locationId: string | null
  readonly status: PieceStatus
  readonly sourceType: PieceSource
  readonly sourceId: string | null
  readonly statusChangedAt: IsoTimestamp
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}

export const PIECE_EVENT_KINDS = ['CREATED', 'MOVED', 'STATUS_CHANGED'] as const
export type PieceEventKind = (typeof PIECE_EVENT_KINDS)[number]

/** One line of a piece's history. Append-only, like everything that matters. */
export interface PieceEvent {
  readonly id: string
  readonly pieceId: string
  readonly branchId: string
  readonly at: IsoTimestamp
  readonly kind: PieceEventKind
  readonly fromStatus: PieceStatus | null
  readonly toStatus: PieceStatus | null
  readonly fromLocationId: string | null
  readonly toLocationId: string | null
  readonly note: string | null
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
}
