import type {
  AuditEntry,
  Branch,
  Customer,
  GoldRate,
  IsoDate,
  IsoTimestamp,
  Katt,
  LabourMode,
  Money,
  NewAuditEntry,
  NewCustomer,
  NewGoldRate,
  NewParty,
  Party,
  PaymentMethod,
  Purity,
  RetailBillWithSlips,
  RetailSale,
  RetailSaleWithItems,
  Role,
  SaleStatus,
  Salesman,
  ShopProfile,
  User,
  WastageBasis,
  WastageDirection,
  Weight,
  WholesaleEntry,
  WholesaleEntryKind,
  WholesaleEntryWithLines,
} from '@jewellery/domain'

/**
 * The seam between business logic and the database.
 *
 * Everything the application layer knows about storage is declared here as an
 * interface. `@jewellery/persistence` implements these against SQLite, and the
 * composition root in the Electron main process injects the implementations.
 *
 * Two things this buys, both of them load-bearing:
 *
 *   1. Every calculation is testable with no database. Tests pass in-memory
 *      fakes, which is why `npm run test` needs no server and no window.
 *   2. Moving to PostgreSQL later is a provider swap plus a migration rather
 *      than a rewrite, because no SQL string exists outside persistence.
 *
 * Note what is absent: there is no `update` on the gold rate repository, and
 * there will be none on any transaction repository. Posted rows are never
 * edited — a correction is a new row, or a reversing entry (DECISIONS §6).
 * That rule is enforced here by not offering the method, which is a stronger
 * guarantee than a comment asking people not to call it.
 */

export interface ShopRepository {
  get(): ShopProfile | null
  save(profile: Omit<ShopProfile, 'updatedAt'>): ShopProfile
}

export interface BranchRepository {
  findById(id: string): Branch | null
  findDefault(): Branch | null
  listActive(): Branch[]
  create(branch: Omit<Branch, 'createdAt'>): Branch
  rename(id: string, name: string, address: string | null): Branch
}

export interface NewUser {
  readonly branchId: string | null
  readonly name: string
  readonly username: string
  readonly passwordHash: string
  readonly role: Role
  readonly mustChangePassword: boolean
}

export interface UserRepository {
  findById(id: string): User | null
  /** Case-insensitive, matching the unique index on the column. */
  findByUsername(username: string): User | null
  list(): User[]
  countActiveAdmins(): number
  create(user: NewUser): User
  updateProfile(id: string, changes: { name: string; role: Role; branchId: string | null }): User
  setPassword(id: string, passwordHash: string, mustChangePassword: boolean): User
  setActive(id: string, isActive: boolean): User
  recordLogin(id: string): void
}

export interface GoldRateRepository {
  /**
   * The rate in force for a purity on a given business day.
   *
   * "In force" means the latest rate whose effectiveFrom is on or before that
   * day — not the newest row. Valuation must use the rate that applied on the
   * day of the transaction, or reprinting last month's statement silently
   * reprices it and the paper the customer holds stops matching the screen.
   *
   * Null when no rate has ever been recorded on or before that day, which is a
   * real state on a fresh install and must not be treated as zero.
   */
  findEffective(branchId: string, purity: Purity, on: IsoDate): GoldRate | null
  /** The rate in force today for every purity, for the rate panel. */
  findAllEffective(branchId: string, on: IsoDate): Partial<Record<Purity, GoldRate>>
  history(branchId: string, purity: Purity, limit: number): GoldRate[]
  record(rate: NewGoldRate): GoldRate
}

export interface AuditRepository {
  append(entry: NewAuditEntry): AuditEntry
  recent(limit: number): AuditEntry[]
  forEntity(entity: string, entityId: string): AuditEntry[]
}

export interface SettingsRepository {
  get(key: string): string | null
  set(key: string, value: string): void
  all(): Record<string, string>
}

export type BackupKind = 'AUTO' | 'MANUAL' | 'PRE_RESTORE'

export interface BackupRecord {
  readonly id: string
  readonly filePath: string
  readonly sizeBytes: number
  readonly kind: BackupKind
  readonly integrityOk: boolean
  readonly createdByUserId: string | null
  readonly createdAt: string
}

export interface BackupLogRepository {
  append(record: Omit<BackupRecord, 'id' | 'createdAt'>): BackupRecord
  recent(limit: number): BackupRecord[]
  latest(): BackupRecord | null
}

/** Everything the application layer can reach, handed over as one object. */
export interface Repositories {
  readonly shop: ShopRepository
  readonly branches: BranchRepository
  readonly users: UserRepository
  readonly goldRates: GoldRateRepository
  readonly audit: AuditRepository
  readonly settings: SettingsRepository
  readonly backupLog: BackupLogRepository
  readonly parties: PartyRepository
  readonly wholesale: WholesaleRepository
  readonly customers: CustomerRepository
  readonly salesmen: SalesmanRepository
  readonly retailSales: RetailSaleRepository
  readonly retailBills: RetailBillRepository
}

