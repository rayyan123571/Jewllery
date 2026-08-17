import {
  Money,
  STOCK_BUCKETS,
  Weight,
  khalisOf,
  toIsoTimestamp,
  type Clock,
  type IsoTimestamp,
  type Katt,
  type PublicUser,
  type Purity,
  type StockBucket,
  type StockMovement,
} from '@jewellery/domain'
import type {
  AuditRepository,
  StockLedgerRepository,
  StockMovementFilter,
} from '../abstractions/repositories.js'
import type { RateService } from '../rates/RateService.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * Reading and correcting the stock ledger.
 *
 * Stock is a ledger, not a number: every figure this service reports is a sum
 * over append-only movements, computed at the moment of asking. Nothing here
 * stores a balance, and the one write this service offers — the manual
 * adjustment — is itself just another row.
 */

export interface StockDependencies {
  readonly stockLedger: StockLedgerRepository
  readonly audit: AuditRepository
  readonly rates: RateService
  readonly clock: Clock
}

/** Valuation is quoted against pure gold, which is what khalis is. */
export const STOCK_VALUATION_PURITY: Purity = 'K24'

export interface BucketStanding {
  readonly bucket: StockBucket
  readonly gross: Weight
  readonly khalis: Weight
  readonly isNegative: boolean
}

export interface StockSummary {
  readonly buckets: readonly BucketStanding[]
  readonly totalGross: Weight
  readonly totalKhalis: Weight
  /** Buckets currently below zero. Shown, never hidden — see DECISIONS §7. */
  readonly negativeBuckets: readonly StockBucket[]
  /**
   * What the khalis on hand is worth at the 24K rate in force right now.
   * Null when no rate has ever been recorded. The rate and the moment are
   * part of the answer: the valuation is only true for that moment.
   */
  readonly valuation: Money | null
  readonly valuationRatePerTola: Money | null
  readonly valuationAt: IsoTimestamp
}

/** One ledger row with the balance the book stood at after it. */
export interface StockLedgerRow {
  readonly movement: StockMovement
  readonly runningGross: Weight
  readonly runningKhalis: Weight
}

export interface AdjustmentInput {
  readonly branchId: string
  readonly bucket: StockBucket
  /** Signed: a count that found MORE than the books is positive. */
  readonly gross: Weight
  readonly khalis: Weight
  readonly katt: Katt | null
  readonly itemName: string | null
  /** Required. The correction must be as visible as everything else. */
  readonly reason: string
}

export class StockService {
  constructor(private readonly deps: StockDependencies) {}

  /**
   * Current standing per bucket, plus the valuation at this moment's 24K rate.
   *
   * Every bucket is reported even when it has no movements, so the screen
   * shows FINISHED at zero rather than omitting it — an absent row reads as
   * "unknown", and zero is not unknown.
   */
  summary(branchId: string): StockSummary {
    const standing = new Map(this.deps.stockLedger.summary(branchId).map((b) => [b.bucket, b]))

    const buckets: BucketStanding[] = STOCK_BUCKETS.map((bucket) => {
      const totals = standing.get(bucket)
      const gross = totals?.gross ?? Weight.ZERO
      const khalis = totals?.khalis ?? Weight.ZERO
      return { bucket, gross, khalis, isNegative: gross.isNegative || khalis.isNegative }
    })

    const totalGross = Weight.sum(buckets.map((b) => b.gross))
    const totalKhalis = Weight.sum(buckets.map((b) => b.khalis))

    const rate =
      this.deps.rates.rateOn(branchId, STOCK_VALUATION_PURITY, this.deps.rates.today())
        ?.ratePerTola ?? null

    return {
      buckets,
      totalGross,
      totalKhalis,
      negativeBuckets: buckets.filter((b) => b.isNegative).map((b) => b.bucket),
      valuation: rate ? Money.valueOfAtTolaRate(totalKhalis, rate) : null,
      valuationRatePerTola: rate,
      valuationAt: toIsoTimestamp(this.deps.clock.now()),
    }
  }

