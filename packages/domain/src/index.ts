// The domain layer: entities and value types, with no dependencies at all.
//
// Everything the rest of the system agrees on about what a weight, an amount of
// money, a user or a gold rate *is* lives here. Nothing in this package knows
// about SQL, Electron, React or a printer.

// ── value types ────────────────────────────────────────────────────────────
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
export {
  GRAMS_PER_TOLA,
  MASHA_PER_TOLA,
  MAX_KATT_MILLI_RATTI,
  MG_PER_TOLA,
  MILLI_RATTI_PER_TOLA,
  MIN_KATT_MILLI_RATTI,
  RATTI_PER_MASHA,
  RATTI_PER_TOLA,
} from './common/units.js'
export {
  TOLA_IN_MG,
  formatGram,
  formatTola,
  parseGram,
  parseTola,
  toTolaNumber,
} from './common/tola.js'
export {
  businessDayOf,
  fixedClock,
  systemClock,
  toIsoDate,
  toIsoTimestamp,
  type Clock,
  type IsoDate,
  type IsoTimestamp,
} from './common/time.js'

// ── shop ───────────────────────────────────────────────────────────────────
export type { Branch, ShopProfile } from './shop/Shop.js'

// ── parties ────────────────────────────────────────────────────────────────
export type { NewParty, Party, PartyWithBalance } from './parties/Party.js'

// ── users ──────────────────────────────────────────────────────────────────
export {
  ROLES,
  can,
  isRole,
  parseRole,
  permissionsFor,
  type Permissions,
  type Role,
} from './users/Role.js'
export { toPublicUser, type PublicUser, type User } from './users/User.js'

// ── rates ──────────────────────────────────────────────────────────────────
export {
  FINENESS,
  PURITIES,
  formatPurity,
  isPurity,
  parsePurity,
  type Purity,
} from './rates/Purity.js'
export type { GoldRate, NewGoldRate } from './rates/GoldRate.js'

// ── wholesale ──────────────────────────────────────────────────────────────
export { Katt } from './wholesale/Katt.js'
export {
  amountOf,
  computeLine,
  khalisOf,
  totalsOf,
  type WholesaleLineComputed,
  type WholesaleLineInput,
  type WholesaleTotals,
} from './wholesale/lineMath.js'
export {
  MissingRateForSettlementError,
  cashToClear,
  computeSettlement,
  type SettlementInput,
  type SettlementResult,
} from './wholesale/settlementMath.js'
export type {
  PartyLedgerRow,
  WholesaleEntry,
  WholesaleEntryKind,
  WholesaleEntryWithLines,
  WholesaleLineItem,
} from './wholesale/WholesaleEntry.js'

// ── retail ─────────────────────────────────────────────────────────────────
export {
  LABOUR_MODES,
  PAYMENT_METHODS,
  SALE_STATUSES,
  isLabourMode,
  isPaymentMethod,
  isSaleStatus,
  type Customer,
  type LabourMode,
  type NewCustomer,
  type PaymentMethod,
  type RetailSale,
  type RetailSaleItem,
  type RetailSaleWithItems,
  type SaleStatus,
  type Salesman,
} from './retail/RetailSale.js'
export {
  BASIS_POINTS,
  computeRetailInvoice,
  computeRetailLine,
  totalsOfRetail,
  type InvoiceChargeInput,
  type InvoiceComputed,
  type RetailLineComputed,
  type RetailLineInput,
  type RetailTotals,
  type WastageBasis,
  type WastageDirection,
  type WastageRule,
} from './retail/retailMath.js'

// ── audit ──────────────────────────────────────────────────────────────────
export type { AuditAction, AuditEntry, NewAuditEntry } from './audit/AuditEntry.js'
