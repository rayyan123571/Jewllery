import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import {
  DEFAULT_SLIP_LABEL,
  Money,
  Weight,
  parsePurity,
  toIsoDate,
  toIsoTimestamp,
  type Clock,
  type Customer,
  type IsoTimestamp,
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
  type WastageBasis,
  type WastageDirection,
} from '@jewellery/domain'
import type {
  CustomerRepository,
  CustomerSearchResult,
  DraftBill,
  NewRetailBill,
  NewRetailSale,
  NewRetailSaleItem,
  RetailBillRepository,
  RetailDraftRepository,
  RetailSaleFilter,
  RetailSaleRepository,
  SalesmanRepository,
} from '@jewellery/application'
import type { DatabaseProvider } from '../Database.js'

/**
 * Retail customers, salesmen and sales.
 *
 * The one thing to keep in mind reading this file: **the invoice number is
 * allocated inside the same transaction as the insert.** Everything else here
 * is ordinary CRUD; that is the part that is load-bearing, and the reason
 * `invoice_sequences` exists rather than the highest-number scan the wholesale
 * repository uses. Scanning is fine at one counter and races at two.
 */

interface SaleRow {
  id: string
  invoice_number: number
  invoice_no: string
  branch_id: string
  sale_date: string
  sale_time: string
  customer_id: string | null
  customer_name_snapshot: string
  customer_mobile_snapshot: string | null
  salesman_id: string | null
  salesman_name_snapshot: string | null
  rate_purity: string
  rate_per_tola_paisa: number
  gold_value_paisa: number
  customer_gold_mg: number
  customer_gold_purity: string | null
  customer_gold_value_paisa: number
  hallmark_charges_paisa: number
  other_charges_paisa: number
  discount_paisa: number
  grand_total_paisa: number
  amount_paid_paisa: number
  payment_method: string
  balance_paisa: number
  amount_in_words: string
  remarks: string | null
  status: string
  void_reason: string | null
  draft_id: string | null
  wastage_direction: string
  wastage_basis: string
  created_by: string
  created_at: string
  posted_at: string | null
}

interface ItemRow {
  id: string
  sale_id: string
  line_no: number
  item_name: string
  purity: string
  gross_weight_mg: number
  stone_weight_mg: number
  cut_per_tola_mg: number
  purity_deduction_mg: number
  net_weight_mg: number
  wastage_bp: number
  wastage_mg: number
  fine_weight_mg: number
  labour_charges_paisa: number
  labour_mode: string
  stone_charges_paisa: number
  line_amount_paisa: number
}

interface CustomerRow {
  id: string
  code: string
  name: string
  mobile: string | null
  address: string | null
  city: string | null
  cnic: string | null
  is_walk_in: number
  opening_gold_mg: number
  opening_cash_paisa: number
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    mobile: row.mobile,
    address: row.address,
    city: row.city,
    cnic: row.cnic,
    isWalkIn: row.is_walk_in === 1,
    openingGold: Weight.fromMilligrams(row.opening_gold_mg),
    openingCash: Money.fromPaisa(row.opening_cash_paisa),
  }
}

