import type {
  AuditEntry,
  Branch,
  Customer,
  GoldRate,
  IsoDate,
  IsoTimestamp,
  Item,
  ItemCategory,
  Katt,
  MakingChargeBasis,
  LabourMode,
  Money,
  NewAuditEntry,
  NewCustomer,
  NewGoldRate,
  NewParty,
  Party,
  PaymentMethod,
  Piece,
  PieceEvent,
  PieceSource,
  PieceStatus,
  Purity,
  PurchaseEntry,
  PurchaseEntryWithLines,
  PurchaseStatus,
  RetailBillWithSlips,
  RetailSale,
  RetailSaleWithItems,
  Role,
  SaleStatus,
  Salesman,
  ShopProfile,
  StockBucket,
  StockBucketTotals,
  StockLocation,
  StockMovement,
  StockMovementKind,
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
  readonly retailDrafts: RetailDraftRepository
  readonly purchases: PurchaseRepository
  readonly stockLedger: StockLedgerRepository
  readonly items: ItemRepository
  readonly itemCategories: ItemCategoryRepository
  readonly locations: LocationRepository
  readonly pieces: PieceRepository
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
  /**
   * `createdByUserId` is taken rather than defaulted, and that is not
   * bookkeeping for its own sake: the directory row records who put a name in
   * the book, and a repository that filled the column in with "the first user"
   * would be writing an answer nobody gave.
   */
  create(party: NewParty, createdByUserId: string): Party
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

  /**
   * One slip, by the number printed on it.
   *
   * The kind is part of the key, not decoration: issues and settlements are two
   * books numbered from two sequences, so both hold a slip 1 and asking for
   * "slip 1" without saying which book is a question with two answers.
   */
  findByNumber(
    branchId: string,
    kind: WholesaleEntryKind,
    invoiceNumber: number,
  ): WholesaleEntryWithLines | null

  /**
   * Where FIRST / PREV / NEXT / LAST can go from `current`, as bare integers.
   *
   * `current` null means the screen is holding a slip that has not been posted,
   * which sits one PAST the end of the book — so PREV goes to the newest slip
   * and NEXT has nowhere to go. Null anywhere else means "nowhere to go", which
   * is what renders as a disabled arrow.
   */
  neighbours(
    branchId: string,
    current: number | null,
    includeReversed: boolean,
  ): { first: number | null; previous: number | null; next: number | null; last: number | null }

  /**
   * A PREVIEW of the next slip number. Reserves nothing and burns nothing.
   *
   * The real number is taken inside the posting transaction, which is what stops
   * two counters being handed the same one.
   */
  peekNextNumber(kind: WholesaleEntryKind): number

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
  readonly purityDeduction: Weight
  readonly netWeight: Weight
  readonly wastageBp: number
  readonly wastage: Weight
  readonly fineWeight: Weight
  readonly labourCharges: Money
  readonly labourMode: LabourMode
  readonly stoneCharges: Money
  /** What this line was priced at. Zero means not recorded — migration 014. */
  readonly ratePerTola: Money
  readonly lineAmount: Money
}

export interface NewRetailSale {
  readonly branchId: string
  readonly saleDate: IsoDate
  readonly saleTime: string
  readonly customerId: string | null
  readonly customerNameSnapshot: string
  readonly customerMobileSnapshot: string | null
  /**
   * Kept, and always written null by the service.
   *
   * The shop does not track a salesman. The COLUMNS stay so an older sale keeps
   * whatever it recorded and so re-adding the field is a UI change rather than
   * a migration — but nothing sets them any more. See migration 005.
   */
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

/**
 * The four places the navigation controls can go. Null means "nowhere".
 *
 * Invoice NUMBERS rather than ids, because that is what the toolbar shows and
 * what the operator types into the jump box — and carrying the id here would
 * mean the same journey identified two ways.
 */
export interface RetailNeighbours {
  readonly first: number | null
  readonly previous: number | null
  readonly next: number | null
  readonly last: number | null
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
   *
   * Takes no prefix. The number IS an integer; the shop's prefix is a display
   * setting applied by `formatInvoiceNo` at the moment of showing or printing,
   * so nothing on this path can bake one into a stored row.
   */
  post(sale: NewRetailSale): RetailSaleWithItems

  findById(id: string): RetailSaleWithItems | null
  findByInvoiceNumber(invoiceNumber: number): RetailSaleWithItems | null
  /** The already-posted sale for a draft, if one exists. Idempotency. */
  findByDraftId(draftId: string): RetailSaleWithItems | null
  list(filter: RetailSaleFilter): RetailSale[]

