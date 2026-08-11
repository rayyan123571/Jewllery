import {
  Money,
  Weight,
  computeRetailLine,
  fixedClock,
  parseTola,
  toIsoDate,
  toIsoTimestamp,
  totalsOfRetail,
  type NewCustomer,
  type RetailLineInput,
} from '@jewellery/domain'
import type { NewRetailSale, Repositories } from '@jewellery/application'
import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type SqliteDatabase } from '../Database.js'
import { createRepositories } from './index.js'

/**
 * A real sale through the real repository into a real database.
 *
 * retailMath.test.ts proves the arithmetic with no database at all; this proves
 * it survives the round trip as integers, and — the part that matters most —
 * that a sale is atomic and its invoice number cannot be taken twice.
 */

const clock = fixedClock('2026-08-30T09:00:00.000Z')
const BRANCH = 'branch-1'
const RATE = Money.fromRupees(237_970)

let db: SqliteDatabase
let repos: Repositories
let userId = ''

const LINE: RetailLineInput = {
  itemName: 'Bangles',
  grossWeight: parseTola('4.050'),
  stoneWeight: Weight.ZERO,
  cutPerTola: Weight.ZERO,
  wastageBp: 1400,
  labourCharges: Money.fromRupees(5_000),
  labourMode: 'fixed',
  stoneCharges: Money.ZERO,
  ratePerTola: RATE,
}

function saleOf(overrides: Partial<NewRetailSale> = {}): NewRetailSale {
  const computed = [computeRetailLine(LINE, { direction: 'add', basis: 'net' })]
  const totals = totalsOfRetail(computed)
  return {
    branchId: BRANCH,
    saleDate: toIsoDate('2026-08-30'),
    saleTime: '14:05',
    customerId: null,
    customerNameSnapshot: 'Walk-in',
    customerMobileSnapshot: null,
    salesmanId: null,
    salesmanNameSnapshot: null,
    ratePurity: 'K22',
    ratePerTola: RATE,
    goldValue: totals.goldValue,
    customerGold: Weight.ZERO,
    customerGoldPurity: null,
    customerGoldValue: Money.ZERO,
    hallmarkCharges: Money.ZERO,
    otherCharges: Money.ZERO,
    discount: Money.ZERO,
    grandTotal: totals.itemsTotal,
    amountPaid: totals.itemsTotal,
    paymentMethod: 'cash',
    balance: Money.ZERO,
    amountInWords: 'Rupees Only',
    remarks: null,
    status: 'posted',
    wastageDirection: 'add',
    wastageBasis: 'net',
    draftId: null,
    createdByUserId: userId,
    items: computed.map((line, index) => ({
      lineNo: index + 1,
      itemName: line.itemName,
      purity: 'K22' as const,
      grossWeight: line.grossWeight,
      stoneWeight: line.stoneWeight,
      cutPerTola: line.cutPerTola,
      netWeight: line.netWeight,
      wastageBp: line.wastageBp,
      wastage: line.wastage,
      fineWeight: line.fineWeight,
      labourCharges: line.labourCharges,
      labourMode: line.labourMode,
      stoneCharges: line.stoneCharges,
      lineAmount: line.lineAmount,
    })),
    ...overrides,
  }
}

const NEW_CUSTOMER: NewCustomer = {
  code: 'C-0001',
  name: 'Ahmed Ali',
  mobile: '03001234567',
  address: null,
  city: 'Lahore',
  cnic: null,
  isWalkIn: false,
  openingGold: Weight.ZERO,
  openingCash: Money.ZERO,
}

beforeEach(() => {
  db = openInMemoryDatabase()
  repos = createRepositories(db, clock)
  repos.branches.create({
    id: BRANCH,
    name: 'Main Branch',
    address: null,
    isDefault: true,
    isActive: true,
  })
  userId = repos.users.create({
    branchId: BRANCH,
    name: 'Admin',
    username: 'admin',
    passwordHash: 'x',
    role: 'ADMIN',
    mustChangePassword: false,
  }).id
})

