// Business calculations. Depends on domain only — no SQL, no Electron, no
// React, so every calculation here is testable with no database and no window.

export {
  PartyService,
  type CreatePartyInput,
  type PartyDependencies,
} from './parties/PartyService.js'

export type {
  AuditRepository,
  BackupKind,
  BackupLogRepository,
  BackupRecord,
  BranchRepository,
  GoldRateRepository,
  NewUser,
  Repositories,
  PartyRepository,
  PartySearchResult,
  NewWholesaleEntry,
  NewWholesaleLine,
  NewPurchaseEntry,
  NewPurchaseLine,
  NewStockMovement,
  ItemRepository,
  ItemCategoryRepository,
  ItemUpdate,
  LocationRepository,
  NewItem,
  NewItemCategory,
  NewLocation,
  NewPiece,
  PieceFilter,
  PieceRepository,
  PieceSummaryGroup,
  PurchaseNeighbours,
  PurchaseRepository,
  StockLedgerRepository,
  StockMovementFilter,
  SettingsRepository,
  ShopRepository,
  UserRepository,
  WholesaleRepository,
  CustomerRepository,
  CustomerSearchResult,
  SalesmanRepository,
  DraftBill,
  DraftItem,
  DraftSlip,
  DraftWeight,
  NewRetailBill,
  NewRetailSale,
  NewRetailSaleItem,
  NewRetailSlip,
  RetailBillRepository,
  RetailDraftRepository,
  RetailNeighbours,
  RetailSaleFilter,
  RetailSaleRepository,
} from './abstractions/repositories.js'
export type { BackupStore, IdGenerator } from './abstractions/services.js'

export {
  HighWastageRequiresConfirmationError,
  RetailSaleService,
  WASTAGE_CONFIRM_ABOVE_BP,
  WASTAGE_MAX_BP,
  type RetailCalculation,
  type RetailDependencies,
  type RetailDraftInput,
  type RetailItemInput,
} from './retail/RetailSaleService.js'
export { amountInWords, numberToWords } from './retail/amountInWords.js'
export { CustomerService, type CustomerDependencies } from './retail/CustomerService.js'

export {
  AuthService,
  MINIMUM_PASSWORD_LENGTH,
  PermissionError,
  ValidationError,
  type AuthDependencies,
  type LoginResult,
} from './auth/AuthService.js'
export {
  DEFAULT_PARAMETERS,
  createPasswordHasher,
  type HashParameters,
  type PasswordHasher,
} from './auth/PasswordHasher.js'

export { NoRateError, RateService, type RateDependencies } from './rates/RateService.js'
export {
  DEFAULT_OVER_RETURN_TOLERANCE_MG,
  DEFAULT_RETAIL_ROUNDING,
  RETAIL_ROUNDING_STEPS,
  SETTING_KEYS,
  SUGGESTED_KATT_MAX_MILLI_RATTI,
  SUGGESTED_KATT_MIN_MILLI_RATTI,
  Settings,
  type RoundingStep,
  type WindowBounds,
  type WindowMode,
  type WindowState,
} from './settings/keys.js'
export {
  OverReturnRequiresConfirmationError,
  WHOLESALE_RATE_PURITY,
  WholesaleService,
  type IssueLineInput,
  type KattWarning,
  type PostIssueInput,
  type PostedResult,
  type SettleInput,
  type WholesaleDependencies,
} from './wholesale/WholesaleService.js'
export {
  PURCHASE_RATE_PURITY,
  PurchaseService,
  type PostedPurchaseResult,
  type PurchaseDependencies,
  type PurchaseLineEntryInput,
  type SavePurchaseInput,
} from './purchase/PurchaseService.js'
export {
  InventoryService,
  type CategoryNode,
  type CreateItemInput,
  type InventoryDependencies,
} from './inventory/InventoryService.js'
export {
  PieceService,
  type InventorySummary,
  type InventorySummaryRow,
  type OpeningLineInput,
  type OpeningStockInput,
  type PieceDependencies,
  type SummaryGrouping,
} from './inventory/PieceService.js'
export {
  STOCK_VALUATION_PURITY,
  StockService,
  type AdjustmentInput,
  type BucketStanding,
  type StockDependencies,
  type StockLedgerRow,
  type StockSummary,
} from './stock/StockService.js'
export {
  BackupService,
  BackupVerificationError,
  DEFAULT_RETENTION,
  type BackupDependencies,
  type RetentionPolicy,
} from './backup/BackupService.js'

/**
 * In-memory repositories, for tests in other packages.
 *
 * Exported deliberately rather than reached for across package boundaries with
 * a relative path. The main process's IPC handlers have their own tests, and
 * the whole point of those tests is that they run with no database — which
 * means they need these fakes, and a `../../../application/src/...` import
 * would be a second, unsupported way into this package.
 *
 * They are test doubles, not behaviour: nothing in `desktop/main`,
 * `persistence` or `printing` may construct one outside a test.
 */
export {
  FakeAuditRepository,
  FakeCustomerRepository,
  FakeGoldRateRepository,
  FakeItemCategoryRepository,
  FakeItemRepository,
  FakeLocationRepository,
  FakePartyRepository,
  FakePieceRepository,
  FakePurchaseRepository,
  FakeStockLedgerRepository,
  FakeRetailBillRepository,
  FakeRetailDraftRepository,
  FakeRetailSaleRepository,
  FakeSalesmanRepository,
  FakeSettingsRepository,
  FakeUserRepository,
  FakeWholesaleRepository,
  counterIds,
} from './testing/fakes.js'
