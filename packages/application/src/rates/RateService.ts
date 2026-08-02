import {
  Money,
  businessDayOf,
  can,
  type Clock,
  type GoldRate,
  type IsoDate,
  type PublicUser,
  type Purity,
  type Weight,
} from '@jewellery/domain'
import type { AuditRepository, GoldRateRepository } from '../abstractions/repositories.js'
import { PermissionError, ValidationError } from '../auth/AuthService.js'

/**
 * Gold rates, resolved as of a date rather than as "the current setting".
 *
 * The whole point of this service is that valuation asks for the rate *on the
 * day of the transaction*. If it asked for today's rate instead, reprinting
 * last month's party statement would reprice it at today's gold price, and the
 * paper the customer is holding would stop matching the screen. That is the
 * kind of discrepancy that destroys trust in a ledger.
 */

export interface RateDependencies {
  readonly goldRates: GoldRateRepository
  readonly audit: AuditRepository
  readonly clock: Clock
}

/** Raised when a valuation is attempted with no rate recorded for that day. */
export class NoRateError extends Error {
  override readonly name = 'NoRateError'
  constructor(
    readonly purity: Purity,
    readonly on: IsoDate,
  ) {
    super(
      `No ${purity} rate has been recorded on or before ${on}. Set a gold rate ` +
        `before valuing gold — a missing rate is not the same as a rate of zero.`,
    )
  }
}

export class RateService {
  constructor(private readonly deps: RateDependencies) {}

  today(): IsoDate {
    return businessDayOf(this.deps.clock.now())
  }

  /**
   * The rate in force for a purity on a business day, or null if none.
   *
   * Null is a real state on a fresh install and callers must handle it. It is
   * deliberately not defaulted to zero: valuing a party's gold at zero would
   * silently report that the shop holds nothing, which is worse than an error.
   */
  rateOn(branchId: string, purity: Purity, on: IsoDate): GoldRate | null {
    return this.deps.goldRates.findEffective(branchId, purity, on)
  }

  /** Throws rather than returning null, for call sites that cannot proceed. */
  requireRateOn(branchId: string, purity: Purity, on: IsoDate): GoldRate {
    const rate = this.rateOn(branchId, purity, on)
    if (!rate) throw new NoRateError(purity, on)
    return rate
  }

  /** Every purity's current rate, for the rate panel in the shell. */
  currentRates(branchId: string): Partial<Record<Purity, GoldRate>> {
    return this.deps.goldRates.findAllEffective(branchId, this.today())
  }

  /**
   * Values a weight of a given purity as of a date.
   *
   * Goes through `Money.valueOfAtTolaRate`, so the per-tola rate is divided by
   * 11,664 mg only at this final step and the result is rounded exactly once,
   * half away from zero. A negative weight — meaning the shop owes the party — produces a negative
   * amount, preserving the sign convention into the cash ledger.
   */
  value(branchId: string, weight: Weight, purity: Purity, on: IsoDate): Money {
    return Money.valueOfAtTolaRate(weight, this.requireRateOn(branchId, purity, on).ratePerTola)
  }

  history(branchId: string, purity: Purity, limit = 50): GoldRate[] {
    return this.deps.goldRates.history(branchId, purity, limit)
  }

  /**
   * Records a new rate.
   *
   * Never updates an existing row. A rate is a fact about a period of time, so
   * a correction is a new row with a note, and the history stays readable —
   * the same principle as never editing a posted transaction (DECISIONS §6).
   */
  setRate(
    actor: PublicUser,
    input: {
      branchId: string
      purity: Purity
      ratePerTola: Money
      effectiveFrom: IsoDate
      note: string | null
    },
  ): GoldRate {
    if (!can(actor.role, 'canSetGoldRate')) {
      throw new PermissionError(
        `A ${actor.role.toLowerCase()} is not permitted to change the gold rate. ` +
          `Changing it revalues every open position.`,
      )
    }

    if (!input.ratePerTola.isPositive) {
      throw new ValidationError('A gold rate must be greater than zero.')
    }

    // A future-dated rate is legitimate — a shop may set tomorrow's rate the
    // evening before — so this is not blocked. But a rate dated years ahead is
    // almost always a typo in the year, and it would silently take over every
    // valuation from that day on.
    const today = this.today()
    if (input.effectiveFrom > addYears(today, 1)) {
      throw new ValidationError(
        `An effective date of ${input.effectiveFrom} is more than a year away. ` +
          `Check the year.`,
      )
    }

    const previous = this.rateOn(input.branchId, input.purity, input.effectiveFrom)
    const recorded = this.deps.goldRates.record({
      branchId: input.branchId,
      purity: input.purity,
      ratePerTola: input.ratePerTola,
      effectiveFrom: input.effectiveFrom,
      createdByUserId: actor.id,
      note: input.note,
    })

    this.deps.audit.append({
      branchId: input.branchId,
      userId: actor.id,
      action: 'GOLD_RATE_SET',
      entity: 'gold_rates',
      entityId: recorded.id,
      detail: JSON.stringify({
        purity: input.purity,
        effectiveFrom: input.effectiveFrom,
        ratePerTolaPaisa: input.ratePerTola.paisa,
        previousRatePerTolaPaisa: previous?.ratePerTola.paisa ?? null,
      }),
    })

    return recorded
  }
}

function addYears(date: IsoDate, years: number): IsoDate {
  const year = Number(date.slice(0, 4)) + years
  return `${year.toString().padStart(4, '0')}${date.slice(4)}` as IsoDate
}