describe('a sale is written atomically', () => {
  it('stores the sale and its items together', () => {
    const written = repos.retailSales.post(saleOf(), 'RS-')
    expect(written.items).toHaveLength(1)
    expect(written.sale.invoiceNo).toBe('RS-00001')
  })

  it('leaves NO partial sale when an item fails mid-insert', () => {
    // The failure this guards against: a header with no items is an invoice
    // that adds up to nothing, and nothing on screen would show it. A gross
    // weight of zero trips the CHECK constraint on the second row, after the
    // header and the first item have already been inserted.
    const sale = saleOf()
    const broken: NewRetailSale = {
      ...sale,
      items: [
        ...sale.items,
        { ...(sale.items[0] as (typeof sale.items)[number]), lineNo: 2, grossWeight: Weight.ZERO },
      ],
    }

    expect(() => repos.retailSales.post(broken, 'RS-')).toThrow()

    const rows = db.prepare('SELECT COUNT(*) AS n FROM retail_sales').get() as { n: number }
    const items = db.prepare('SELECT COUNT(*) AS n FROM retail_sale_items').get() as { n: number }
    expect(rows.n).toBe(0)
    expect(items.n).toBe(0)
  })

  it('rolls the sequence back with the sale, so a failure burns no number', () => {
    const sale = saleOf()
    const broken: NewRetailSale = {
      ...sale,
      items: [{ ...(sale.items[0] as (typeof sale.items)[number]), grossWeight: Weight.ZERO }],
    }
    expect(() => repos.retailSales.post(broken, 'RS-')).toThrow()

    // The next real sale still gets the first number: a failed attempt is not
    // a document, so it must not consume one.
    const good = repos.retailSales.post(saleOf(), 'RS-')
    expect(good.sale.invoiceNo).toBe('RS-00001')
  })
})

describe('the invoice sequence', () => {
  it('never issues the same number twice', () => {
    const numbers = Array.from(
      { length: 25 },
      () => repos.retailSales.post(saleOf(), 'RS-').sale.invoiceNo,
    )
    expect(new Set(numbers).size).toBe(25)
    expect(numbers[0]).toBe('RS-00001')
    expect(numbers[24]).toBe('RS-00025')
  })

  it('burns the number of a voided sale — it is never reused', () => {
    const first = repos.retailSales.post(saleOf(), 'RS-')
    repos.retailSales.markVoid(
      first.sale.id,
      'entered twice',
      toIsoTimestamp(clock.now()),
    )

    const second = repos.retailSales.post(saleOf(), 'RS-')
    // A gap is auditable. A reused number is a second document claiming to be
    // the first, and the void row keeps its own number forever.
    expect(second.sale.invoiceNo).toBe('RS-00002')
    expect(repos.retailSales.findById(first.sale.id)?.sale.invoiceNo).toBe('RS-00001')
    expect(repos.retailSales.findById(first.sale.id)?.sale.status).toBe('void')
  })

  it('refuses a duplicate invoice number at the database level', () => {
    repos.retailSales.post(saleOf(), 'RS-')
    // Belt and braces: even if the sequence were bypassed, UNIQUE stops it.
    expect(() =>
      db
        .prepare(
          `INSERT INTO retail_sales
             (id, invoice_no, branch_id, sale_date, sale_time,
              customer_name_snapshot, rate_purity, rate_per_tola_paisa,
              gold_value_paisa, grand_total_paisa, payment_method,
              amount_in_words, status, created_by, created_at)
           VALUES ('dup','RS-00001',?, '2026-08-30','14:05','X','K22',1,1,1,'cash','x','posted',?, '2026-08-30')`,
        )
        .run(BRANCH, userId),
    ).toThrow(/UNIQUE/i)
  })

  it('previews the next number without reserving it', () => {
    expect(repos.retailSales.peekNextInvoiceNo('RS-')).toBe('RS-00001')
    expect(repos.retailSales.peekNextInvoiceNo('RS-')).toBe('RS-00001')
    // Peeking twice changed nothing; the first real save still takes 00001.
    expect(repos.retailSales.post(saleOf(), 'RS-').sale.invoiceNo).toBe('RS-00001')
  })

  it('never resets, so a number is unique on its own terms', () => {
    // The financial year is gone from the sequence entirely. One continuous
    // counter for the life of the shop means there is no reset, and therefore
    // no year boundary at which two sales could claim the same number — the
    // collision this test previously existed to catch cannot occur at all.
    const first = repos.retailSales.post(saleOf(), 'RS-')
    const second = repos.retailSales.post(saleOf(), 'RS-')
    expect(first.sale.invoiceNo).toBe('RS-00001')
    expect(second.sale.invoiceNo).toBe('RS-00002')
  })
})

