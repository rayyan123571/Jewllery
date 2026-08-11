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
  | 'OVER_RETURN_CONFIRMED'
  | 'PARTY_CREATED'
  | 'PARTY_UPDATED'
  | 'PARTY_DEACTIVATED'

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
