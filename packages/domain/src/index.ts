// The domain layer: entities and value types, with no dependencies at all.
//
// Everything the rest of the system agrees on about what a weight, an amount of
// money, a user or a gold rate *is* lives here. Nothing in this package knows
// about SQL, Electron, React or a printer.

export { Weight } from './common/Weight.js'
export { Money } from './common/Money.js'
export {
  describeBalance,
  totalMoney,
  totalWeights,
  type BalanceDirection,
  type DescribedBalance,
  type LedgerKind,
  type LedgerTotals,
} from './common/balance.js'
export { assertSafeInteger, roundHalfAwayFromZero, scaleDiv } from './common/rounding.js'