  /** A PREVIEW of the next number. Reserves nothing — see `post`. */
  peekNextInvoiceNumber(): number

  /**
   * Where FIRST / PREV / NEXT / LAST can go from `current`.
   *
   * All four in one answer, so the toolbar cannot render an arrow live that
   * turns out to have nowhere to step. Ordered by the integer, never the text.
   */
  neighbours(
    branchId: string,
    current: number | null,
    includeVoid: boolean,
  ): RetailNeighbours

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
  postBill(bill: NewRetailBill, billPrefix: string): RetailBillWithSlips

  findById(id: string): RetailBillWithSlips | null
  findByBillNo(billNo: string): RetailBillWithSlips | null

  /** A PREVIEW of the next bill number. Reserves nothing — see `postBill`. */
  peekNextBillNo(prefix: string): string
}

// ── the bill in progress ────────────────────────────────────────────────────
//
// The editor's own state, kept on disk so a crash or a power cut at the counter
// does not lose it. Deliberately its OWN shape rather than a half-built
// RetailBill: a draft has no invoice number, no totals and no amount in words,
// because none of those exist until it is posted (see migration 011).
//
// Typed text travels with the exact milligram, which is WeightFieldDto's own
// contract: the text is what is in the box, the integer is set only when the
// unit toggle produced it. Storing one without the other would either eat a
// half-typed figure or re-round a stored weight.

export interface DraftWeight {
  readonly text: string
  readonly exactMg: number | null
}

export interface DraftItem {
  readonly lineNo: number
  readonly itemName: string
  readonly purity: string
  readonly gross: DraftWeight
  readonly stone: DraftWeight
  readonly purityDeduction: DraftWeight
  readonly wastagePercent: string
  readonly labourCharges: string
  readonly labourMode: string
  readonly stoneCharges: string
  /** As typed. Empty means "use this item's purity rate" — never zero. */
  readonly ratePerTola: string
}

export interface DraftSlip {
  readonly slipNo: number
  readonly slipLabel: string
  /** The idempotency key this slip will post with. Minted once, then kept. */
  readonly draftKey: string
  readonly customerGold: DraftWeight
  readonly customerGoldPurity: string | null
  readonly hallmarkCharges: string
  readonly otherCharges: string
  readonly discount: string
  readonly amountPaid: string
  readonly paymentMethod: string
  readonly remarks: string | null
  readonly items: readonly DraftItem[]
}

export interface DraftBill {
  readonly branchId: string
  readonly billDate: IsoDate
  readonly billTime: string
  readonly customerId: string | null
  readonly customerName: string
  readonly customerMobile: string | null
  readonly ratePurity: string
  readonly ratePerTolaOverride: string
  readonly weightUnit: string
  readonly activeSlipNo: number
  /** Which line is open in DETAILS, if any. An unresolved edit blocks a save. */
  readonly createdByUserId: string
  readonly slips: readonly DraftSlip[]
}

// ── purchase (M6) ───────────────────────────────────────────────────────────

/** A purchase to be saved. Khalis, amounts and totals are computed by the service. */
export interface NewPurchaseLine {
  readonly lineNo: number
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  readonly khalis: Weight
  readonly ratePerTola: Money
  readonly amount: Money
  readonly bucket: StockBucket
  readonly remarks: string | null
}

export interface NewPurchaseEntry {
  readonly branchId: string
  readonly partyId: string
  readonly entryDate: IsoDate
  /**
   * 'posted' writes the stock movements; 'held' writes NONE. A held purchase
   * has not happened yet — it has a number and a screenful of typed lines, and
   * nothing else.
   */
  readonly status: Extract<PurchaseStatus, 'held' | 'posted'>
  readonly ratePerTola: Money
  readonly totalGross: Weight
  readonly totalKhalis: Weight
  readonly totalAmount: Money
  readonly notes: string | null
  readonly createdByUserId: string
  /**
   * When saving over a HELD purchase: keep its invoice number, replace its
   * lines. Null for a fresh save. Replacing a held slip is not an edit of
   * posted history — a held slip has written nothing to any ledger.
   */
  readonly heldId: string | null
  readonly lines: readonly NewPurchaseLine[]
}

export interface PurchaseNeighbours {
  readonly first: number | null
  readonly previous: number | null
  readonly next: number | null
  readonly last: number | null
}

export interface PurchaseRepository {
  /**
   * Header, lines AND stock movements in ONE transaction, with the invoice
   * number allocated inside it. A half-written purchase leaves stock
   * permanently wrong with nothing pointing at the cause, and a number read
   * outside the transaction can be handed to a second terminal before the
   * first has written its row.
   */
  post(entry: NewPurchaseEntry): PurchaseEntryWithLines

