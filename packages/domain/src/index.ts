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
export {
  assertSafeInteger,
  roundHalfAwayFromZero,
  roundToNearestRupees,
  scaleDiv,
} from './common/rounding.js'
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

// ── purchase ───────────────────────────────────────────────────────────────
export {
  PURCHASE_STATUSES,
  isPurchaseStatus,
  type PurchaseEntry,
  type PurchaseEntryWithLines,
  type PurchaseLineItem,
  type PurchaseStatus,
} from './purchase/PurchaseEntry.js'
export {
  checkStoredFigures,
  computePurchaseLine,
  totalsOfPurchase,
  type PurchaseLineComputed,
  type PurchaseLineInput,
  type PurchaseTotals,
  type StoredFigureCheck,
} from './purchase/purchaseMath.js'

// ── inventory ──────────────────────────────────────────────────────────────
export {
  MAKING_CHARGE_BASES,
  isMakingChargeBasis,
  type Item,
  type ItemCategory,
  type MakingChargeBasis,
  type StockLocation,
} from './inventory/Item.js'
export {
  PIECE_EVENT_KINDS,
  PIECE_SOURCES,
  PIECE_STATUSES,
  isPieceStatus,
  type Piece,
  type PieceEvent,
  type PieceEventKind,
  type PieceSource,
  type PieceStatus,
} from './inventory/Piece.js'
export { computePieceFigures, type PieceFigures } from './inventory/pieceMath.js'

// ── stock ──────────────────────────────────────────────────────────────────
export {
  STOCK_BUCKETS,
  STOCK_MOVEMENT_KINDS,
  isStockBucket,
  isStockMovementKind,
  type StockBucket,
  type StockBucketTotals,
  type StockMovement,
  type StockMovementKind,
} from './stock/StockLedger.js'

// ── retail ─────────────────────────────────────────────────────────────────
export {
  DEFAULT_SLIP_LABEL,
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
  type RetailBill,
  type RetailBillWithSlips,
  type RetailSale,
  type RetailSaleItem,
  type RetailSaleWithItems,
  type RetailSlip,
  type SaleStatus,
  type Salesman,
} from './retail/RetailSale.js'
export { formatInvoiceNo, parseInvoiceNumber } from './retail/invoiceNumber.js'
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