function toSale(row: SaleRow): RetailSale {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceNo: row.invoice_no,
    branchId: row.branch_id,
    saleDate: toIsoDate(row.sale_date),
    saleTime: row.sale_time,
    customerId: row.customer_id,
    customerNameSnapshot: row.customer_name_snapshot,
    customerMobileSnapshot: row.customer_mobile_snapshot,
    salesmanId: row.salesman_id,
    salesmanNameSnapshot: row.salesman_name_snapshot,
    ratePurity: parsePurity(row.rate_purity),
    ratePerTola: Money.fromPaisa(row.rate_per_tola_paisa),
    goldValue: Money.fromPaisa(row.gold_value_paisa),
    customerGold: Weight.fromMilligrams(row.customer_gold_mg),
    customerGoldPurity: row.customer_gold_purity
      ? parsePurity(row.customer_gold_purity)
      : null,
    customerGoldValue: Money.fromPaisa(row.customer_gold_value_paisa),
    hallmarkCharges: Money.fromPaisa(row.hallmark_charges_paisa),
    otherCharges: Money.fromPaisa(row.other_charges_paisa),
    discount: Money.fromPaisa(row.discount_paisa),
    grandTotal: Money.fromPaisa(row.grand_total_paisa),
    amountPaid: Money.fromPaisa(row.amount_paid_paisa),
    paymentMethod: row.payment_method as PaymentMethod,
    balance: Money.fromPaisa(row.balance_paisa),
    amountInWords: row.amount_in_words,
    remarks: row.remarks,
    status: row.status as SaleStatus,
    voidReason: row.void_reason,
    draftId: row.draft_id,
    wastageDirection: row.wastage_direction as WastageDirection,
    wastageBasis: row.wastage_basis as WastageBasis,
    createdByUserId: row.created_by,
    createdAt: toIsoTimestamp(new Date(row.created_at)),
    postedAt: row.posted_at ? toIsoTimestamp(new Date(row.posted_at)) : null,
  }
}

function toItem(row: ItemRow): RetailSaleItem {
  return {
    id: row.id,
    saleId: row.sale_id,
    lineNo: row.line_no,
    itemName: row.item_name,
    purity: parsePurity(row.purity),
    grossWeight: Weight.fromMilligrams(row.gross_weight_mg),
    stoneWeight: Weight.fromMilligrams(row.stone_weight_mg),
    purityDeduction: Weight.fromMilligrams(row.purity_deduction_mg),
    netWeight: Weight.fromMilligrams(row.net_weight_mg),
    wastageBp: row.wastage_bp,
    wastage: Weight.fromMilligrams(row.wastage_mg),
    fineWeight: Weight.fromMilligrams(row.fine_weight_mg),
    labourCharges: Money.fromPaisa(row.labour_charges_paisa),
    labourMode: row.labour_mode as LabourMode,
    stoneCharges: Money.fromPaisa(row.stone_charges_paisa),
    lineAmount: Money.fromPaisa(row.line_amount_paisa),
  }
}

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  create(customer: NewCustomer, createdByUserId: string): Customer {
    const id = randomUUID()
    this.conn
      .get()
      .prepare(
        `INSERT INTO customers
           (id, code, name, mobile, address, city, cnic, is_walk_in,
            opening_gold_mg, opening_cash_paisa, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        customer.code,
        customer.name,
        customer.mobile,
        customer.address,
        customer.city,
        customer.cnic,
        customer.isWalkIn ? 1 : 0,
        customer.openingGold.milligrams,
        customer.openingCash.paisa,
        toIsoTimestamp(this.clock.now()),
        createdByUserId,
      )
    return { ...customer, id }
  }

  findById(id: string): Customer | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM customers WHERE id = ?')
      .get(id) as CustomerRow | undefined
    return row ? toCustomer(row) : null
  }

  findByCode(code: string): Customer | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM customers WHERE code = ?')
      .get(code.trim()) as CustomerRow | undefined
    return row ? toCustomer(row) : null
  }

  /**
   * Prefix on the name, anywhere in the mobile.
   *
   * Prefix rather than substring on the name for the same reason the party
   * type-ahead uses it: a match that appears mid-word cannot be predicted, so
   * it stops being trusted. A mobile is different — people remember the last
   * four digits, so that one searches anywhere.
   */
  search(term: string, limit: number): CustomerSearchResult[] {
    const trimmed = term.trim()
    if (trimmed === '') return []
    const rows = this.conn
      .get()
      .prepare(
        `SELECT id, code, name, mobile, city, is_walk_in
           FROM customers
          WHERE name LIKE ? COLLATE NOCASE
             OR code LIKE ? COLLATE NOCASE
             OR mobile LIKE ?
          ORDER BY is_walk_in ASC, name ASC
          LIMIT ?`,
      )
      .all(`${trimmed}%`, `${trimmed}%`, `%${trimmed}%`, limit) as Array<
      Pick<CustomerRow, 'id' | 'code' | 'name' | 'mobile' | 'city' | 'is_walk_in'>
    >
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      mobile: row.mobile,
      city: row.city,
      isWalkIn: row.is_walk_in === 1,
    }))
  }

  nextCode(prefix: string): string {
    const row = this.conn
      .get()
      .prepare(
        `SELECT code FROM customers
          WHERE code LIKE ?
          ORDER BY LENGTH(code) DESC, code DESC
          LIMIT 1`,
      )
      .get(`${prefix}%`) as { code: string } | undefined

    if (!row) return `${prefix}0001`
    const digits = /(\d+)\s*$/.exec(row.code)
    const next = digits ? Number(digits[1]) + 1 : 1
    return `${prefix}${next.toString().padStart(4, '0')}`
  }
}

export class SqliteSalesmanRepository implements SalesmanRepository {
  constructor(private readonly conn: DatabaseProvider) {}

  list(activeOnly: boolean): Salesman[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT id, name, is_active FROM salesmen
          ${activeOnly ? 'WHERE is_active = 1' : ''}
          ORDER BY name ASC`,
      )
      .all() as Array<{ id: string; name: string; is_active: number }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active === 1,
    }))
  }

  findById(id: string): Salesman | null {
    const row = this.conn
      .get()
      .prepare('SELECT id, name, is_active FROM salesmen WHERE id = ?')
      .get(id) as { id: string; name: string; is_active: number } | undefined
    return row ? { id: row.id, name: row.name, isActive: row.is_active === 1 } : null
  }
}