  /**
   * Cancels a purchase. For a POSTED one, writes reversing stock rows (same
   * kind, opposite sign) in the same transaction that flips the status; the
   * original rows are never touched and the pair nets to zero. A HELD one
   * wrote no stock, so only the status flips. The number stays burned.
   */
  cancel(id: string, reason: string): PurchaseEntryWithLines

  findById(id: string): PurchaseEntryWithLines | null

  /** One purchase, by the number printed on it. Cancelled ones still answer. */
  findByNumber(branchId: string, invoiceNumber: number): PurchaseEntryWithLines | null

  /**
   * Where FIRST / PREV / NEXT / LAST can go from `current`. Null current means
   * an unsaved slip one PAST the end of the book. Cancelled purchases are
   * excluded unless asked for — the gap is what tells the operator one was
   * taken back.
   */
  neighbours(
    branchId: string,
    current: number | null,
    includeCancelled: boolean,
  ): PurchaseNeighbours

  /** A PREVIEW of the next number. Reserves nothing — see `post`. */
  peekNextNumber(): number

  listRecent(branchId: string, limit: number): PurchaseEntry[]
}

// ── inventory setup (M4 stage 1) ────────────────────────────────────────────

/** An item to be created. NO weight and NO quantity — see domain/inventory. */
export interface NewItem {
  readonly branchId: string
  readonly code: string
  readonly name: string
  readonly categoryId: string | null
  readonly purity: Purity
  readonly defaultKatt: Katt
  readonly makingChargeBasis: MakingChargeBasis
  readonly defaultMakingCharge: Money
  readonly supplierId: string | null
  readonly designNo: string | null
  readonly notes: string | null
  readonly createdByUserId: string
}

/** Everything editable after creation. The code is not — it prints on tags. */
export interface ItemUpdate {
  readonly name: string
  readonly categoryId: string | null
  readonly purity: Purity
  readonly defaultKatt: Katt
  readonly makingChargeBasis: MakingChargeBasis
  readonly defaultMakingCharge: Money
  readonly supplierId: string | null
  readonly designNo: string | null
  readonly notes: string | null
}

export interface ItemRepository {
  findById(id: string): Item | null
  /** Case-insensitive, matching the unique index on (branch_id, code). */
  findByCode(branchId: string, code: string): Item | null
  /**
   * Type-ahead over code, name and design number, prefix matches first —
   * the same ranking the party selector earned.
   */
  search(branchId: string, query: string, includeInactive: boolean, limit: number): Item[]
  list(branchId: string, includeInactive: boolean): Item[]
  create(item: NewItem): Item
  update(id: string, changes: ItemUpdate): Item
  setActive(id: string, isActive: boolean): Item
}

export interface NewItemCategory {
  readonly branchId: string
  readonly parentId: string | null
  readonly name: string
}

export interface ItemCategoryRepository {
  findById(id: string): ItemCategory | null
  /** Flat, both levels; the service arranges the tree. */
  list(branchId: string, includeInactive: boolean): ItemCategory[]
  create(category: NewItemCategory): ItemCategory
  rename(id: string, name: string): ItemCategory
  /** Deactivate, never delete — old items keep their label readable. */
  setActive(id: string, isActive: boolean): ItemCategory
}

export interface NewLocation {
  readonly branchId: string
  readonly name: string
}

export interface LocationRepository {
  findById(id: string): StockLocation | null
  list(branchId: string, includeInactive: boolean): StockLocation[]
  create(location: NewLocation): StockLocation
  rename(id: string, name: string): StockLocation
  setActive(id: string, isActive: boolean): StockLocation
}

// ── pieces (M4 stage 2) ─────────────────────────────────────────────────────

/** A piece to be created. Net and khalis are computed by the service. */
export interface NewPiece {
  readonly branchId: string
  /** Null means "allocate the next tag from the book". A typed number keeps
   *  a tag the shop already has tied on. */
  readonly tagNumber: number | null
  readonly itemId: string
  readonly gross: Weight
  readonly stone: Weight
  readonly stoneCount: number
  readonly net: Weight
  readonly katt: Katt
  readonly khalis: Weight
  readonly locationId: string | null
  readonly sourceType: PieceSource
  readonly sourceId: string | null
  readonly createdByUserId: string
}

/**
 * Undefined means "any"; null means "none recorded" — the drill from a
 * summary row needs both, because "no location" is a real group.
 */
export interface PieceFilter {
  readonly branchId: string
  readonly status?: PieceStatus
  readonly itemId?: string
  readonly categoryId?: string | null
  readonly purity?: Purity
  readonly locationId?: string | null
  readonly supplierId?: string | null
  readonly limit?: number
}

/** One GROUP BY row over IN_STOCK pieces. The service regroups these. */
export interface PieceSummaryGroup {
  readonly categoryId: string | null
  readonly purity: Purity
  readonly locationId: string | null
  readonly supplierId: string | null
  readonly count: number
  readonly grossMg: number
  readonly khalisMg: number
}

export interface PieceRepository {
  /**
   * Creates every piece AND its stock-ledger row in ONE transaction, with tag
   * numbers allocated inside it. This is the invariant's foundation: a piece
   * without its ledger row — or a ledger row without its piece — is the silent
   * drift that destroys trust in the whole system, so neither can exist alone
   * even for a millisecond. One OPENING/PURCHASE_IN row per piece, FINISHED
   * bucket, referencing the piece by id.
   */
  createBatch(
    pieces: readonly NewPiece[],
    movement: {
      readonly kind: 'OPENING' | 'PURCHASE_IN'
      readonly at: IsoTimestamp
      readonly note: string | null
    },
  ): Piece[]

