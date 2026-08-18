import {
  Money,
  toIsoDate,
  toIsoTimestamp,
  type AuditEntry,
  type Clock,
  type GoldRate,
  type IsoDate,
  type NewAuditEntry,
  type NewGoldRate,
  type IsoTimestamp,
  type Piece,
  type PieceEvent,
  type Purity,
  type NewParty,
  type Party,
  type Role,
  type User,
  type WholesaleEntry,
  type WholesaleEntryKind,
  type WholesaleEntryWithLines,
  type Customer,
  type Item,
  type ItemCategory,
  type NewCustomer,
  type PurchaseEntry,
  type PurchaseEntryWithLines,
  type RetailBillWithSlips,
  type RetailSale,
  type RetailSaleWithItems,
  type RetailSlip,
  type Salesman,
  type StockBucketTotals,
  type StockLocation,
  type StockMovement,
  Weight,
} from '@jewellery/domain'
import type {
  AuditRepository,
  CustomerRepository,
  CustomerSearchResult,
  GoldRateRepository,
  DraftBill,
  ItemCategoryRepository,
  ItemRepository,
  ItemUpdate,
  LocationRepository,
  NewItem,
  NewItemCategory,
  NewLocation,
  NewPiece,
  NewPurchaseEntry,
  NewRetailBill,
  NewRetailSale,
  NewStockMovement,
  PieceFilter,
  PieceRepository,
  PieceSummaryGroup,
  NewUser,
  NewWholesaleEntry,
  PartyRepository,
  PartySearchResult,
  PurchaseNeighbours,
  PurchaseRepository,
  RetailBillRepository,
  RetailDraftRepository,
  RetailNeighbours,
  RetailSaleFilter,
  RetailSaleRepository,
  SalesmanRepository,
  SettingsRepository,
  StockLedgerRepository,
  StockMovementFilter,
  UserRepository,
  WholesaleRepository,
} from '../abstractions/repositories.js'

/**
 * In-memory repositories.
 *
 * These exist so that every calculation can be tested with no database and no
 * window (docs/DECISIONS.md §9). If a service could only be exercised by
 * starting SQLite, the layering would not be doing its job.
 *
 * They are deliberately simple and slow — correctness over speed. Where
 * behaviour must match the real thing, it is noted.
 */

export function counterIds(prefix = 'id'): { next(): string } {
  let n = 0
  return { next: () => `${prefix}-${++n}` }
}

