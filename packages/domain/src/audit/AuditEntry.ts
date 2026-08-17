import type { IsoTimestamp } from '../common/time.js'

/**
 * An append-only record of who did what.
 *
 * Carried over from the prototype's schema, minus `ipAddress` — there is no
 * network here, so there is no address to record.
 *
 * The audit log is what makes "posted transactions are never edited" (see
 * docs/DECISIONS.md §6) into something more than a convention: the books show
 * what happened *and* what was corrected. In M2 it is also where an over-return
 * confirmation is recorded, together with the user who confirmed it.
 */
export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DEACTIVATED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'SHOP_PROFILE_UPDATED'
  | 'BRANCH_CREATED'
  | 'GOLD_RATE_SET'
  | 'BACKUP_CREATED'
  | 'BACKUP_RESTORED'
  | 'TRANSACTION_POSTED'
  /**
   * A sale parked before it was posted.
   *
   * Distinct from POSTED because it is a different event with different
   * consequences: a held sale has taken an invoice number but has not sold
   * anything, and "who held this and when" is the question asked when one is
   * still sitting there a week later.
   */
  | 'TRANSACTION_HELD'
  | 'TRANSACTION_REVERSED'
  /**
   * A posted purchase taken back off the books.
   *
   * Distinct from REVERSED because the mechanics differ: a wholesale reversal
   * is a second slip carrying the original's number, while a cancelled
   * purchase keeps its one row, flips status, and writes reversing STOCK rows.
   * The question this answers later is "who cancelled it, and why".
   */
  | 'TRANSACTION_CANCELLED'
  /**
   * A manual stock correction. Physical counts differ from books, and the
   * correction must be as visible as everything else — which starts with who
   * made it and the reason they were required to give.
   */
  | 'STOCK_ADJUSTED'
  | 'OVER_RETURN_CONFIRMED'
  | 'PARTY_CREATED'
  | 'PARTY_UPDATED'
  | 'PARTY_DEACTIVATED'
  | 'ITEM_CREATED'
  | 'ITEM_UPDATED'
  | 'ITEM_DEACTIVATED'
  /**
   * A category or location was added, renamed, or (de)activated. One action
   * per table rather than nine members: the entity and detail JSON carry what
   * changed, and the question asked later is "who touched the setup", not
   * "which of nine flavours of touching".
   */
  | 'CATEGORY_CHANGED'
  | 'LOCATION_CHANGED'
  /**
   * Existing pieces entered at go-live. Distinct from TRANSACTION_POSTED
   * because it is a different event: nothing was bought and nobody was paid —
   * the shop is telling the software what it already holds.
   */
  | 'OPENING_STOCK_POSTED'
  | 'PIECE_MOVED'

export interface AuditEntry {
  readonly id: string
  readonly branchId: string | null
  /** Null only for a failed login, where no user was established. */
  readonly userId: string | null
  readonly action: AuditAction
  /** The table or concept acted on, e.g. `gold_rates`. */
  readonly entity: string
  readonly entityId: string | null
  /** Free-form context, stored as JSON. Never credential material. */
  readonly detail: string | null
  readonly createdAt: IsoTimestamp
}

export interface NewAuditEntry {
  readonly branchId: string | null
  readonly userId: string | null
  readonly action: AuditAction
  readonly entity: string
  readonly entityId: string | null
  readonly detail: string | null
}
