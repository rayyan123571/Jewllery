import { randomUUID } from 'node:crypto'
import {
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
  type RetailSale,
  type RetailSaleItem,
  type RetailSaleWithItems,
  type SaleStatus,
  type Salesman,
} from '@jewellery/domain'
import type {
  CustomerRepository,
  CustomerSearchResult,
  NewRetailSale,
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
    cutPerTola: Weight.fromMilligrams(row.cut_per_tola_mg),
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
  post(sale: NewRetailSale, prefix: string): RetailSaleWithItems {
    const db = this.conn.get()
    const id = randomUUID()
    const createdAt = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      const invoiceNo = this.allocateInvoiceNo(prefix)

      db.prepare(
        `INSERT INTO retail_sales
           (id, invoice_no, branch_id, sale_date, sale_time, customer_id,
            customer_name_snapshot, customer_mobile_snapshot, salesman_id,
            salesman_name_snapshot, rate_purity, rate_per_tola_paisa,
            gold_value_paisa, customer_gold_mg, customer_gold_purity,
            customer_gold_value_paisa, hallmark_charges_paisa, other_charges_paisa,
            discount_paisa, grand_total_paisa, amount_paid_paisa, payment_method,
            balance_paisa, amount_in_words, remarks, status, void_reason,
            wastage_direction, wastage_basis, created_by, created_at, posted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        invoiceNo,
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
        sale.wastageDirection,
        sale.wastageBasis,
        sale.createdByUserId,
        createdAt,
        sale.status === 'posted' ? createdAt : null,
      )

      const insertItem = db.prepare(
        `INSERT INTO retail_sale_items
           (id, sale_id, line_no, item_name, purity, gross_weight_mg,
            stone_weight_mg, cut_per_tola_mg, net_weight_mg, wastage_bp,
            wastage_mg, fine_weight_mg, labour_charges_paisa, labour_mode,
            stone_charges_paisa, line_amount_paisa)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )

      for (const item of sale.items) {
        insertItem.run(
          randomUUID(),
          id,
          item.lineNo,
          item.itemName,
          item.purity,
          item.grossWeight.milligrams,
          item.stoneWeight.milligrams,
          item.cutPerTola.milligrams,
          item.netWeight.milligrams,
          item.wastageBp,
          item.wastage.milligrams,
          item.fineWeight.milligrams,
          item.labourCharges.paisa,
          item.labourMode,
          item.stoneCharges.paisa,
          item.lineAmount.paisa,
        )
      }
    })

    run()
    const written = this.findById(id)
    if (!written) throw new Error('Retail sale vanished immediately after being written.')
    return written
  }

  /**
   * Takes the next number and bumps the row. Callers must already be in a
   * transaction — `post` is the only one, deliberately.
   */
  private allocateInvoiceNo(prefix: string): string {
    const db = this.conn.get()
    const key = 'retail'
    const row = db
      .prepare('SELECT next_number FROM invoice_sequences WHERE key = ?')
      .get(key) as { next_number: number } | undefined

    if (!row) {
      const START = 1
      db.prepare(
        'INSERT INTO invoice_sequences (key, prefix, next_number) VALUES (?,?,?)',
      ).run(key, prefix, START + 1)
      return `${prefix}${START.toString().padStart(5, '0')}`
    }

    db.prepare('UPDATE invoice_sequences SET next_number = next_number + 1 WHERE key = ?').run(
      key,
    )
    return `${prefix}${row.next_number.toString().padStart(5, '0')}`
  }

  peekNextInvoiceNo(prefix: string): string {
    const row = this.conn
      .get()
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'retail'")
      .get() as { next_number: number } | undefined
    return `${prefix}${(row?.next_number ?? 1).toString().padStart(5, '0')}`
  }

  findById(id: string): RetailSaleWithItems | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_sales WHERE id = ?')
      .get(id) as SaleRow | undefined
    return row ? { sale: toSale(row), items: this.itemsFor(row.id) } : null
  }

  findByInvoiceNo(invoiceNo: string): RetailSaleWithItems | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM retail_sales WHERE invoice_no = ?')
      .get(invoiceNo.trim()) as SaleRow | undefined
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