/**
 * The SQL for one sale row and its items, shared by the sale and bill writers.
 *
 * Extracted rather than duplicated because the bill writer must insert slips
 * with EXACTLY the columns and constraints a standalone sale gets — a slip is a
 * retail sale, and a second insert statement that drifted from this one would
 * quietly make it something else.
 */
const INSERT_SALE = `
  INSERT INTO retail_sales
    (id, invoice_number, invoice_no, branch_id, sale_date, sale_time, customer_id,
     customer_name_snapshot, customer_mobile_snapshot, salesman_id,
     salesman_name_snapshot, rate_purity, rate_per_tola_paisa,
     gold_value_paisa, customer_gold_mg, customer_gold_purity,
     customer_gold_value_paisa, hallmark_charges_paisa, other_charges_paisa,
     discount_paisa, grand_total_paisa, amount_paid_paisa, payment_method,
     balance_paisa, amount_in_words, remarks, status, void_reason, draft_id,
     wastage_direction, wastage_basis, created_by, created_at, posted_at,
     bill_id, slip_no, slip_label)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

const INSERT_ITEM = `
  INSERT INTO retail_sale_items
    (id, sale_id, line_no, item_name, purity, gross_weight_mg,
     stone_weight_mg, purity_deduction_mg, net_weight_mg, wastage_bp,
     wastage_mg, fine_weight_mg, labour_charges_paisa, labour_mode,
     stone_charges_paisa, line_amount_paisa)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

/**
 * The integer and the text are written from ONE argument, here, and there is no
 * other way into the table. That is what makes the pair unable to drift: a
 * caller cannot supply a number that disagrees with its own text because it
 * never supplies the text at all.
 */