export class FakeUserRepository implements UserRepository {
  private readonly rows = new Map<string, User>()
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): User | null {
    return this.rows.get(id) ?? null
  }

  /** Case-insensitive, matching the real unique index on the column. */
  findByUsername(username: string): User | null {
    const target = username.toLowerCase()
    for (const user of this.rows.values()) {
      if (user.username.toLowerCase() === target) return user
    }
    return null
  }

  list(): User[] {
    return [...this.rows.values()]
  }

  countActiveAdmins(): number {
    return this.list().filter((u) => u.role === 'ADMIN' && u.isActive).length
  }

  create(user: NewUser): User {
    const now = toIsoTimestamp(this.clock.now())
    const created: User = {
      id: `user-${++this.sequence}`,
      branchId: user.branchId,
      name: user.name,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      isActive: true,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(created.id, created)
    return created
  }

  updateProfile(
    id: string,
    changes: { name: string; role: Role; branchId: string | null },
  ): User {
    return this.mutate(id, (u) => ({ ...u, ...changes }))
  }

  setPassword(id: string, passwordHash: string, mustChangePassword: boolean): User {
    return this.mutate(id, (u) => ({ ...u, passwordHash, mustChangePassword }))
  }

  setActive(id: string, isActive: boolean): User {
    return this.mutate(id, (u) => ({ ...u, isActive }))
  }

  recordLogin(id: string): void {
    this.mutate(id, (u) => ({ ...u, lastLoginAt: toIsoTimestamp(this.clock.now()) }))
  }

  private mutate(id: string, change: (user: User) => User): User {
    const existing = this.rows.get(id)
    if (!existing) throw new Error(`No such user: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows.set(id, updated)
    return updated
  }
}

export class FakeAuditRepository implements AuditRepository {
  readonly entries: AuditEntry[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  append(entry: NewAuditEntry): AuditEntry {
    const created: AuditEntry = {
      ...entry,
      id: `audit-${++this.sequence}`,
      createdAt: toIsoTimestamp(this.clock.now()),
    }
    this.entries.push(created)
    return created
  }

  recent(limit: number): AuditEntry[] {
    return [...this.entries].reverse().slice(0, limit)
  }

  forEntity(entity: string, entityId: string): AuditEntry[] {
    return this.entries.filter((e) => e.entity === entity && e.entityId === entityId)
  }

  /** Test helper — the actions recorded, in order. */
  actions(): string[] {
    return this.entries.map((e) => e.action)
  }
}

export class FakeGoldRateRepository implements GoldRateRepository {
  readonly rows: GoldRate[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  /**
   * The latest rate whose effectiveFrom is on or before `on` — not the newest
   * row. Ties on the same day are broken by insertion order, so a correction
   * recorded later the same day wins, matching the real index's
   * `ORDER BY effective_from DESC, created_at DESC`.
   */
  findEffective(branchId: string, purity: Purity, on: IsoDate): GoldRate | null {
    const candidates = this.rows
      .filter((r) => r.branchId === branchId && r.purity === purity && r.effectiveFrom <= on)
      .sort((a, b) =>
        a.effectiveFrom === b.effectiveFrom
          ? a.createdAt.localeCompare(b.createdAt)
          : a.effectiveFrom.localeCompare(b.effectiveFrom),
      )
    return candidates.at(-1) ?? null
  }

  findAllEffective(branchId: string, on: IsoDate): Partial<Record<Purity, GoldRate>> {
    const result: Partial<Record<Purity, GoldRate>> = {}
    for (const purity of new Set(this.rows.map((r) => r.purity))) {
      const rate = this.findEffective(branchId, purity, on)
      if (rate) result[purity] = rate
    }
    return result
  }

  history(branchId: string, purity: Purity, limit: number): GoldRate[] {
    return this.rows
      .filter((r) => r.branchId === branchId && r.purity === purity)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
      .slice(0, limit)
  }

  record(rate: NewGoldRate): GoldRate {
    // Distinct, increasing createdAt values even under a frozen clock, so
    // same-day ordering is deterministic in tests.
    const stamp = new Date(this.clock.now().getTime() + this.sequence)
    const created: GoldRate = {
      ...rate,
      id: `rate-${++this.sequence}`,
      createdAt: toIsoTimestamp(stamp),
    }
    this.rows.push(created)
    return created
  }

  /** Test helper — seed a rate without going through the service. */
  seed(
    branchId: string,
    purity: Purity,
    rupeesPerTola: number,
    effectiveFrom: string,
  ): GoldRate {
    return this.record({
      branchId,
      purity,
      ratePerTola: Money.fromRupees(rupeesPerTola),
      effectiveFrom: toIsoDate(effectiveFrom),
      createdByUserId: 'seed',
      note: null,
    })
  }
}

export class FakePartyRepository implements PartyRepository {
  private readonly rows = new Map<string, Party>()
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): Party | null {
    return this.rows.get(id) ?? null
  }

  findByCode(branchId: string, code: string): Party | null {
    const target = code.toLowerCase()
    for (const p of this.rows.values()) {
      if (p.branchId === branchId && p.code.toLowerCase() === target) return p
    }
    return null
  }

  /** Prefix matches first, mirroring the real index's ORDER BY. */
  search(branchId: string, query: string, limit: number): PartySearchResult[] {
    const q = query.toLowerCase()
    return [...this.rows.values()]
      .filter((p) => p.branchId === branchId && p.isActive)
      .filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => rank(a, q) - rank(b, q) || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((p) => ({ id: p.id, code: p.code, name: p.name, mobile: p.mobile, city: p.city }))
  }

  list(branchId: string, includeInactive: boolean): Party[] {
    return [...this.rows.values()]
      .filter((p) => p.branchId === branchId && (includeInactive || p.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  create(party: NewParty, _createdByUserId = 'user-1'): Party {
    const now = toIsoTimestamp(this.clock.now())
    const created: Party = {
      ...party,
      id: `party-${++this.sequence}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(created.id, created)
    return created
  }

  update(
    id: string,
    changes: { name: string; mobile: string | null; city: string | null; notes: string | null },
  ): Party {
    return this.mutate(id, (p) => ({ ...p, ...changes }))
  }

  setActive(id: string, isActive: boolean): Party {
    return this.mutate(id, (p) => ({ ...p, isActive }))
  }

  private mutate(id: string, change: (p: Party) => Party): Party {
    const existing = this.rows.get(id)
    if (!existing) throw new Error(`No such party: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows.set(id, updated)
    return updated
  }
}

function rank(p: Party, q: string): number {
  if (p.code.toLowerCase().startsWith(q)) return 0
  if (p.name.toLowerCase().startsWith(q)) return 1
  return 2
}

export class FakeSettingsRepository implements SettingsRepository {
  private readonly rows = new Map<string, string>()
  get(key: string): string | null {
    return this.rows.get(key) ?? null
  }
  set(key: string, value: string): void {
    this.rows.set(key, value)
  }
  all(): Record<string, string> {
    return Object.fromEntries(this.rows)
  }
}

/** In-memory wholesale ledger. Same delta-summing rule as the SQLite one. */
export class FakeWholesaleRepository implements WholesaleRepository {
  readonly entries: WholesaleEntryWithLines[] = []
  private sequence = 0
  /** One counter per book, both starting at 1 — issues and settlements. */
  private readonly next = new Map<WholesaleEntryKind, number>()

  constructor(private readonly clock: Clock) {}

  post(entry: NewWholesaleEntry): WholesaleEntryWithLines {
    const id = `entry-${++this.sequence}`
    const stored: WholesaleEntryWithLines = {
      entry: {
        ...entry,
        id,
        // The same rule the SQLite repository follows: a reversal keeps the
        // number of the slip it corrects, everything else takes the next one
        // from its own book.
        invoiceNumber: this.allocate(entry),
        reversedByEntryId: null,
        createdAt: toIsoTimestamp(this.clock.now()),
      },
      lines: entry.lines.map((line, index) => ({ ...line, id: `line-${id}-${index}` })),
    }
    this.entries.push(stored)
    return stored
  }

  private allocate(entry: NewWholesaleEntry): number {
    if (entry.reversesEntryId) {
      const original = this.findById(entry.reversesEntryId)
      if (original) return original.entry.invoiceNumber
    }
    const next = this.peekNextNumber(entry.kind)
    this.next.set(entry.kind, next + 1)
    return next
  }

  findById(id: string): WholesaleEntryWithLines | null {
    return this.entries.find((e) => e.entry.id === id) ?? null
  }

  findByNumber(
    branchId: string,
    kind: WholesaleEntryKind,
    invoiceNumber: number,
  ): WholesaleEntryWithLines | null {
    return (
      this.entries.find(
        (e) =>
          e.entry.branchId === branchId &&
          e.entry.kind === kind &&
          e.entry.invoiceNumber === invoiceNumber &&
          e.entry.reversesEntryId === null,
      ) ?? null
    )
  }

  peekNextNumber(kind: WholesaleEntryKind): number {
    return this.next.get(kind) ?? 1
  }

  /** The same scope the SQLite one uses: the ISSUE book, no reversal rows. */
  neighbours(
    branchId: string,
    current: number | null,
    includeReversed: boolean,
  ): { first: number | null; previous: number | null; next: number | null; last: number | null } {
    const numbers = this.entries
      .filter(
        (e) =>
          e.entry.branchId === branchId &&
          e.entry.kind === 'ISSUE' &&
          e.entry.reversesEntryId === null &&
          (includeReversed || e.entry.reversedByEntryId === null),
      )
      .map((e) => e.entry.invoiceNumber)
      .sort((a, b) => a - b)

    const first = numbers[0] ?? null
    const last = numbers[numbers.length - 1] ?? null
    const previous =
      current === null
        ? last
        : (numbers.filter((n) => n < current).pop() ?? null)
    const next = current === null ? null : (numbers.find((n) => n > current) ?? null)
    return { first, previous, next, last }
  }

  balances(partyId: string): { goldMg: number; cashPaisa: number } {
    const mine = this.entries.filter((e) => e.entry.partyId === partyId)
    return {
      goldMg: mine.reduce((sum, e) => sum + e.entry.goldDelta.milligrams, 0),
      cashPaisa: mine.reduce((sum, e) => sum + e.entry.cashDelta.paisa, 0),
    }
  }

  listForParty(partyId: string, limit: number): WholesaleEntry[] {
    return this.entries
      .filter((e) => e.entry.partyId === partyId)
      .map((e) => e.entry)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id))
      .slice(0, limit)
  }

  listRecent(branchId: string, limit: number): WholesaleEntry[] {
    return this.entries
      .filter((e) => e.entry.branchId === branchId)
      .map((e) => e.entry)
      .reverse()
      .slice(0, limit)
  }

  markReversed(originalId: string, reversalId: string): void {
    const index = this.entries.findIndex((e) => e.entry.id === originalId)
    const found = this.entries[index]
    if (!found) throw new Error(`No such entry: ${originalId}`)
    this.entries[index] = {
      ...found,
      entry: { ...found.entry, reversedByEntryId: reversalId },
    }
  }
}

// ── retail ──────────────────────────────────────────────────────────────────

export class FakeCustomerRepository implements CustomerRepository {
  readonly rows: Customer[] = []
  private seq = 0

  create(customer: NewCustomer, _createdByUserId: string): Customer {
    const created: Customer = { ...customer, id: `cust-${++this.seq}` }
    this.rows.push(created)
    return created
  }

  findById(id: string): Customer | null {
    return this.rows.find((row) => row.id === id) ?? null
  }

  findByCode(code: string): Customer | null {
    return this.rows.find((row) => row.code === code) ?? null
  }

  search(term: string, limit: number): CustomerSearchResult[] {
    const lower = term.trim().toLowerCase()
    if (lower === '') return []
    return this.rows
      .filter(
        (row) =>
          row.name.toLowerCase().startsWith(lower) ||
          row.code.toLowerCase().startsWith(lower) ||
          (row.mobile ?? '').includes(lower),
      )
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        mobile: row.mobile,
        city: row.city,
        isWalkIn: row.isWalkIn,
      }))
  }

  nextCode(prefix: string): string {
    const n = this.rows.filter((row) => row.code.startsWith(prefix)).length + 1
    return `${prefix}${n.toString().padStart(4, '0')}`
  }
}

export class FakeSalesmanRepository implements SalesmanRepository {
  readonly rows: Salesman[] = []

  list(activeOnly: boolean): Salesman[] {
    return activeOnly ? this.rows.filter((row) => row.isActive) : [...this.rows]
  }

  findById(id: string): Salesman | null {
    return this.rows.find((row) => row.id === id) ?? null
  }
}

/**
 * An in-memory retail sale store.
 *
 * Models the two things the real repository guarantees and the service depends
 * on: a monotonic invoice sequence that never reuses a number, and a unique
 * draft id so a retry cannot write a second invoice.
 */
export class FakeRetailSaleRepository implements RetailSaleRepository {
  readonly rows: RetailSaleWithItems[] = []
  /**
   * The invoice sequence. Public so the bill fake can roll it back.
   *
   * In SQLite the number is allocated by bumping a row INSIDE the caller's
   * transaction, so a failed bill un-bumps it along with everything else. A
   * fake whose sequence kept advancing through a rolled-back write would let a
   * gap appear that the real database never produces.
   */
  next = 1
  /**
   * Row ids, counted separately from `rows.length`.
   *
   * They cannot be derived from the array length: the bill fake BUILDS several
   * slips before pushing any of them, so every staged slip would be handed the
   * same id and a lookup by id would find only the first. The real repository
   * mints a UUID per row and has never had the problem.
   */
  idCount = 0

  post(sale: NewRetailSale): RetailSaleWithItems {
    const written = this.build(sale)
    this.rows.push(written)
    return written
  }

  /**
   * Constructs a row and allocates its number WITHOUT writing it.
   *
   * Split out of `post` for the bill fake, which must build every slip before
   * committing any of them — see FakeRetailBillRepository.
   */
  build(sale: NewRetailSale): RetailSaleWithItems {
    if (sale.draftId && this.rows.some((row) => row.sale.draftId === sale.draftId)) {
      throw new Error('UNIQUE constraint failed: retail_sales.draft_id')
    }
    // Integer and text from ONE value, exactly as saleParams does in the real
    // repository. A fake that could produce a pair which disagrees would hide
    // the very drift the single-argument insert exists to prevent.
    const invoiceNumber = this.next++
    const id = `sale-${++this.idCount}`
    return {
      sale: {
        id,
        invoiceNumber,
        invoiceNo: String(invoiceNumber),
        branchId: sale.branchId,
        saleDate: sale.saleDate,
        saleTime: sale.saleTime,
        customerId: sale.customerId,
        customerNameSnapshot: sale.customerNameSnapshot,
        customerMobileSnapshot: sale.customerMobileSnapshot,
        salesmanId: sale.salesmanId,
        salesmanNameSnapshot: sale.salesmanNameSnapshot,
        ratePurity: sale.ratePurity,
        ratePerTola: sale.ratePerTola,
        goldValue: sale.goldValue,
        customerGold: sale.customerGold,
        customerGoldPurity: sale.customerGoldPurity,
        customerGoldValue: sale.customerGoldValue,
        hallmarkCharges: sale.hallmarkCharges,
        otherCharges: sale.otherCharges,
        discount: sale.discount,
        grandTotal: sale.grandTotal,
        amountPaid: sale.amountPaid,
        paymentMethod: sale.paymentMethod,
        balance: sale.balance,
        amountInWords: sale.amountInWords,
        remarks: sale.remarks,
        status: sale.status,
        voidReason: null,
        draftId: sale.draftId,
        billId: null,
        wastageDirection: sale.wastageDirection,
        wastageBasis: sale.wastageBasis,
        createdByUserId: sale.createdByUserId,
        createdAt: toIsoTimestamp(new Date('2026-08-30T09:00:00.000Z')),
        postedAt: null,
      },
      items: sale.items.map((item, index) => ({
        ...item,
        id: `${id}-item-${index}`,
        saleId: id,
        // Optional going IN (most lines carry no note), always present coming
        // back OUT — the stored row has the column either way.
        remarks: item.remarks ?? null,
      })),
    }
  }

  findById(id: string): RetailSaleWithItems | null {
    return this.rows.find((row) => row.sale.id === id) ?? null
  }

  findByInvoiceNumber(invoiceNumber: number): RetailSaleWithItems | null {
    return this.rows.find((row) => row.sale.invoiceNumber === invoiceNumber) ?? null
  }

  findByDraftId(draftId: string): RetailSaleWithItems | null {
    return this.rows.find((row) => row.sale.draftId === draftId) ?? null
  }

  /** Honours the filter, because the handler that calls it is tested on it. */
  list(filter: RetailSaleFilter): RetailSale[] {
    return this.rows
      .map((row) => row.sale)
      .filter((sale) => sale.branchId === filter.branchId)
      .filter((sale) => !filter.fromDate || sale.saleDate >= filter.fromDate)
      .filter((sale) => !filter.toDate || sale.saleDate <= filter.toDate)
      .filter((sale) => !filter.customerId || sale.customerId === filter.customerId)
      .filter((sale) => !filter.status || sale.status === filter.status)
      .slice(0, filter.limit)
  }

  peekNextInvoiceNumber(): number {
    return this.next
  }

  neighbours(
    branchId: string,
    current: number | null,
    includeVoid: boolean,
  ): RetailNeighbours {
    // Sorted numerically, exactly as the SQL orders by invoice_number — a fake
    // that sorted these as text would pass while the real query failed on the
    // one case the integer column exists for.
    const numbers = this.rows
      .map((row) => row.sale)
      .filter((sale) => sale.branchId === branchId)
      .filter((sale) =>
        includeVoid ? sale.status === 'posted' || sale.status === 'void' : sale.status === 'posted',
      )
      .map((sale) => sale.invoiceNumber)
      .sort((a, b) => a - b)

    const first = numbers[0] ?? null
    const last = numbers[numbers.length - 1] ?? null
    return {
      first,
      last,
      previous:
        current === null
          ? last
          : ([...numbers].reverse().find((n) => n < current) ?? null),
      next: current === null ? null : (numbers.find((n) => n > current) ?? null),
    }
  }

  markVoid(id: string, reason: string): void {
    const index = this.rows.findIndex((row) => row.sale.id === id)
    const found = this.rows[index]
    if (index >= 0 && found) {
      this.rows[index] = {
        ...found,
        sale: { ...found.sale, status: 'void', voidReason: reason },
      }
    }
  }
}

/**
 * Bills, in memory — including the all-or-nothing guarantee.
 *
 * `postBill` here is deliberately NOT a loop that pushes as it goes. It builds
 * every slip first and only then commits them to the arrays, so a slip that
 * throws part-way leaves this fake in exactly the state SQLite's transaction
 * would leave the real database: untouched. A fake that half-wrote would make
 * the atomicity test pass against the real repository and vacuously against
 * this one, which is the same as not having the test.
 *
 * `failOnSlipNo` exists for that test: it makes one slip fail at write time,
 * the way a CHECK constraint would, after the service has already validated
 * every slip.
 */
export class FakeRetailBillRepository implements RetailBillRepository {
  readonly bills: RetailBillWithSlips[] = []
  private next = 1
  /** Set to make the write of that slip number throw, as a constraint would. */
  failOnSlipNo: number | null = null

  constructor(private readonly sales: FakeRetailSaleRepository) {}

  postBill(bill: NewRetailBill, billPrefix: string): RetailBillWithSlips {
    const billNo = `${billPrefix}${this.next.toString().padStart(5, '0')}`
    const billId = `bill-${this.bills.length + 1}`

    // Built first, committed second. Nothing is visible until all of it is —
    // and the invoice sequence rewinds on failure, exactly as the real bump
    // rolls back inside SQLite's transaction.
    const sequenceBefore = this.sales.next
    const idsBefore = this.sales.idCount
    const staged: RetailSlip[] = []
    try {
      for (const slip of bill.slips) {
        if (this.failOnSlipNo === slip.slipNo) {
          throw new Error(
            `CHECK constraint failed: retail_sale_items (simulated, slip ${slip.slipNo})`,
          )
        }
        const written = this.sales.build(slip.sale)
        // The slip carries the bill it belongs to, exactly as the real INSERT
        // does. Without it a loaded invoice cannot answer "how many slips does
        // my bill hold?", and the multi-slip read-only case goes untested.
        staged.push({
          ...written,
          sale: { ...written.sale, billId },
          slipNo: slip.slipNo,
          slipLabel: slip.slipLabel,
        })
      }
    } catch (error) {
      this.sales.next = sequenceBefore
      this.sales.idCount = idsBefore
      throw error
    }

    this.next += 1
    for (const slip of staged) this.sales.rows.push({ sale: slip.sale, items: slip.items })

    const written: RetailBillWithSlips = {
      bill: {
        id: billId,
        billNo,
        branchId: bill.branchId,
        billDate: bill.billDate,
        billTime: bill.billTime,
        customerId: bill.customerId,
        customerNameSnapshot: bill.customerNameSnapshot,
        customerMobileSnapshot: bill.customerMobileSnapshot,
        salesmanId: bill.salesmanId,
        salesmanNameSnapshot: bill.salesmanNameSnapshot,
        status: bill.status,
        createdByUserId: bill.createdByUserId,
        createdAt: toIsoTimestamp(new Date('2026-08-30T09:00:00.000Z')),
        postedAt: null,
      },
      slips: staged,
    }
    this.bills.push(written)
    return written
  }

  findById(id: string): RetailBillWithSlips | null {
    return this.bills.find((row) => row.bill.id === id) ?? null
  }

  findByBillNo(billNo: string): RetailBillWithSlips | null {
    return this.bills.find((row) => row.bill.billNo === billNo) ?? null
  }

  peekNextBillNo(prefix: string): string {
    return `${prefix}${this.next.toString().padStart(5, '0')}`
  }
}

/**
 * The bill in progress, in memory.
 *
 * Deep-copied on the way in AND on the way out, which is the whole point: a
 * fake that handed back the same object it was given would make the
 * crash-recovery test pass without any persistence at all, because the "reopened"
 * draft would be the very object the caller still had a reference to.
 */
export class FakeRetailDraftRepository implements RetailDraftRepository {
  private readonly rows = new Map<string, string>()
  /** Counts writes, so a debounce can be asserted rather than assumed. */
  saves = 0

  save(draft: DraftBill): void {
    this.saves += 1
    this.rows.set(draft.branchId, JSON.stringify(draft))
  }

  find(branchId: string): DraftBill | null {
    const stored = this.rows.get(branchId)
    return stored ? (JSON.parse(stored) as DraftBill) : null
  }

  clear(branchId: string): void {
    this.rows.delete(branchId)
  }
}

/**
 * The stock ledger, in memory. Append-only, exactly like the real one: the
 * rows array only ever grows, and every reader sums it fresh.
 */
export class FakeStockLedgerRepository implements StockLedgerRepository {
  readonly rows: StockMovement[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  append(movement: NewStockMovement): StockMovement {
    const stamp = toIsoTimestamp(this.clock.now())
    const stored: StockMovement = {
      ...movement,
      id: `movement-${++this.sequence}`,
      at: stamp,
      createdAt: stamp,
    }
    this.rows.push(stored)
    return stored
  }

  list(filter: StockMovementFilter): StockMovement[] {
    return this.rows.filter((row) => {
      if (row.branchId !== filter.branchId) return false
      const day = row.at.slice(0, 10)
      if (filter.fromDate && day < filter.fromDate) return false
      if (filter.toDate && day > filter.toDate) return false
      if (filter.bucket && row.bucket !== filter.bucket) return false
      if (filter.kind && row.kind !== filter.kind) return false
      return true
    })
  }

  forRef(refType: string, refId: string): StockMovement[] {
    return this.rows.filter((row) => row.refType === refType && row.refId === refId)
  }

  summary(branchId: string): StockBucketTotals[] {
    const byBucket = new Map<string, { grossMg: number; khalisMg: number }>()
    for (const row of this.rows) {
      if (row.branchId !== branchId) continue
      const totals = byBucket.get(row.bucket) ?? { grossMg: 0, khalisMg: 0 }
      totals.grossMg += row.gross.milligrams
      totals.khalisMg += row.khalis.milligrams
      byBucket.set(row.bucket, totals)
    }
    return [...byBucket.entries()].map(([bucket, totals]) => ({
      bucket: bucket as StockBucketTotals['bucket'],
      gross: Weight.fromMilligrams(totals.grossMg),
      khalis: Weight.fromMilligrams(totals.khalisMg),
    }))
  }
}

/**
 * Purchases, in memory — including the coupling the real repository has: a
 * POSTED purchase writes its stock movements through the same call that stores
 * it, and a cancellation writes the reversing rows. A fake that skipped the
 * stock half would let the "posting moves stock" tests pass vacuously.
 */
export class FakePurchaseRepository implements PurchaseRepository {
  readonly entries: PurchaseEntryWithLines[] = []
  private sequence = 0
  private nextNumber = 1

  constructor(
    private readonly clock: Clock,
    private readonly stock: FakeStockLedgerRepository,
  ) {}

  post(entry: NewPurchaseEntry): PurchaseEntryWithLines {
    const stamp = toIsoTimestamp(this.clock.now())

    if (entry.heldId) {
      const index = this.entries.findIndex((e) => e.entry.id === entry.heldId)
      const held = this.entries[index]
      if (!held || held.entry.status !== 'held') {
        throw new Error(`No held purchase: ${entry.heldId ?? ''}`)
      }
      const updated: PurchaseEntryWithLines = {
        entry: {
          ...held.entry,
          partyId: entry.partyId,
          entryDate: entry.entryDate,
          status: entry.status,
          ratePerTola: entry.ratePerTola,
          totalGross: entry.totalGross,
          totalKhalis: entry.totalKhalis,
          totalAmount: entry.totalAmount,
          notes: entry.notes,
          updatedAt: stamp,
        },
        lines: entry.lines.map((line, i) => ({ ...line, id: `line-${held.entry.id}-${i}` })),
      }
      this.entries[index] = updated
      if (entry.status === 'posted') this.writeMovements(updated)
      return updated
    }

    const id = `purchase-${++this.sequence}`
    const stored: PurchaseEntryWithLines = {
      entry: {
        branchId: entry.branchId,
        partyId: entry.partyId,
        entryDate: entry.entryDate,
        status: entry.status,
        ratePerTola: entry.ratePerTola,
        totalGross: entry.totalGross,
        totalKhalis: entry.totalKhalis,
        totalAmount: entry.totalAmount,
        notes: entry.notes,
        createdByUserId: entry.createdByUserId,
        id,
        invoiceNumber: this.nextNumber++,
        cancelledAt: null,
        cancelReason: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
      lines: entry.lines.map((line, i) => ({ ...line, id: `line-${id}-${i}` })),
    }
    this.entries.push(stored)
    if (entry.status === 'posted') this.writeMovements(stored)
    return stored
  }

  private writeMovements(purchase: PurchaseEntryWithLines): void {
    for (const line of purchase.lines) {
      this.stock.append({
        branchId: purchase.entry.branchId,
        kind: 'PURCHASE_IN',
        bucket: line.bucket,
        gross: line.gross,
        khalis: line.khalis,
        katt: line.katt,
        ratePerTola: line.ratePerTola,
        refType: 'purchase',
        refId: purchase.entry.id,
        itemName: line.itemName,
        note: null,
        createdByUserId: purchase.entry.createdByUserId,
      })
    }
  }

  cancel(id: string, reason: string): PurchaseEntryWithLines {
    const index = this.entries.findIndex((e) => e.entry.id === id)
    const found = this.entries[index]
    if (!found) throw new Error(`No such purchase: ${id}`)
    const stamp = toIsoTimestamp(this.clock.now())

    if (found.entry.status === 'posted') {
      for (const line of found.lines) {
        this.stock.append({
          branchId: found.entry.branchId,
          kind: 'PURCHASE_IN',
          bucket: line.bucket,
          gross: line.gross.negated(),
          khalis: line.khalis.negated(),
          katt: line.katt,
          ratePerTola: line.ratePerTola,
          refType: 'purchase',
          refId: found.entry.id,
          itemName: line.itemName,
          note: `Reversal: ${reason}`,
          createdByUserId: found.entry.createdByUserId,
        })
      }
    }

    const cancelled: PurchaseEntryWithLines = {
      ...found,
      entry: {
        ...found.entry,
        status: 'cancelled',
        cancelledAt: stamp,
        cancelReason: reason,
        updatedAt: stamp,
      },
    }
    this.entries[index] = cancelled
    return cancelled
  }

  findById(id: string): PurchaseEntryWithLines | null {
    return this.entries.find((e) => e.entry.id === id) ?? null
  }

  findByNumber(branchId: string, invoiceNumber: number): PurchaseEntryWithLines | null {
    return (
      this.entries.find(
        (e) => e.entry.branchId === branchId && e.entry.invoiceNumber === invoiceNumber,
      ) ?? null
    )
  }

  neighbours(
    branchId: string,
    current: number | null,
    includeCancelled: boolean,
  ): PurchaseNeighbours {
    const numbers = this.entries
      .filter(
        (e) =>
          e.entry.branchId === branchId &&
          (includeCancelled || e.entry.status !== 'cancelled'),
      )
      .map((e) => e.entry.invoiceNumber)
      .sort((a, b) => a - b)

    const first = numbers[0] ?? null
    const last = numbers[numbers.length - 1] ?? null
    const previous =
      current === null ? last : (numbers.filter((n) => n < current).pop() ?? null)
    const next = current === null ? null : (numbers.find((n) => n > current) ?? null)
    return { first, previous, next, last }
  }

  peekNextNumber(): number {
    return this.nextNumber
  }

  listRecent(branchId: string, limit: number): PurchaseEntry[] {
    return this.entries
      .filter((e) => e.entry.branchId === branchId)
      .map((e) => e.entry)
      .reverse()
      .slice(0, limit)
  }
}

/** The item master, in memory. Case-insensitive code lookup, like the index. */
export class FakeItemRepository implements ItemRepository {
  readonly rows: Item[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): Item | null {
    return this.rows.find((item) => item.id === id) ?? null
  }

  findByCode(branchId: string, code: string): Item | null {
    const target = code.toLowerCase()
    return (
      this.rows.find(
        (item) => item.branchId === branchId && item.code.toLowerCase() === target,
      ) ?? null
    )
  }

  search(branchId: string, query: string, includeInactive: boolean, limit: number): Item[] {
    const term = query.toLowerCase()
    const matches = (value: string | null): boolean =>
      value !== null && value.toLowerCase().includes(term)
    const prefix = (value: string | null): boolean =>
      value !== null && value.toLowerCase().startsWith(term)
    return this.rows
      .filter(
        (item) =>
          item.branchId === branchId &&
          (includeInactive || item.isActive) &&
          (matches(item.code) || matches(item.name) || matches(item.designNo)),
      )
      .sort((a, b) => {
        const rank = (item: Item): number =>
          prefix(item.code) ? 0 : prefix(item.name) ? 1 : 2
        return rank(a) - rank(b) || a.name.localeCompare(b.name)
      })
      .slice(0, limit)
  }

  list(branchId: string, includeInactive: boolean): Item[] {
    return this.rows
      .filter((item) => item.branchId === branchId && (includeInactive || item.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  create(item: NewItem): Item {
    const stamp = toIsoTimestamp(this.clock.now())
    const created: Item = {
      ...item,
      id: `item-${++this.sequence}`,
      isActive: true,
      createdAt: stamp,
      updatedAt: stamp,
    }
    this.rows.push(created)
    return created
  }

  update(id: string, changes: ItemUpdate): Item {
    return this.mutate(id, (item) => ({ ...item, ...changes }))
  }

  setActive(id: string, isActive: boolean): Item {
    return this.mutate(id, (item) => ({ ...item, isActive }))
  }

  private mutate(id: string, change: (item: Item) => Item): Item {
    const index = this.rows.findIndex((item) => item.id === id)
    const existing = this.rows[index]
    if (!existing) throw new Error(`No such item: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows[index] = updated
    return updated
  }
}

export class FakeItemCategoryRepository implements ItemCategoryRepository {
  readonly rows: ItemCategory[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): ItemCategory | null {
    return this.rows.find((category) => category.id === id) ?? null
  }

  list(branchId: string, includeInactive: boolean): ItemCategory[] {
    return this.rows
      .filter((c) => c.branchId === branchId && (includeInactive || c.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  create(category: NewItemCategory): ItemCategory {
    const stamp = toIsoTimestamp(this.clock.now())
    const created: ItemCategory = {
      ...category,
      id: `category-${++this.sequence}`,
      isActive: true,
      createdAt: stamp,
      updatedAt: stamp,
    }
    this.rows.push(created)
    return created
  }

  rename(id: string, name: string): ItemCategory {
    return this.mutate(id, (category) => ({ ...category, name }))
  }

  setActive(id: string, isActive: boolean): ItemCategory {
    return this.mutate(id, (category) => ({ ...category, isActive }))
  }

  private mutate(id: string, change: (category: ItemCategory) => ItemCategory): ItemCategory {
    const index = this.rows.findIndex((category) => category.id === id)
    const existing = this.rows[index]
    if (!existing) throw new Error(`No such category: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows[index] = updated
    return updated
  }
}

export class FakeLocationRepository implements LocationRepository {
  readonly rows: StockLocation[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): StockLocation | null {
    return this.rows.find((location) => location.id === id) ?? null
  }

  list(branchId: string, includeInactive: boolean): StockLocation[] {
    return this.rows
      .filter((l) => l.branchId === branchId && (includeInactive || l.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  create(location: NewLocation): StockLocation {
    const stamp = toIsoTimestamp(this.clock.now())
    const created: StockLocation = {
      ...location,
      id: `location-${++this.sequence}`,
      isActive: true,
      createdAt: stamp,
      updatedAt: stamp,
    }
    this.rows.push(created)
    return created
  }

  rename(id: string, name: string): StockLocation {
    return this.mutate(id, (location) => ({ ...location, name }))
  }

  setActive(id: string, isActive: boolean): StockLocation {
    return this.mutate(id, (location) => ({ ...location, isActive }))
  }

  private mutate(id: string, change: (location: StockLocation) => StockLocation): StockLocation {
    const index = this.rows.findIndex((location) => location.id === id)
    const existing = this.rows[index]
    if (!existing) throw new Error(`No such location: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows[index] = updated
    return updated
  }
}

/**
 * Pieces, in memory — with the coupling the real repository has: a batch
 * writes its pieces, their CREATED events AND their FINISHED ledger rows
 * through one call, and there is no path that writes one side alone. A fake
 * that skipped the ledger half would let every invariant test pass vacuously.
 */
export class FakePieceRepository implements PieceRepository {
  readonly rows: Piece[] = []
  readonly eventRows: PieceEvent[] = []
  private sequence = 0
  private nextTag = 1

  constructor(
    private readonly clock: Clock,
    private readonly stock: FakeStockLedgerRepository,
    private readonly items: FakeItemRepository,
  ) {}

  createBatch(
    pieces: readonly NewPiece[],
    movement: {
      readonly kind: 'OPENING' | 'PURCHASE_IN'
      readonly at: IsoTimestamp
      readonly note: string | null
    },
  ): Piece[] {
    const stamp = toIsoTimestamp(this.clock.now())
    return pieces.map((piece) => {
      const tag = piece.tagNumber ?? this.nextTag++
      if (piece.tagNumber !== null && piece.tagNumber >= this.nextTag) {
        this.nextTag = piece.tagNumber + 1
      }
      const created: Piece = {
        ...piece,
        id: `piece-${++this.sequence}`,
        tagNumber: tag,
        status: 'IN_STOCK',
        statusChangedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      }
      this.rows.push(created)
      this.eventRows.push({
        id: `event-${this.eventRows.length + 1}`,
        pieceId: created.id,
        branchId: piece.branchId,
        at: movement.at,
        kind: 'CREATED',
        fromStatus: null,
        toStatus: 'IN_STOCK',
        fromLocationId: null,
        toLocationId: piece.locationId,
        note: movement.note,
        createdByUserId: piece.createdByUserId,
        createdAt: stamp,
      })
      const item = this.items.findById(piece.itemId)
      // Pushed directly rather than through append(): the real repository
      // writes the movement's own `at` — the opening DATE — not the moment of
      // typing, and the fake must not diverge on exactly the thing the
      // "dated once" tests assert.
      this.stock.rows.push({
        id: `movement-${created.id}`,
        branchId: piece.branchId,
        at: movement.at,
        kind: movement.kind,
        bucket: 'FINISHED',
        gross: piece.gross,
        khalis: piece.khalis,
        katt: piece.katt,
        ratePerTola: null,
        refType: 'piece',
        refId: created.id,
        itemName: `${item?.name ?? ''} · tag ${tag}`,
        note: movement.note,
        createdByUserId: piece.createdByUserId,
        createdAt: stamp,
      })
      return created
    })
  }

  findById(id: string): Piece | null {
    return this.rows.find((piece) => piece.id === id) ?? null
  }

  findByTag(branchId: string, tagNumber: number): Piece | null {
    return (
      this.rows.find((p) => p.branchId === branchId && p.tagNumber === tagNumber) ?? null
    )
  }

  list(filter: PieceFilter): Piece[] {
    return this.rows
      .filter((piece) => {
        if (piece.branchId !== filter.branchId) return false
        if (filter.status !== undefined && piece.status !== filter.status) return false
        if (filter.itemId !== undefined && piece.itemId !== filter.itemId) return false
        const item = this.items.findById(piece.itemId)
        if (filter.categoryId !== undefined && (item?.categoryId ?? null) !== filter.categoryId)
          return false
        if (filter.purity !== undefined && item?.purity !== filter.purity) return false
        if (filter.locationId !== undefined && piece.locationId !== filter.locationId)
          return false
        if (filter.supplierId !== undefined && (item?.supplierId ?? null) !== filter.supplierId)
          return false
        return true
      })
      .sort((a, b) => a.tagNumber - b.tagNumber)
      .slice(0, filter.limit ?? 500)
  }

  summaryGroups(branchId: string): PieceSummaryGroup[] {
    const groups = new Map<string, PieceSummaryGroup>()
    for (const piece of this.rows) {
      if (piece.branchId !== branchId || piece.status !== 'IN_STOCK') continue
      const item = this.items.findById(piece.itemId)
      if (!item) continue
      const key = `${item.categoryId ?? ''}|${item.purity}|${piece.locationId ?? ''}|${item.supplierId ?? ''}`
      const existing = groups.get(key)
      if (existing) {
        groups.set(key, {
          ...existing,
          count: existing.count + 1,
          grossMg: existing.grossMg + piece.gross.milligrams,
          khalisMg: existing.khalisMg + piece.khalis.milligrams,
        })
      } else {
        groups.set(key, {
          categoryId: item.categoryId,
          purity: item.purity,
          locationId: piece.locationId,
          supplierId: item.supplierId,
          count: 1,
          grossMg: piece.gross.milligrams,
          khalisMg: piece.khalis.milligrams,
        })
      }
    }
    return [...groups.values()]
  }

  inStockTotals(branchId: string): { grossMg: number; khalisMg: number } {
    const mine = this.rows.filter(
      (piece) => piece.branchId === branchId && piece.status === 'IN_STOCK',
    )
    return {
      grossMg: mine.reduce((sum, piece) => sum + piece.gross.milligrams, 0),
      khalisMg: mine.reduce((sum, piece) => sum + piece.khalis.milligrams, 0),
    }
  }

  moveTo(pieceId: string, locationId: string | null, byUserId: string): Piece {
    const index = this.rows.findIndex((piece) => piece.id === pieceId)
    const existing = this.rows[index]
    if (!existing) throw new Error(`No such piece: ${pieceId}`)
    const stamp = toIsoTimestamp(this.clock.now())
    const moved: Piece = { ...existing, locationId, updatedAt: stamp }
    this.rows[index] = moved
    this.eventRows.push({
      id: `event-${this.eventRows.length + 1}`,
      pieceId,
      branchId: existing.branchId,
      at: stamp,
      kind: 'MOVED',
      fromStatus: null,
      toStatus: null,
      fromLocationId: existing.locationId,
      toLocationId: locationId,
      note: null,
      createdByUserId: byUserId,
      createdAt: stamp,
    })
    return moved
  }

  events(pieceId: string): PieceEvent[] {
    return this.eventRows.filter((event) => event.pieceId === pieceId)
  }

  peekNextTag(): number {
    return this.nextTag
  }
}
