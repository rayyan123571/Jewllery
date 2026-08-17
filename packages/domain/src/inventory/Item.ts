import type { IsoTimestamp } from '../common/time.js'
import type { Katt } from '../wholesale/Katt.js'
import type { Money } from '../common/Money.js'
import type { Purity } from '../rates/Purity.js'

/**
 * The item master: definitions, not stock.
 *
 * An ITEM is "22K ladies ring, design R-114" — a description the shop reuses.
 * It deliberately has NO weight and NO quantity, and never will: two pieces of
 * the same item are not interchangeable (one is 4.200 g, the other 5.800 g),
 * so a quantity column cannot express what the shop holds and every total
 * built on one is wrong. Stock is the PIECES (stage 2), each physical article
 * a row of its own; "how many" is a count of those rows, never a counter.
 *
 * What an item does carry are the DEFAULTS a new piece or a sale line starts
 * from — the purity, the usual katt, the making-charge habit — plus the
 * directory facts: where it comes from, what the design is called.
 */

/**
 * How this item's making charge is usually quoted — the same pair retail's
 * labour already uses, so a sale pre-filled from the item cannot mismatch.
 */
export const MAKING_CHARGE_BASES = ['fixed', 'per_tola'] as const
export type MakingChargeBasis = (typeof MAKING_CHARGE_BASES)[number]

export function isMakingChargeBasis(value: string): value is MakingChargeBasis {
  return (MAKING_CHARGE_BASES as readonly string[]).includes(value)
}

/**
 * One node of the two-level category tree: rings, bangles, chains — and under
 * them, whatever the shop calls its subdivisions. The tree is the shop's own;
 * nothing is hardcoded, because every shop names these differently.
 *
 * Two levels exactly. A parent has `parentId` null; a child points at a
 * parent; a grandchild is refused by the service. Deeper trees always end as
 * one shop's private taxonomy nobody else can read.
 */
export interface ItemCategory {
  readonly id: string
  readonly branchId: string
  /** Null for a top-level category. */
  readonly parentId: string | null
  readonly name: string
  /** Categories deactivate, never delete — old items keep their label. */
  readonly isActive: boolean
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}

/**
 * Where a piece physically sits: showcase 1, safe, counter. Shop-defined.
 *
 * A karigar is deliberately NOT a location — gold with a craftsman is a person
 * holding the shop's metal against a balance (stage 5), not a shelf.
 */
export interface StockLocation {
  readonly id: string
  readonly branchId: string
  readonly name: string
  readonly isActive: boolean
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}

export interface Item {
  readonly id: string
  readonly branchId: string
  /** Unique per branch, case-insensitive. Printed on tags, so never edited. */
  readonly code: string
  readonly name: string
  /** Either level of the tree. Null is a real state: "not filed yet". */
  readonly categoryId: string | null
  readonly purity: Purity
  /** Pre-fills a new piece's katt. A default, never a source of truth. */
  readonly defaultKatt: Katt
  readonly makingChargeBasis: MakingChargeBasis
  readonly defaultMakingCharge: Money
  /** The usual source, out of the shared directory. */
  readonly supplierId: string | null
  readonly designNo: string | null
  readonly notes: string | null
  /** An item nobody stocks any more deactivates; its pieces keep their name. */
  readonly isActive: boolean
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}