function saleParams(
  sale: NewRetailSale,
  id: string,
  invoiceNumber: number,
  createdAt: string,
  bill: { id: string; slipNo: number; slipLabel: string } | null,
): unknown[] {
  return [
    id,
    invoiceNumber,
    String(invoiceNumber),
    sale.branchId,
    sale.saleDate,
    sale.saleTime,
    sale.customerId,
    sale.customerNameSnapshot,
    sale.customerMobileSnapshot,
    sale.salesmanId,
    sale.salesmanNameSnapshot,
    sale.ratePurity,
    sale.ratePerTola.paisa,
    sale.goldValue.paisa,
    sale.customerGold.milligrams,
    sale.customerGoldPurity,
    sale.customerGoldValue.paisa,
    sale.hallmarkCharges.paisa,
    sale.otherCharges.paisa,
    sale.discount.paisa,
    sale.grandTotal.paisa,
    sale.amountPaid.paisa,
    sale.paymentMethod,
    sale.balance.paisa,
    sale.amountInWords,
    sale.remarks,
    sale.status,
    null,
    sale.draftId,
    sale.wastageDirection,
    sale.wastageBasis,
    sale.createdByUserId,
    createdAt,
    sale.status === 'posted' ? createdAt : null,
    bill?.id ?? null,
    bill?.slipNo ?? null,
    bill?.slipLabel ?? null,
  ]
}

function itemParams(item: NewRetailSaleItem, saleId: string): unknown[] {
  return [
    randomUUID(),
    saleId,
    item.lineNo,
    item.itemName,
    item.purity,
    item.grossWeight.milligrams,
    item.stoneWeight.milligrams,
    item.purityDeduction.milligrams,
    item.netWeight.milligrams,
    item.wastageBp,
    item.wastage.milligrams,
    item.fineWeight.milligrams,
    item.labourCharges.paisa,
    item.labourMode,
    item.stoneCharges.paisa,
    item.lineAmount.paisa,
  ]
}

/**
 * Takes the next number from a sequence row and bumps it.
 *
 * Callers must already be inside a transaction. Two counters saving at the same
 * moment serialise on this row and cannot both take the same number; if the
 * caller's transaction then fails, the bump rolls back with it.
 */
function allocateNumber(
  db: BetterSqlite3.Database,
  key: string,
  prefix: string,
  width: number,
): string {
  const row = db
    .prepare('SELECT next_number FROM invoice_sequences WHERE key = ?')
    .get(key) as { next_number: number } | undefined

  if (!row) {
    const START = 1
    db.prepare(
      'INSERT INTO invoice_sequences (key, prefix, next_number) VALUES (?,?,?)',
    ).run(key, prefix, START + 1)
    return `${prefix}${START.toString().padStart(width, '0')}`
  }

  db.prepare('UPDATE invoice_sequences SET next_number = next_number + 1 WHERE key = ?').run(key)
  return `${prefix}${row.next_number.toString().padStart(width, '0')}`
}

/**
 * The next invoice number, as a bare integer, taking and burning it.
 *
 * Deliberately a SEPARATE function from `allocateNumber` above rather than a
 * flag on it. That one formats a prefixed, zero-padded string and still serves
 * bill numbers; this one returns an integer and takes no prefix at all — which
 * is the structural half of "the prefix is a display setting". There is no
 * argument here for a prefix to be passed in, so no future caller can bake one
 * into a stored number again.
 *
 * The same transaction rule applies: callers must already be inside one. Two
 * counters saving at the same moment serialise on this row and cannot both take
 * the same number, and a caller whose transaction then fails rolls the bump back
 * with it. A number that WAS handed out and then voided stays burned — a gap is
 * auditable, a reused number is a second document claiming to be the first.
 */
function allocateInvoiceNumber(db: BetterSqlite3.Database): number {
  const row = db
    .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'retail'")
    .get() as { next_number: number } | undefined

  if (!row) {
    const START = 1
    db.prepare(
      'INSERT INTO invoice_sequences (key, prefix, next_number) VALUES (?,?,?)',
    ).run('retail', '', START + 1)
    return START
  }

  db.prepare("UPDATE invoice_sequences SET next_number = next_number + 1 WHERE key = 'retail'").run()
  return row.next_number
}