  findById(id: string): Piece | null
  findByTag(branchId: string, tagNumber: number): Piece | null
  list(filter: PieceFilter): Piece[]

  /** GROUP BY over IN_STOCK pieces joined to their items. Derived, never stored. */
  summaryGroups(branchId: string): PieceSummaryGroup[]

  /** SUM over IN_STOCK pieces — the piece side of the stage-3 reconciliation. */
  inStockTotals(branchId: string): { grossMg: number; khalisMg: number }

  /** Re-shelves a piece. Writes the MOVED event; touches no ledger — the
   *  metal did not change, only where it sits. */
  moveTo(pieceId: string, locationId: string | null, byUserId: string): Piece

  /** A piece's history, oldest first. */
  events(pieceId: string): PieceEvent[]

  /** A PREVIEW of the next tag number. Reserves nothing. */
  peekNextTag(): number
}

// ── stock (M4) ──────────────────────────────────────────────────────────────

/** A movement to be appended. Signed: incoming positive, outgoing negative. */
export interface NewStockMovement {
  readonly branchId: string
  readonly kind: StockMovementKind
  readonly bucket: StockBucket
  readonly gross: Weight
  readonly khalis: Weight
  readonly katt: Katt | null
  readonly ratePerTola: Money | null
  readonly refType: string | null
  readonly refId: string | null
  readonly itemName: string | null
  readonly note: string | null
  readonly createdByUserId: string
}

export interface StockMovementFilter {
  readonly branchId: string
  readonly fromDate?: IsoDate
  readonly toDate?: IsoDate
  readonly bucket?: StockBucket
  readonly kind?: StockMovementKind
}

export interface StockLedgerRepository {
  /**
   * Appends one movement. That is the only write this ledger has: nothing is
   * ever updated in place and nothing is ever deleted. Corrections are new
   * ADJUSTMENT rows, reversals are new rows with the opposite sign.
   */
  append(movement: NewStockMovement): StockMovement

  /**
   * Movements oldest first, so a running balance accumulates down the list.
   * The filter narrows what is RETURNED; the running balance the service
   * shows is computed over the unfiltered ledger, or the rightmost column
   * would stop agreeing with the summary.
   */
  list(filter: StockMovementFilter): StockMovement[]

  /** Every movement a document produced, e.g. a purchase and its reversal. */
  forRef(refType: string, refId: string): StockMovement[]

  /**
   * Current standing per bucket: SUM(gross), SUM(khalis), grouped by bucket.
   * Derived every time, never stored. Buckets with no movements are absent.
   */
  summary(branchId: string): StockBucketTotals[]
}

export interface RetailDraftRepository {
  /**
   * Writes the branch's draft, replacing whatever was there.
   *
   * One transaction, and REPLACE rather than merge: a counter serves one
   * customer at a time, so the draft is the current state of the screen and
   * not an accumulating history of it. Called on a debounce as the operator
   * types, which is why it must be cheap and must never half-apply.
   */
  save(draft: DraftBill): void

  /** The branch's open draft, or null. Read once, on launch. */
  find(branchId: string): DraftBill | null

  /** Throws the draft away. Only ever on an explicit Discard, or after posting. */
  clear(branchId: string): void
}
