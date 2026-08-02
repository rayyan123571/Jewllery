import type { Money } from '../common/Money.js'
import type { IsoTimestamp } from '../common/time.js'
import type { Weight } from '../common/Weight.js'

/**
 * A wholesale party — the karigar, dealer or shop on the other side of a slip.
 *
 * A party carries two opening balances, one per ledger, because gold and cash
 * are recorded separately (docs/DECISIONS.md §4). Both follow the same sign
 * convention as everything else: positive means the party owes the shop.
 *
 * The real slip (docs/wholesale-receipt.jpg) shows Party, Mobile and City, so
 * those are the fields that matter; `code` is the short handle the counter types
 * to find a party quickly.
 */
export interface Party {
  readonly id: string
  readonly branchId: string
  /** Short unique handle, e.g. "CHJ". Uppercased, unique within a branch. */
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
  /**
   * Gold owed at the moment the party was created in this system, in
   * milligrams of khalis. Positive = the party owed the shop.
   */
  readonly openingGold: Weight
  /** Cash owed at creation, in paisa. Positive = the party owed the shop. */
  readonly openingCash: Money
  readonly isActive: boolean
  readonly notes: string | null
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}

export interface NewParty {
  readonly branchId: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
  readonly openingGold: Weight
  readonly openingCash: Money
  readonly notes: string | null
}

/**
 * A party plus their current balances, which is what every screen actually
 * wants. The balances are derived from the ledger, never stored on the party —
 * a stored balance and a ledger that disagree is the classic accounting bug,
 * and the ledger is the one that can be audited.
 */
export interface PartyWithBalance {
  readonly party: Party
  /** Signed. Positive = party owes the shop gold. */
  readonly goldBalance: Weight
  /** Signed. Positive = party owes the shop cash. */
  readonly cashBalance: Money
}