export class SqliteRetailSaleRepository implements RetailSaleRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  /**
   * Sale, items and the sequence bump in ONE transaction.
   *
   * A half-written sale — a header with no items, or items whose header rolled
   * back — would be an invoice that adds up to nothing, and nothing on screen
   * would show it. better-sqlite3's `transaction()` rolls the whole thing back
   * if any statement throws, including the CHECK constraints in the schema.
   *
   * The number is taken from `invoice_sequences` and the row bumped inside the
   * same transaction, so two counters saving simultaneously serialise on that
   * row and cannot both take it. If this sale fails after the bump, the bump
   * rolls back with it; if it succeeds and is later voided, the number stays
   * burned — a gap is auditable, a reused number is a second document claiming
   * to be the first.
   */
  post(sale: NewRetailSale): RetailSaleWithItems {
    const db = this.conn.get()
    const id = randomUUID()
    const createdAt = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      const invoiceNumber = allocateInvoiceNumber(db)
      db.prepare(INSERT_SALE).run(...saleParams(sale, id, invoiceNumber, createdAt, null))
      const insertItem = db.prepare(INSERT_ITEM)
      for (const item of sale.items) insertItem.run(...itemParams(item, id))
    })

    run()
    const written = this.findById(id)
    if (!written) throw new Error('Retail sale vanished immediately after being written.')
    return written
  }

  /** A PREVIEW. Reserves nothing, burns nothing — see the note on `post`. */
  peekNextInvoiceNumber(): number {
    const row = this.conn
      .get()
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'retail'")
      .get() as { next_number: number } | undefined
    return row?.next_number ?? 1
  }

  findById(id: string): RetailSaleWithItems | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_sales WHERE id = ?')
      .get(id) as SaleRow | undefined
    return row ? { sale: toSale(row), items: this.itemsFor(row.id) } : null
  }

  findByDraftId(draftId: string): RetailSaleWithItems | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_sales WHERE draft_id = ?')
      .get(draftId) as SaleRow | undefined
    return row ? { sale: toSale(row), items: this.itemsFor(row.id) } : null
  }

  /**
   * Looks up by the INTEGER, not the text.
   *
   * The text column would work too — it holds the same digits — but the integer
   * is the indexed one, and matching on it means a caller cannot accidentally
   * miss a row by passing '007' where the column says '7'.
   */
  findByInvoiceNumber(invoiceNumber: number): RetailSaleWithItems | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_sales WHERE invoice_number = ?')
      .get(invoiceNumber) as SaleRow | undefined
    return row ? { sale: toSale(row), items: this.itemsFor(row.id) } : null
  }

  list(filter: RetailSaleFilter): RetailSale[] {
    const clauses = ['branch_id = ?']
    const params: unknown[] = [filter.branchId]
    if (filter.fromDate) {
      clauses.push('sale_date >= ?')
      params.push(filter.fromDate)
    }
    if (filter.toDate) {
      clauses.push('sale_date <= ?')
      params.push(filter.toDate)
    }
    if (filter.customerId) {
      clauses.push('customer_id = ?')
      params.push(filter.customerId)
    }
    if (filter.status) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    params.push(filter.limit)

    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM retail_sales
          WHERE ${clauses.join(' AND ')}
          ORDER BY sale_date DESC, sale_time DESC
          LIMIT ?`,
      )
      .all(...params) as SaleRow[]
    return rows.map(toSale)
  }

  markVoid(id: string, reason: string, voidedAt: IsoTimestamp): void {
    this.conn
      .get()
      .prepare(
        `UPDATE retail_sales
            SET status = 'void', void_reason = ?, posted_at = COALESCE(posted_at, ?)
          WHERE id = ?`,
      )
      .run(reason, voidedAt, id)
  }

  private itemsFor(saleId: string): RetailSaleItem[] {
    const rows = this.conn
      .get()
      .prepare('SELECT * FROM retail_sale_items WHERE sale_id = ? ORDER BY line_no ASC')
      .all(saleId) as ItemRow[]
    return rows.map(toItem)
  }
}

interface BillRow {
  id: string
  bill_no: string
  branch_id: string
  bill_date: string
  bill_time: string
  customer_id: string | null
  customer_name_snapshot: string
  customer_mobile_snapshot: string | null
  salesman_id: string | null
  salesman_name_snapshot: string | null
  status: string
  created_by: string
  created_at: string
  posted_at: string | null
}

function toBill(row: BillRow): RetailBill {
  return {
    id: row.id,
    billNo: row.bill_no,
    branchId: row.branch_id,
    billDate: toIsoDate(row.bill_date),
    billTime: row.bill_time,
    customerId: row.customer_id,
    customerNameSnapshot: row.customer_name_snapshot,
    customerMobileSnapshot: row.customer_mobile_snapshot,
    salesmanId: row.salesman_id,
    salesmanNameSnapshot: row.salesman_name_snapshot,
    status: row.status as SaleStatus,
    createdByUserId: row.created_by,
    createdAt: toIsoTimestamp(new Date(row.created_at)),
    postedAt: row.posted_at ? toIsoTimestamp(new Date(row.posted_at)) : null,
  }
}

export class SqliteRetailBillRepository implements RetailBillRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  /**
   * The bill, every slip, every item and BOTH sequences — one transaction.
   *
   * This is the whole point of the method, and it is why the slips are not
   * written by calling `SqliteRetailSaleRepository.post` in a loop. That would
   * be one transaction per slip: slip 1 commits, slip 3 violates a CHECK, and
   * the customer leaves with two invoices for a three-piece purchase while the
   * books show two. Here the outer `transaction()` covers every statement, so
   * either the visit is recorded or none of it is.
   *
   * Each slip still takes its own invoice number from the SAME continuous
   * retail sequence, because each slip is a real document handed to a customer.
   * The bill takes its own number from a separate sequence. Every allocation
   * made in this call rolls back together with everything else.
   */
  postBill(bill: NewRetailBill, billPrefix: string): RetailBillWithSlips {
    const db = this.conn.get()
    const billId = randomUUID()
    const createdAt = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      const billNo = allocateNumber(db, 'retail_bill', billPrefix, 5)

      db.prepare(
        `INSERT INTO retail_bills
           (id, bill_no, branch_id, bill_date, bill_time, customer_id,
            customer_name_snapshot, customer_mobile_snapshot, salesman_id,
            salesman_name_snapshot, status, created_by, created_at, posted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        billId,
        billNo,
        bill.branchId,
        bill.billDate,
        bill.billTime,
        bill.customerId,
        bill.customerNameSnapshot,
        bill.customerMobileSnapshot,
        bill.salesmanId,
        bill.salesmanNameSnapshot,
        bill.status,
        bill.createdByUserId,
        createdAt,
        bill.status === 'posted' ? createdAt : null,
      )

      const insertSale = db.prepare(INSERT_SALE)
      const insertItem = db.prepare(INSERT_ITEM)

      for (const slip of bill.slips) {
        const saleId = randomUUID()
        const invoiceNumber = allocateInvoiceNumber(db)
        insertSale.run(
          ...saleParams(slip.sale, saleId, invoiceNumber, createdAt, {
            id: billId,
            slipNo: slip.slipNo,
            slipLabel: slip.slipLabel,
          }),
        )
        for (const item of slip.sale.items) insertItem.run(...itemParams(item, saleId))
      }
    })

    run()
    const written = this.findById(billId)
    if (!written) throw new Error('Retail bill vanished immediately after being written.')
    return written
  }

  findById(id: string): RetailBillWithSlips | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_bills WHERE id = ?')
      .get(id) as BillRow | undefined
    return row ? { bill: toBill(row), slips: this.slipsFor(row.id) } : null
  }

  findByBillNo(billNo: string): RetailBillWithSlips | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_bills WHERE bill_no = ?')
      .get(billNo.trim()) as BillRow | undefined
    return row ? { bill: toBill(row), slips: this.slipsFor(row.id) } : null
  }

  peekNextBillNo(prefix: string): string {
    const row = this.conn
      .get()
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'retail_bill'")
      .get() as { next_number: number } | undefined
    return `${prefix}${(row?.next_number ?? 1).toString().padStart(5, '0')}`
  }

  private slipsFor(billId: string): RetailSlip[] {
    const db = this.conn.get()
    const rows = db
      .prepare('SELECT * FROM retail_sales WHERE bill_id = ? ORDER BY slip_no ASC')
      .all(billId) as Array<SaleRow & { slip_no: number; slip_label: string | null }>

    const itemsOf = db.prepare(
      'SELECT * FROM retail_sale_items WHERE sale_id = ? ORDER BY line_no ASC',
    )
    return rows.map((row) => ({
      sale: toSale(row),
      items: (itemsOf.all(row.id) as ItemRow[]).map(toItem),
      slipNo: row.slip_no,
      slipLabel: row.slip_label ?? DEFAULT_SLIP_LABEL,
    }))
  }
}