// ── parties (M1) ────────────────────────────────────────────────────────────

export interface PartySearchResult {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
}

export interface PartyRepository {
  findById(id: string): Party | null
  /** Case-insensitive, matching the unique index on (branch_id, code). */
  findByCode(branchId: string, code: string): Party | null
  /**
   * Type-ahead for the party selector.
   *
   * Matches code or name, prefix matches first so typing "CH" puts "CHJ" above
   * "ALCH". Inactive parties are excluded: a party nobody trades with any more
   * should not be selectable on a new slip, though their ledger stays readable.
   */
  search(branchId: string, query: string, limit: number): PartySearchResult[]
  list(branchId: string, includeInactive: boolean): Party[]
  create(party: NewParty): Party
  update(
    id: string,
    changes: {
      name: string
      mobile: string | null
      city: string | null
      notes: string | null
    },
  ): Party
  setActive(id: string, isActive: boolean): Party
}

// ── wholesale (M2) ──────────────────────────────────────────────────────────

/** A slip to be posted. Ids, totals and deltas are computed by the service. */
export interface NewWholesaleEntry {
  readonly branchId: string
  readonly partyId: string
  readonly kind: WholesaleEntryKind
  readonly invoiceNo: string
  readonly entryDate: IsoDate
  readonly ratePerTola: Money | null
  readonly totalGross: Weight
  readonly totalKhalis: Weight
  readonly totalAmount: Money
  readonly settledGold: Weight
  readonly settledCash: Money
  readonly settledCashAsGold: Weight
  readonly goldDelta: Weight
  readonly cashDelta: Money
  readonly isOverReturn: boolean
  readonly confirmedByUserId: string | null
  readonly reversesEntryId: string | null
  readonly notes: string | null
  readonly createdByUserId: string
  readonly lines: readonly NewWholesaleLine[]
}

export interface NewWholesaleLine {
  readonly lineNo: number
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  readonly khalis: Weight
  readonly ratePerTola: Money
  readonly amount: Money
  readonly remarks: string | null
}

export interface WholesaleRepository {
  /**
   * Posts a slip and its lines in ONE transaction.
   *
   * A half-written slip — header with no lines, or lines with no header — would
   * put the ledger out by whatever the missing part was worth, so this is
   * atomic or it does not happen.
   */
  post(entry: NewWholesaleEntry): WholesaleEntryWithLines

  findById(id: string): WholesaleEntryWithLines | null
  findByInvoiceNo(branchId: string, invoiceNo: string): WholesaleEntryWithLines | null

  /** The next free slip number for the branch, e.g. "WS-10026". */
  nextInvoiceNo(branchId: string, prefix: string): string

  /**
   * The party's current gold and cash balances.
   *
   * Derived by summing the deltas, never stored on the party — a stored balance
   * that disagrees with the entries behind it is the classic accounting bug,
   * and the entries are the half that can be audited. The party's opening
   * balance is added by the service, not here.
   */
  balances(partyId: string): { goldMg: number; cashPaisa: number }

  /** Entries for one party, oldest first, for the running-balance ledger. */
  listForParty(partyId: string, limit: number): WholesaleEntry[]

  listRecent(branchId: string, limit: number): WholesaleEntry[]

  /** Stamps the original with the id of the entry that reversed it. */
  markReversed(originalId: string, reversalId: string): void
}

// ── retail ──────────────────────────────────────────────────────────────────

export interface CustomerSearchResult {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
  readonly isWalkIn: boolean
}

export interface CustomerRepository {
  create(customer: NewCustomer, createdByUserId: string): Customer
  findById(id: string): Customer | null
  findByCode(code: string): Customer | null
  /** Prefix on name, or anywhere in the mobile. Ordered by name. */
  search(term: string, limit: number): CustomerSearchResult[]
  /** The next free code for a given prefix, e.g. "C-0007". */
  nextCode(prefix: string): string
}

export interface SalesmanRepository {
  list(activeOnly: boolean): Salesman[]
  findById(id: string): Salesman | null
}

export interface NewRetailSaleItem {
  readonly lineNo: number
  readonly itemName: string
  readonly purity: Purity
  readonly grossWeight: Weight
  readonly stoneWeight: Weight
  readonly cutPerTola: Weight
  readonly netWeight: Weight
  readonly wastageBp: number
  readonly wastage: Weight
  readonly fineWeight: Weight
  readonly labourCharges: Money
  readonly labourMode: LabourMode
  readonly stoneCharges: Money
  readonly lineAmount: Money
}

