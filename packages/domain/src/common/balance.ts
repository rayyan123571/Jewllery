import { Money } from './Money.js'
import { Weight } from './Weight.js'

/**
 * The sign convention, expressed as code so it cannot be forgotten at a call
 * site or reinvented differently in another module.
 *
 *   POSITIVE = the party owes the shop      (a receivable)
 *   NEGATIVE = the shop owes the party      (a payable)
 *
 * This holds identically for both ledgers. They are separate and are never
 * netted against each other: a party can owe gold while the shop owes them
 * cash, and a single combined figure would hide that.
 *
 * A negative balance is a real business state, not an error. It is never
 * clamped to zero, never stored as an absolute value, and never hidden. It
 * carries forward and usually resolves itself on the next transaction — an
 * opening of -0.500 g followed by an issue of 100.000 g leaves 99.500 g.
 *
 * See docs/DECISIONS.md §4.
 */

/** Which of a party's two independent balances a figure belongs to. */
export type LedgerKind = 'gold' | 'cash'

/** What a balance's sign means, named rather than left as a bare number. */
export type BalanceDirection = 'party-owes-shop' | 'shop-owes-party' | 'settled'

export interface DescribedBalance {
  /** Always non-negative. Pair it with `label` — never print a bare minus. */
  readonly magnitude: string
  /** Plain words a shopkeeper reads correctly at a glance. */
  readonly label: string
  readonly direction: BalanceDirection
  /** True when the shop owes the party, for the red badge in the UI. */
  readonly isOwedByShop: boolean
  /** Magnitude and label together, e.g. `"0.500 g (we owe)"`. */
  readonly text: string
}

function directionOf(signedValue: number): BalanceDirection {
  if (signedValue > 0) return 'party-owes-shop'
  if (signedValue < 0) return 'shop-owes-party'
  return 'settled'
}

function labelFor(direction: BalanceDirection): string {
  switch (direction) {
    case 'party-owes-shop':
      return 'they owe'
    case 'shop-owes-party':
      return 'we owe'
    case 'settled':
      return 'settled'
  }
}

/**
 * Turns a signed balance into a magnitude plus an explicit label.
 *
 * Use this everywhere a balance is shown to a user, in the app and on printed
 * documents alike. A bare "-0.500 g" is misread by someone working quickly at a
 * counter; "0.500 g (we owe)" is not. That is the whole reason this function
 * exists rather than each screen calling `.format()` and hoping.
 */
export function describeBalance(balance: Weight | Money): DescribedBalance {
  const signedValue = balance instanceof Weight ? balance.milligrams : balance.paisa
  const direction = directionOf(signedValue)
  const label = labelFor(direction)

  const magnitude =
    balance instanceof Weight
      ? balance.absolute.formatWithUnit()
      : balance.absolute.formatWithSymbol()

  return {
    magnitude,
    label,
    direction,
    isOwedByShop: direction === 'shop-owes-party',
    text: direction === 'settled' ? magnitude : `${magnitude} (${label})`,
  }
}

/**
 * Totals that keep receivable and payable visible separately.
 *
 * Reports sum signed values — but they must *also* show gross receivable and
 * gross payable, because netting them across parties hides real exposure. Ten
 * parties owing 100 g each and ten owed 100 g each nets to zero, which is a
 * true number and a useless one.
 */
export interface LedgerTotals<T extends Weight | Money> {
  /** The signed sum. Positive means the shop is owed on balance. */
  readonly net: T
  /** Sum of the positive balances only — total owed *to* the shop. */
  readonly grossReceivable: T
  /** Sum of the negative balances, as a positive magnitude — total owed *by* the shop. */
  readonly grossPayable: T
  /** How many parties the shop owes. Drives the dashboard badge. */
  readonly payableCount: number
}

export function totalWeights(balances: readonly Weight[]): LedgerTotals<Weight> {
  const positives = balances.filter((b) => b.isPositive)
  const negatives = balances.filter((b) => b.isNegative)
  return {
    net: Weight.sum(balances),
    grossReceivable: Weight.sum(positives),
    grossPayable: Weight.sum(negatives).absolute,
    payableCount: negatives.length,
  }
}

export function totalMoney(balances: readonly Money[]): LedgerTotals<Money> {
  const positives = balances.filter((b) => b.isPositive)
  const negatives = balances.filter((b) => b.isNegative)
  return {
    net: Money.sum(balances),
    grossReceivable: Money.sum(positives),
    grossPayable: Money.sum(negatives).absolute,
    payableCount: negatives.length,
  }
}
