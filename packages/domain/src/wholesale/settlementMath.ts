import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'

/**
 * Settling a gold debt — see docs/DECISIONS.md §10.
 *
 * A party owes khalis gold. All three ways of settling reduce that **gold**
 * debt:
 *
 *   - gold given          reduces it by the weight
 *   - cash given          reduces it by the gold that cash buys at the stored rate
 *   - part gold, part cash reduces it by both
 *
 * After settling fully in cash, the gold balance reads zero. Not "gold still
 * owed, cash in credit" — the debt is settled. Cash handed over in place of gold
 * is a gold-debt transaction that happens to be paid in cash.
 *
 * The rate is passed in, never looked up here, because it is **stored on the
 * transaction**. If this re-derived it, every past settlement would silently
 * revalue itself the next time the gold rate moved and a party's history would
 * change under them.
 */

export interface SettlementInput {
  /** What the party owed before this settlement. Positive = they owe the shop. */
  readonly previousGoldBalance: Weight
  /** Khalis gold handed over. Zero for a cash-only settlement. */
  readonly goldGiven: Weight
  /** Cash handed over. Zero for a gold-only settlement. */
  readonly cashGiven: Money
  /**
   * The per-tola rate **as of this settlement's own date**, which the caller has
   * already resolved and will store on the row. Required whenever cash is
   * involved; ignored when it is not.
   */
  readonly ratePerTola: Money | null
}

export interface SettlementResult {
  /** Gold the cash portion bought, at the stored rate. Zero if no cash. */
  readonly goldFromCash: Weight
  /** goldGiven + goldFromCash — the total reduction in the gold debt. */
  readonly totalGoldSettled: Weight
  /** previousGoldBalance − totalGoldSettled. Signed; may be negative. */
  readonly newGoldBalance: Weight
  /** True when the party settled more than they owed and the shop now owes them. */
  readonly isOverpayment: boolean
}

/** Raised when a cash portion is given but no rate exists for that date. */
export class MissingRateForSettlementError extends Error {
  override readonly name = 'MissingRateForSettlementError'
  constructor() {
    super(
      'This settlement includes a cash payment, but no gold rate has been ' +
        'recorded on or before its date. Record the rate that applied that day ' +
        'before saving — a cash payment cannot reduce a gold debt without one, ' +
        'and using today’s rate would settle a real debt at the wrong price.',
    )
  }
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const hasCash = !input.cashGiven.isZero

  // Refuse rather than default. Valuing a cash payment at a made-up rate settles
  // a real debt for an imaginary amount, and nothing on the slip would show it.
  if (hasCash && (input.ratePerTola === null || !input.ratePerTola.isPositive)) {
    throw new MissingRateForSettlementError()
  }

  const goldFromCash = hasCash
    ? Weight.boughtByAtTolaRate(
        input.cashGiven.paisa,
        (input.ratePerTola as Money).paisa,
      )
    : Weight.ZERO

  const totalGoldSettled = input.goldGiven.plus(goldFromCash)
  const newGoldBalance = input.previousGoldBalance.minus(totalGoldSettled)

  return {
    goldFromCash,
    totalGoldSettled,
    // Overpayment is allowed and carried forward, never clamped and never
    // blocked. It simply means the shop now owes the party (DECISIONS §4).
    isOverpayment: newGoldBalance.isNegative,
    newGoldBalance,
  }
}

/**
 * The cash a gold debt is worth at a given rate — what the settlement screen
 * shows as "pay this much to clear it".
 *
 * Display only. The authoritative direction is cash → gold, because that is what
 * actually moves the balance; this is the convenience inverse for an operator
 * who wants to know what a full cash settlement would cost.
 */
export function cashToClear(goldOwed: Weight, ratePerTola: Money): Money {
  return Money.valueOfAtTolaRate(goldOwed, ratePerTola)
}
