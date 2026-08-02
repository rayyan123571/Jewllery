import type { IsoTimestamp } from '../common/time.js'

/**
 * The shop's own identity — the block that appears at the top of every printed
 * slip and statement.
 *
 * There is exactly one of these. The earlier prototype modelled this as a
 * `Tenant` with a trial expiry, because it was designed to be sold as a hosted
 * service to many shops. This is one shop's own software running on one shop's
 * own PC, so there is no tenant, no subscription and no trial.
 *
 * Blank optional fields hide their line on the printed slip rather than
 * printing an empty row.
 */
export interface ShopProfile {
  readonly name: string
  readonly tagline: string | null
  readonly ownerName: string
  readonly secondOwnerName: string | null
  readonly phone1: string
  readonly phone2: string | null
  readonly phone3: string | null
  readonly address: string
  /** Path to a 1-bit line-art logo. See ARCHITECTURE.md — the thermal pipeline
   *  hard-thresholds, so a photo or gradient logo prints as a black blob. */
  readonly logoPath: string | null
  readonly updatedAt: IsoTimestamp
}

/**
 * A branch of the shop.
 *
 * `branch_id` is on every transaction table from day one so that a future
 * consolidation is not a schema migration across the whole trading history.
 * The application ships with exactly one branch.
 *
 * This does NOT mean multiple branches work. Two shops in different locations
 * cannot share live data without the internet, and there is no clever way
 * around it — see docs/DECISIONS.md §3. Do not build a feature that implies
 * live cross-branch reporting.
 */
export interface Branch {
  readonly id: string
  readonly name: string
  readonly address: string | null
  readonly isDefault: boolean
  readonly isActive: boolean
  readonly createdAt: IsoTimestamp
}
