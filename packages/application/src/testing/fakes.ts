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
  type Purity,
  type NewParty,
  type Party,
  type Role,
  type User,
  type WholesaleEntry,
  type WholesaleEntryWithLines,
  type Customer,
  type NewCustomer,
  type RetailBillWithSlips,
  type RetailSale,
  type RetailSaleWithItems,
  type RetailSlip,
  type Salesman,
} from '@jewellery/domain'
import type {
  AuditRepository,
  CustomerRepository,
  CustomerSearchResult,
  GoldRateRepository,
  DraftBill,
  NewRetailBill,
  NewRetailSale,
  NewUser,
  NewWholesaleEntry,
  PartyRepository,
  PartySearchResult,
  RetailBillRepository,
  RetailDraftRepository,
  RetailSaleFilter,
  RetailSaleRepository,
  SalesmanRepository,
  SettingsRepository,
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

  create(party: NewParty): Party {
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

  constructor(private readonly clock: Clock) {}

  post(entry: NewWholesaleEntry): WholesaleEntryWithLines {
    if (this.entries.some((e) => e.entry.invoiceNo === entry.invoiceNo)) {
      throw new Error(`Duplicate invoice number: ${entry.invoiceNo}`)
    }
    const id = `entry-${++this.sequence}`
    const stored: WholesaleEntryWithLines = {
      entry: {
        ...entry,
        id,
        reversedByEntryId: null,
        createdAt: toIsoTimestamp(this.clock.now()),
      },
      lines: entry.lines.map((line, index) => ({ ...line, id: `line-${id}-${index}` })),
    }
    this.entries.push(stored)
    return stored
  }

  findById(id: string): WholesaleEntryWithLines | null {
    return this.entries.find((e) => e.entry.id === id) ?? null
  }

  findByInvoiceNo(branchId: string, invoiceNo: string): WholesaleEntryWithLines | null {
    return (
      this.entries.find(
        (e) =>
          e.entry.branchId === branchId &&
          e.entry.invoiceNo.toLowerCase() === invoiceNo.toLowerCase(),
      ) ?? null
    )
  }

  nextInvoiceNo(branchId: string, prefix: string): string {
    const numbers = this.entries
      .filter((e) => e.entry.branchId === branchId && e.entry.invoiceNo.startsWith(prefix))
      .map((e) => Number(/(\d+)\s*$/.exec(e.entry.invoiceNo)?.[1] ?? 0))
    return `${prefix}${numbers.length === 0 ? 10_001 : Math.max(...numbers) + 1}`
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

  post(sale: NewRetailSale, prefix: string): RetailSaleWithItems {
    const written = this.build(sale, prefix)
    this.rows.push(written)
    return written
  }

  /**
   * Constructs a row and allocates its number WITHOUT writing it.
   *
   * Split out of `post` for the bill fake, which must build every slip before
   * committing any of them — see FakeRetailBillRepository.
   */
  build(sale: NewRetailSale, prefix: string): RetailSaleWithItems {
    if (sale.draftId && this.rows.some((row) => row.sale.draftId === sale.draftId)) {
      throw new Error('UNIQUE constraint failed: retail_sales.draft_id')
    }
    const invoiceNo = `${prefix}${(this.next++).toString().padStart(5, '0')}`
    const id = `sale-${++this.idCount}`
    return {
      sale: {
        id,
        invoiceNo,
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
      })),
    }
  }

  findById(id: string): RetailSaleWithItems | null {
    return this.rows.find((row) => row.sale.id === id) ?? null
  }

  findByInvoiceNo(invoiceNo: string): RetailSaleWithItems | null {
    return this.rows.find((row) => row.sale.invoiceNo === invoiceNo) ?? null
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

  peekNextInvoiceNo(prefix: string): string {
    return `${prefix}${this.next.toString().padStart(5, '0')}`
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

  postBill(
    bill: NewRetailBill,
    billPrefix: string,
    invoicePrefix: string,
  ): RetailBillWithSlips {
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
        const written = this.sales.build(slip.sale, invoicePrefix)
        staged.push({ ...written, slipNo: slip.slipNo, slipLabel: slip.slipLabel })
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