interface DraftBillRow {
  id: string
  branch_id: string
  bill_date: string
  bill_time: string
  customer_id: string | null
  customer_name: string
  customer_mobile: string | null
  salesman_id: string | null
  rate_purity: string
  rate_override_text: string
  weight_unit: string
  active_slip_no: number
  editing_slip_no: number | null
  editing_line_no: number | null
  created_by: string
}

interface DraftSlipRow {
  id: string
  slip_no: number
  slip_label: string
  draft_key: string
  customer_gold_text: string
  customer_gold_mg: number | null
  customer_gold_purity: string | null
  hallmark_text: string
  other_text: string
  discount_text: string
  amount_paid_text: string
  payment_method: string
  remarks: string | null
}

interface DraftItemRow {
  draft_slip_id: string
  line_no: number
  item_name: string
  purity: string
  gross_text: string
  gross_mg: number | null
  stone_text: string
  stone_mg: number | null
  purity_deduction_text: string
  purity_deduction_mg: number | null
  wastage_percent_text: string
  labour_text: string
  labour_mode: string
  stone_charges_text: string
}

/**
 * The bill in progress, on disk.
 *
 * Save is DELETE-then-write inside one transaction. A counter serves one
 * customer at a time, so the branch's draft is the current state of the screen
 * rather than a history of it — and replacing wholesale means a deleted slip or
 * a removed item genuinely disappears, which a merge would have to be told
 * about separately and would eventually get wrong.
 *
 * It runs on a 400ms debounce as the operator types, so it does the least work
 * that is still atomic: one delete and a handful of inserts, no diffing.
 */