describe('what a sale stores', () => {
  it('round-trips every figure as an exact integer', () => {
    const written = repos.retailSales.post(saleOf(), 'RS-')
    const read = repos.retailSales.findById(written.sale.id)
    expect(read?.sale.grandTotal.paisa).toBe(written.sale.grandTotal.paisa)
    expect(read?.items[0]?.fineWeight.milligrams).toBe(written.items[0]?.fineWeight.milligrams)
    expect(read?.items[0]?.wastageBp).toBe(1400)
  })

  it('stores the wastage rule the sale was priced with', () => {
    const written = repos.retailSales.post(
      saleOf({ wastageDirection: 'subtract', wastageBasis: 'gross' }),
      'RS-',
    )
    const read = db
      .prepare('SELECT wastage_direction, wastage_basis FROM retail_sales WHERE id = ?')
      .get(written.sale.id) as { wastage_direction: string; wastage_basis: string }
    expect(read.wastage_direction).toBe('subtract')
    expect(read.wastage_basis).toBe('gross')
  })

  it('snapshots the customer name so the invoice survives a rename', () => {
    const customer = repos.customers.create(NEW_CUSTOMER, userId)
    const written = repos.retailSales.post(
      saleOf({ customerId: customer.id, customerNameSnapshot: 'Ahmed Ali' }),
      'RS-',
    )
    db.prepare('UPDATE customers SET name = ? WHERE id = ?').run('Someone Else', customer.id)

    // The paper in the customer's hand says Ahmed Ali. So does the screen.
    expect(repos.retailSales.findById(written.sale.id)?.sale.customerNameSnapshot).toBe(
      'Ahmed Ali',
    )
  })

  it('finds a sale by its invoice number', () => {
    const written = repos.retailSales.post(saleOf(), 'RS-')
    expect(repos.retailSales.findByInvoiceNo('RS-00001')?.sale.id).toBe(written.sale.id)
  })

  it('lists by date, customer and status', () => {
    repos.retailSales.post(saleOf(), 'RS-')
    repos.retailSales.post(saleOf({ status: 'held' }), 'RS-')
    expect(repos.retailSales.list({ branchId: BRANCH, limit: 50 })).toHaveLength(2)
    expect(
      repos.retailSales.list({ branchId: BRANCH, status: 'held', limit: 50 }),
    ).toHaveLength(1)
    expect(
      repos.retailSales.list({ branchId: BRANCH, fromDate: toIsoDate('2027-01-01'), limit: 50 }),
    ).toHaveLength(0)
  })
})

describe('customers', () => {
  it('creates and finds by code', () => {
    const created = repos.customers.create(NEW_CUSTOMER, userId)
    expect(repos.customers.findByCode('C-0001')?.id).toBe(created.id)
  })

  it('searches by name prefix, code, or anywhere in the mobile', () => {
    repos.customers.create(NEW_CUSTOMER, userId)
    expect(repos.customers.search('Ahm', 10)).toHaveLength(1)
    expect(repos.customers.search('C-00', 10)).toHaveLength(1)
    // People remember the last four digits, so mobile searches anywhere.
    expect(repos.customers.search('4567', 10)).toHaveLength(1)
    // A name match mid-word is not offered: an unpredictable suggestion stops
    // being trusted, which is the same rule the party type-ahead follows.
    expect(repos.customers.search('med Ali', 10)).toHaveLength(0)
  })

  it('allocates sequential codes', () => {
    repos.customers.create(NEW_CUSTOMER, userId)
    expect(repos.customers.nextCode('C-')).toBe('C-0002')
  })

  it('refuses a duplicate code', () => {
    repos.customers.create(NEW_CUSTOMER, userId)
    expect(() => repos.customers.create(NEW_CUSTOMER, userId)).toThrow(/UNIQUE/i)
  })
})