  /**
   * The ledger with running balances, newest first.
   *
   * The running balance is accumulated over the UNFILTERED ledger and then the
   * filter narrows which rows are shown. Each row therefore carries the real
   * balance the book stood at after that movement, and the newest row's
   * running khalis equals the summary total — filtered or not. A balance
   * accumulated over a filtered subset would be a number that was never true.
   */
  ledger(filter: StockMovementFilter): StockLedgerRow[] {
    const all = this.deps.stockLedger.list({ branchId: filter.branchId })

    let gross = Weight.ZERO
    let khalis = Weight.ZERO
    const withRunning = all.map((movement) => {
      gross = gross.plus(movement.gross)
      khalis = khalis.plus(movement.khalis)
      return { movement, runningGross: gross, runningKhalis: khalis }
    })

    const from = filter.fromDate
    const to = filter.toDate
    return withRunning
      .filter((row) => {
        const day = row.movement.at.slice(0, 10)
        if (from && day < from) return false
        if (to && day > to) return false
        if (filter.bucket && row.movement.bucket !== filter.bucket) return false
        if (filter.kind && row.movement.kind !== filter.kind) return false
        return true
      })
      .reverse()
  }

  /** Every movement a document produced — a purchase and, if any, its reversal. */
  movementsFor(refType: string, refId: string): StockMovement[] {
    return this.deps.stockLedger.forRef(refType, refId)
  }

  /**
   * A manual correction, written as an ADJUSTMENT row like any other movement.
   *
   * Never blocks on sign or size — a physical count found what it found, and
   * refusing to record it means the books quietly stop being true. What it
   * does insist on is the reason and at least one non-zero figure.
   */
  adjust(actor: PublicUser, input: AdjustmentInput): StockMovement {
    if (input.reason.trim().length === 0) {
      throw new ValidationError(
        'An adjustment needs a reason. It is the row everyone will read later.',
      )
    }
    if (input.gross.isZero && input.khalis.isZero) {
      throw new ValidationError('An adjustment of zero adjusts nothing. Enter a weight.')
    }

    const movement = this.deps.stockLedger.append({
      branchId: input.branchId,
      kind: 'ADJUSTMENT',
      bucket: input.bucket,
      gross: input.gross,
      khalis: input.khalis,
      katt: input.katt,
      ratePerTola: null,
      refType: null,
      refId: null,
      itemName: input.itemName,
      note: input.reason.trim(),
      createdByUserId: actor.id,
    })

    this.deps.audit.append({
      branchId: input.branchId,
      userId: actor.id,
      action: 'STOCK_ADJUSTED',
      entity: 'stock_ledger',
      entityId: movement.id,
      detail: JSON.stringify({
        bucket: input.bucket,
        grossMg: input.gross.milligrams,
        khalisMg: input.khalis.milligrams,
        reason: input.reason.trim(),
      }),
    })

    return movement
  }

  /**
   * The khalis a gross weight at a katt represents — for the adjustment form,
   * which lets the operator enter gross + katt and see the khalis it implies.
   */
  khalisFor(gross: Weight, katt: Katt): Weight {
    return khalisOf(gross, katt)
  }

  /**
   * What a proposed OUT movement would leave a bucket at, for the point-of-sale
   * warning. Selling below zero is allowed — a piece still being made is
   * legitimately sold — but it is said out loud, never hidden.
   */
  standingAfter(
    branchId: string,
    bucket: StockBucket,
    grossOut: Weight,
    khalisOut: Weight,
  ): { gross: Weight; khalis: Weight; wouldGoNegative: boolean } {
    const current = this.deps.stockLedger
      .summary(branchId)
      .find((b) => b.bucket === bucket)
    const gross = (current?.gross ?? Weight.ZERO).minus(grossOut)
    const khalis = (current?.khalis ?? Weight.ZERO).minus(khalisOut)
    return { gross, khalis, wouldGoNegative: gross.isNegative || khalis.isNegative }
  }
}