export class SqliteRetailDraftRepository implements RetailDraftRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  save(draft: DraftBill): void {
    const db = this.conn.get()
    const now = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      // ON DELETE CASCADE takes the slips and their items with it.
      db.prepare('DELETE FROM retail_draft_bills WHERE branch_id = ?').run(draft.branchId)

      const billId = randomUUID()
      db.prepare(
        `INSERT INTO retail_draft_bills
           (id, branch_id, bill_date, bill_time, customer_id, customer_name,
            customer_mobile, salesman_id, rate_purity, rate_override_text,
            weight_unit, active_slip_no, editing_slip_no, editing_line_no,
            created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        billId,
        draft.branchId,
        draft.billDate,
        draft.billTime,
        draft.customerId,
        draft.customerName,
        draft.customerMobile,
        draft.salesmanId,
        draft.ratePurity,
        draft.ratePerTolaOverride,
        draft.weightUnit,
        draft.activeSlipNo,
        draft.editingSlipNo,
        draft.editingLineNo,
        draft.createdByUserId,
        now,
        now,
      )

      const insertSlip = db.prepare(
        `INSERT INTO retail_draft_slips
           (id, draft_bill_id, slip_no, slip_label, draft_key, customer_gold_text,
            customer_gold_mg, customer_gold_purity, hallmark_text, other_text,
            discount_text, amount_paid_text, payment_method, remarks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      const insertItem = db.prepare(
        `INSERT INTO retail_draft_items
           (id, draft_slip_id, line_no, item_name, purity, gross_text, gross_mg,
            stone_text, stone_mg, purity_deduction_text, purity_deduction_mg,
            wastage_percent_text, labour_text, labour_mode, stone_charges_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )

      for (const slip of draft.slips) {
        const slipId = randomUUID()
        insertSlip.run(
          slipId,
          billId,
          slip.slipNo,
          slip.slipLabel,
          slip.draftKey,
          slip.customerGold.text,
          slip.customerGold.exactMg,
          slip.customerGoldPurity,
          slip.hallmarkCharges,
          slip.otherCharges,
          slip.discount,
          slip.amountPaid,
          slip.paymentMethod,
          slip.remarks,
        )
        for (const item of slip.items) {
          insertItem.run(
            randomUUID(),
            slipId,
            item.lineNo,
            item.itemName,
            item.purity,
            item.gross.text,
            item.gross.exactMg,
            item.stone.text,
            item.stone.exactMg,
            item.purityDeduction.text,
            item.purityDeduction.exactMg,
            item.wastagePercent,
            item.labourCharges,
            item.labourMode,
            item.stoneCharges,
          )
        }
      }
    })

    run()
  }

  find(branchId: string): DraftBill | null {
    const db = this.conn.get()
    const bill = db
      .prepare('SELECT * FROM retail_draft_bills WHERE branch_id = ?')
      .get(branchId) as DraftBillRow | undefined
    if (!bill) return null

    const slipRows = db
      .prepare('SELECT * FROM retail_draft_slips WHERE draft_bill_id = ? ORDER BY slip_no ASC')
      .all(bill.id) as DraftSlipRow[]
    const itemsOf = db.prepare(
      'SELECT * FROM retail_draft_items WHERE draft_slip_id = ? ORDER BY line_no ASC',
    )

    return {
      branchId: bill.branch_id,
      billDate: toIsoDate(bill.bill_date),
      billTime: bill.bill_time,
      customerId: bill.customer_id,
      customerName: bill.customer_name,
      customerMobile: bill.customer_mobile,
      salesmanId: bill.salesman_id,
      ratePurity: bill.rate_purity,
      ratePerTolaOverride: bill.rate_override_text,
      weightUnit: bill.weight_unit,
      activeSlipNo: bill.active_slip_no,
      editingSlipNo: bill.editing_slip_no,
      editingLineNo: bill.editing_line_no,
      createdByUserId: bill.created_by,
      slips: slipRows.map((slip) => ({
        slipNo: slip.slip_no,
        slipLabel: slip.slip_label,
        draftKey: slip.draft_key,
        customerGold: { text: slip.customer_gold_text, exactMg: slip.customer_gold_mg },
        customerGoldPurity: slip.customer_gold_purity,
        hallmarkCharges: slip.hallmark_text,
        otherCharges: slip.other_text,
        discount: slip.discount_text,
        amountPaid: slip.amount_paid_text,
        paymentMethod: slip.payment_method,
        remarks: slip.remarks,
        items: (itemsOf.all(slip.id) as DraftItemRow[]).map((item) => ({
          lineNo: item.line_no,
          itemName: item.item_name,
          purity: item.purity,
          gross: { text: item.gross_text, exactMg: item.gross_mg },
          stone: { text: item.stone_text, exactMg: item.stone_mg },
          purityDeduction: {
            text: item.purity_deduction_text,
            exactMg: item.purity_deduction_mg,
          },
          wastagePercent: item.wastage_percent_text,
          labourCharges: item.labour_text,
          labourMode: item.labour_mode,
          stoneCharges: item.stone_charges_text,
        })),
      })),
    }
  }

  clear(branchId: string): void {
    this.conn.get().prepare('DELETE FROM retail_draft_bills WHERE branch_id = ?').run(branchId)
  }
}