export interface NewRetailSale {
  readonly branchId: string
  readonly saleDate: IsoDate
  readonly saleTime: string
  readonly customerId: string | null
  readonly customerNameSnapshot: string
  readonly customerMobileSnapshot: string | null
  readonly salesmanId: string | null
  readonly salesmanNameSnapshot: string | null
  readonly ratePurity: Purity
  readonly ratePerTola: Money
  readonly goldValue: Money
  readonly customerGold: Weight
  readonly customerGoldPurity: Purity | null
  readonly customerGoldValue: Money
  readonly hallmarkCharges: Money
  readonly otherCharges: Money
  readonly discount: Money
  readonly grandTotal: Money
  readonly amountPaid: Money
  readonly paymentMethod: PaymentMethod
  readonly balance: Money
  readonly amountInWords: string
  readonly remarks: string | null
  readonly status: SaleStatus
  /**
   * The wastage rule this sale was PRICED with, stored on the row.
   *
   * The rule is a setting the shop can change. Without these two columns,
   * changing it would silently re-price every past invoice the next time one
   * was reprinted — history would move under the shop's feet. With them, an old
   * sale always reproduces exactly, and the setting only affects sales made
   * after it changed.
   */
  readonly wastageDirection: WastageDirection
  readonly wastageBasis: WastageBasis
  /**
   * The draft this sale was posted from. UNIQUE where not null, so a retry
   * cannot write a second invoice for one transaction.
   */
  readonly draftId: string | null
  readonly createdByUserId: string
  readonly items: readonly NewRetailSaleItem[]
}

export interface RetailSaleFilter {
  readonly branchId: string
  readonly fromDate?: IsoDate
  readonly toDate?: IsoDate
  readonly customerId?: string
  readonly status?: SaleStatus
  readonly limit: number
}

export interface RetailSaleRepository {
  /**
   * Writes the sale, every item and the sequence bump in ONE transaction.
   *
   * The invoice number is allocated INSIDE that transaction, never reserved by
   * the UI beforehand: two counters saving at the same moment must not be able
   * to take the same number, and a sale that is abandoned must not leave a hole
   * that a later sale silently fills. ONE continuous sequence — it never resets,
   * so an invoice number is unique on its own terms.
   */
  post(sale: NewRetailSale, prefix: string): RetailSaleWithItems

  findById(id: string): RetailSaleWithItems | null
  findByInvoiceNo(invoiceNo: string): RetailSaleWithItems | null
  /** The already-posted sale for a draft, if one exists. Idempotency. */
  findByDraftId(draftId: string): RetailSaleWithItems | null
  list(filter: RetailSaleFilter): RetailSale[]

  /** A PREVIEW of the next number. Reserves nothing — see `post`. */
  peekNextInvoiceNo(prefix: string): string

  /** Marks a posted sale void. Never deletes; the number stays burned. */
  markVoid(id: string, reason: string, voidedAt: IsoTimestamp): void
}

// ── bills, which group slips ────────────────────────────────────────────────

/** One slip to be written under a bill. The sale itself, plus its place. */
export interface NewRetailSlip {
  readonly slipNo: number
  readonly slipLabel: string
  readonly sale: NewRetailSale
}

export interface NewRetailBill {
  readonly branchId: string
  readonly billDate: IsoDate
  readonly billTime: string
  readonly customerId: string | null
  readonly customerNameSnapshot: string
  readonly customerMobileSnapshot: string | null
  readonly salesmanId: string | null
  readonly salesmanNameSnapshot: string | null
  readonly status: SaleStatus
  readonly createdByUserId: string
  readonly slips: readonly NewRetailSlip[]
}

export interface RetailBillRepository {
  /**
   * The bill, every slip, every item and BOTH sequence bumps in ONE transaction.
   *
   * This is the guarantee the whole bill concept rests on: either the visit is
   * recorded or none of it is. A bill that posted two of its three slips is
   * worse than one that posted none — the customer walks out with two invoices
   * and a third piece of gold nothing in the books accounts for, and no screen
   * shows that anything is missing.
   *
   * Each slip still takes its own invoice number from the same continuous
   * sequence, because each slip is a real document the customer is handed. The
   * bill takes a number of its own from a separate sequence. If any slip fails
   * a constraint, every allocation in this call rolls back with it.
   */
  postBill(bill: NewRetailBill, billPrefix: string, invoicePrefix: string): RetailBillWithSlips

  findById(id: string): RetailBillWithSlips | null
  findByBillNo(billNo: string): RetailBillWithSlips | null

  /** A PREVIEW of the next bill number. Reserves nothing — see `postBill`. */
  peekNextBillNo(prefix: string): string
}
