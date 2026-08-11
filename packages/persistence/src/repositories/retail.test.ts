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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeDatabase,
  openDatabase,
  openInMemoryDatabase,
  type SqliteDatabase,
} from '../Database.js'
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
  purityDeduction: Weight.ZERO,
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
      purityDeduction: line.purityDeduction,
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

/** Branch and user, on whichever repositories are handed in. Returns the user id. */
function seedBranchAndUser(target: Repositories): string {
  target.branches.create({
    id: BRANCH,
    name: 'Main Branch',
    address: null,
    isDefault: true,
    isActive: true,
  })
  return target.users.create({
    branchId: BRANCH,
    name: 'Admin',
    username: 'admin',
    passwordHash: 'x',
    role: 'ADMIN',
    mustChangePassword: false,
  }).id
}

/** One item, priced through the real domain, with an ABSOLUTE deduction. */
function itemOf(name: string, grossTola: string, deductionTola: string, lineNo = 1) {
  const computed = computeRetailLine(
    {
      itemName: name,
      grossWeight: parseTola(grossTola),
      stoneWeight: Weight.ZERO,
      purityDeduction: parseTola(deductionTola),
      wastageBp: 1400,
      labourCharges: Money.fromRupees(5_000),
      labourMode: 'fixed',
      stoneCharges: Money.ZERO,
      ratePerTola: RATE,
    },
    { direction: 'add', basis: 'net' },
  )
  return {
    lineNo,
    itemName: computed.itemName,
    purity: 'K22' as const,
    grossWeight: computed.grossWeight,
    stoneWeight: computed.stoneWeight,
    purityDeduction: computed.purityDeduction,
    netWeight: computed.netWeight,
    wastageBp: computed.wastageBp,
    wastage: computed.wastage,
    fineWeight: computed.fineWeight,
    labourCharges: computed.labourCharges,
    labourMode: computed.labourMode,
    stoneCharges: computed.stoneCharges,
    lineAmount: computed.lineAmount,
  }
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

/**
 * A bill, in the real database.
 *
 * The service test proves the same guarantee against a fake. This proves it
 * against SQLite, which is where it actually has to hold: `postBill` wraps the
 * bill row, every slip, every item and BOTH sequence bumps in one transaction,
 * so a constraint violation on the last slip un-writes the first.
 */
describe('a bill groups slips, atomically', () => {
  function billOf(slips: ReadonlyArray<{ slipNo: number; slipLabel: string }>) {
    return {
      branchId: BRANCH,
      billDate: toIsoDate('2026-08-30'),
      billTime: '14:05',
      customerId: null,
      customerNameSnapshot: 'Walk-in',
      customerMobileSnapshot: null,
      salesmanId: null,
      salesmanNameSnapshot: null,
      status: 'posted' as const,
      createdByUserId: userId,
      slips: slips.map((slip) => ({ ...slip, sale: saleOf() })),
    }
  }

  it('writes every slip under one bill, each with its own invoice number', () => {
    const written = repos.retailBills.postBill(
      billOf([
        { slipNo: 1, slipLabel: 'Full Bill' },
        { slipNo: 2, slipLabel: 'Gold Bangles' },
        { slipNo: 3, slipLabel: 'Gold Chain' },
      ]),
      'RB-',
      'RS-',
    )

    expect(written.bill.billNo).toBe('RB-00001')
    expect(written.slips.map((s) => s.sale.invoiceNo)).toEqual([
      'RS-00001',
      'RS-00002',
      'RS-00003',
    ])
    expect(written.slips.map((s) => s.slipLabel)).toEqual([
      'Full Bill',
      'Gold Bangles',
      'Gold Chain',
    ])
    // Every item survived the round trip, on the right slip.
    for (const slip of written.slips) expect(slip.items).toHaveLength(1)
  })

  it('reads a bill back with its slips in slip order', () => {
    const written = repos.retailBills.postBill(
      billOf([
        { slipNo: 2, slipLabel: 'Gold Chain' },
        { slipNo: 1, slipLabel: 'Full Bill' },
      ]),
      'RB-',
      'RS-',
    )
    const read = repos.retailBills.findById(written.bill.id)
    expect(read?.slips.map((s) => s.slipNo)).toEqual([1, 2])
  })

  it('writes NOTHING when one slip violates a constraint', () => {
    // A zero gross weight trips `CHECK (gross_weight_mg > 0)` on the LAST slip,
    // after the first two have already been inserted inside the transaction.
    const bill = billOf([
      { slipNo: 1, slipLabel: 'Full Bill' },
      { slipNo: 2, slipLabel: 'Gold Bangles' },
      { slipNo: 3, slipLabel: 'Gold Chain' },
    ])
    const broken = {
      ...bill,
      slips: bill.slips.map((slip, index) =>
        index < 2
          ? slip
          : {
              ...slip,
              sale: {
                ...slip.sale,
                items: slip.sale.items.map((item) => ({ ...item, grossWeight: Weight.ZERO })),
              },
            },
      ),
    }

    expect(() => repos.retailBills.postBill(broken, 'RB-', 'RS-')).toThrow(/CHECK|constraint/i)

    // Not one row of it landed — bill, slips or items.
    expect(count('retail_bills')).toBe(0)
    expect(count('retail_sales')).toBe(0)
    expect(count('retail_sale_items')).toBe(0)
  })

  it('rolls the invoice sequence back with the bill that failed', () => {
    const bill = billOf([{ slipNo: 1, slipLabel: 'Full Bill' }])
    const broken = {
      ...bill,
      slips: bill.slips.map((slip) => ({
        ...slip,
        sale: {
          ...slip.sale,
          items: slip.sale.items.map((item) => ({ ...item, grossWeight: Weight.ZERO })),
        },
      })),
    }
    expect(() => repos.retailBills.postBill(broken, 'RB-', 'RS-')).toThrow()

    // The bump rolled back with everything else, so the next real sale takes
    // the first number rather than leaving a gap nothing accounts for.
    expect(repos.retailSales.post(saleOf(), 'RS-').sale.invoiceNo).toBe('RS-00001')
    expect(repos.retailBills.peekNextBillNo('RB-')).toBe('RB-00001')
  })

  it('refuses two slips with the same number in one bill', () => {
    expect(() =>
      repos.retailBills.postBill(
        billOf([
          { slipNo: 1, slipLabel: 'Full Bill' },
          { slipNo: 1, slipLabel: 'Duplicate' },
        ]),
        'RB-',
        'RS-',
      ),
    ).toThrow(/UNIQUE/i)
  })

  it('leaves a sale with no bill alone — a single-slip sale is a whole sale', () => {
    const solo = repos.retailSales.post(saleOf(), 'RS-')
    expect(solo.sale.invoiceNo).toBe('RS-00001')
    // Two of them, to prove the partial unique index tolerates many NULLs.
    const second = repos.retailSales.post(saleOf(), 'RS-')
    expect(second.sale.invoiceNo).toBe('RS-00002')
    expect(count('retail_bills')).toBe(0)
  })

  it('keeps bill numbers on their own sequence, not the invoice one', () => {
    repos.retailSales.post(saleOf(), 'RS-')
    repos.retailSales.post(saleOf(), 'RS-')
    const written = repos.retailBills.postBill(
      billOf([{ slipNo: 1, slipLabel: 'Full Bill' }]),
      'RB-',
      'RS-',
    )
    // Two standalone sales spent RS-00001 and RS-00002; the bill is still the
    // FIRST bill, and its slip takes the third invoice number.
    expect(written.bill.billNo).toBe('RB-00001')
    expect(written.slips[0]?.sale.invoiceNo).toBe('RS-00003')
  })
})

function count(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return row.n
}

/**
 * The whole chain, against a real SQLite file.
 *
 * Not an in-memory database and not a fake: these open a file on disk, write
 * through the real service, CLOSE the connection, reopen it, and read back. A
 * round trip that never leaves the process proves the mapper; this proves the
 * file.
 */
describe('a bill survives the database, field for field', () => {
  let file: string
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jewellery-roundtrip-'))
    file = join(directory, 'shop.sqlite')
  })

  afterEach(() => {
    // Best-effort: Windows will not unlink a file SQLite still holds open, and
    // a test that failed mid-way leaves the connection up. Swallowing this
    // keeps the REAL failure on screen instead of an EPERM on the temp dir.
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      /* the OS will clear its own temp directory */
    }
  })

  /** Opens the file, runs the migrations, and hands back live repositories. */
  function open() {
    const db = openDatabase({ file })
    return { db, repos: createRepositories(db, clock) }
  }

  it('round-trips two slips and four items through a real file', () => {
    const first = open()
    const userId = seedBranchAndUser(first.repos)

    const written = first.repos.retailBills.postBill(
      {
        branchId: BRANCH,
        billDate: toIsoDate('2026-08-30'),
        billTime: '14:05',
        customerId: null,
        customerNameSnapshot: 'IMRAN SAHIB',
        customerMobileSnapshot: '03001234567',
        salesmanId: null,
        salesmanNameSnapshot: null,
        status: 'posted',
        createdByUserId: userId,
        slips: [
          {
            slipNo: 1,
            slipLabel: 'Full Bill',
            sale: saleOf({
              createdByUserId: userId,
              items: [
                itemOf('Ring', '2.000', '0.090', 1),
                itemOf('Baliyoon', '2.000', '0.090', 2),
              ],
            }),
          },
          {
            slipNo: 2,
            slipLabel: 'Gold Bangles',
            sale: saleOf({
              createdByUserId: userId,
              items: [
                itemOf('Gold Chain', '3.500', '0.000', 1),
                itemOf('Gold Tops', '1.250', '0.050', 2),
              ],
            }),
          },
        ],
      },
      'RB-',
      'RS-',
    )
    const billId = written.bill.id
    closeDatabase(first.db)

    // A different connection to the same file. Nothing is shared but the bytes.
    const second = open()
    const read = second.repos.retailBills.findById(billId)
    expect(read).toBeTruthy()
    if (!read) return

    expect(read.bill.billNo).toBe('RB-00001')
    expect(read.bill.customerNameSnapshot).toBe('IMRAN SAHIB')
    expect(read.bill.customerMobileSnapshot).toBe('03001234567')
    expect(read.bill.billDate).toBe('2026-08-30')
    expect(read.bill.billTime).toBe('14:05')
    expect(read.slips).toHaveLength(2)
    expect(read.slips.map((s) => s.slipNo)).toEqual([1, 2])
    expect(read.slips.map((s) => s.slipLabel)).toEqual(['Full Bill', 'Gold Bangles'])
    expect(read.slips.map((s) => s.sale.invoiceNo)).toEqual(['RS-00001', 'RS-00002'])

    // Four items, every stored field compared against what was written.
    const readItems = read.slips.flatMap((slip) => slip.items)
    const writtenItems = written.slips.flatMap((slip) => slip.items)
    expect(readItems).toHaveLength(4)

    for (const [index, item] of readItems.entries()) {
      const source = writtenItems[index]
      expect(source).toBeTruthy()
      if (!source) continue
      expect(item.itemName).toBe(source.itemName)
      expect(item.purity).toBe(source.purity)
      // Weights: milligrams, exactly.
      expect(item.grossWeight.milligrams).toBe(source.grossWeight.milligrams)
      expect(item.stoneWeight.milligrams).toBe(source.stoneWeight.milligrams)
      expect(item.purityDeduction.milligrams).toBe(source.purityDeduction.milligrams)
      expect(item.netWeight.milligrams).toBe(source.netWeight.milligrams)
      expect(item.wastage.milligrams).toBe(source.wastage.milligrams)
      expect(item.fineWeight.milligrams).toBe(source.fineWeight.milligrams)
      // Money: paisa, exactly.
      expect(item.labourCharges.paisa).toBe(source.labourCharges.paisa)
      expect(item.stoneCharges.paisa).toBe(source.stoneCharges.paisa)
      expect(item.lineAmount.paisa).toBe(source.lineAmount.paisa)
      // Basis points, and the labour mode that gives the figure its meaning.
      expect(item.wastageBp).toBe(source.wastageBp)
      expect(item.labourMode).toBe(source.labourMode)
    }

    // The rule each slip was PRICED with, so a reprint reproduces the paper.
    for (const slip of read.slips) {
      expect(slip.sale.wastageDirection).toBe('add')
      expect(slip.sale.wastageBasis).toBe('net')
      expect(slip.sale.ratePerTola.paisa).toBe(RATE.paisa)
      expect(slip.sale.status).toBe('posted')
    }

    closeDatabase(second.db)
  })

  it('stores every money and weight column as an INTEGER, never a float', () => {
    const { db, repos } = open()
    const userId = seedBranchAndUser(repos)
    repos.retailBills.postBill(
      {
        branchId: BRANCH,
        billDate: toIsoDate('2026-08-30'),
        billTime: '14:05',
        customerId: null,
        customerNameSnapshot: 'IMRAN SAHIB',
        customerMobileSnapshot: null,
        salesmanId: null,
        salesmanNameSnapshot: null,
        status: 'posted',
        createdByUserId: userId,
        slips: [
          {
            slipNo: 1,
            slipLabel: 'Full Bill',
            sale: saleOf({ createdByUserId: userId, items: [itemOf('Ring', '2.000', '0.090')] }),
          },
        ],
      },
      'RB-',
      'RS-',
    )

    // Declared types: no REAL, FLOAT or DOUBLE on any retail table.
    for (const table of ['retail_sales', 'retail_sale_items', 'retail_bills']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string
        type: string
      }>
      const offenders = columns
        .filter((column) => /REAL|FLOAT|DOUBLE/i.test(column.type))
        .map((column) => `${table}.${column.name}`)
      expect(offenders).toEqual([])
    }

    // And the STORED values: SQLite is dynamically typed, so a declared INTEGER
    // column will happily hold 2.5 if something puts it there. typeof() asks
    // what is actually in the cell.
    const stored = db
      .prepare(
        `SELECT typeof(gross_weight_mg) a, typeof(purity_deduction_mg) b,
                typeof(fine_weight_mg) c, typeof(line_amount_paisa) d,
                gross_weight_mg, purity_deduction_mg, line_amount_paisa
           FROM retail_sale_items`,
      )
      .all() as Array<Record<string, string | number>>
    expect(stored).toHaveLength(1)
    for (const row of stored) {
      expect([row['a'], row['b'], row['c'], row['d']]).toEqual([
        'integer',
        'integer',
        'integer',
        'integer',
      ])
      // 2.000 tola is 23,328 mg and 0.090 tola is 1,050 mg — exact integers.
      expect(row['gross_weight_mg']).toBe(23_328)
      expect(row['purity_deduction_mg']).toBe(1_050)
      expect(Number.isInteger(row['line_amount_paisa'])).toBe(true)
    }

    closeDatabase(db)
  })
})

/**
 * The bill in progress, and the reason it is on disk at all.
 *
 * "Discard the in-memory state entirely" is taken literally: the connection is
 * closed and a NEW one is opened onto the same file, so nothing survives except
 * what was actually written.
 */
describe('a draft survives a crash', () => {
  let file: string
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jewellery-draft-'))
    file = join(directory, 'shop.sqlite')
  })

  afterEach(() => {
    // Best-effort: Windows will not unlink a file SQLite still holds open, and
    // a test that failed mid-way leaves the connection up. Swallowing this
    // keeps the REAL failure on screen instead of an EPERM on the temp dir.
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      /* the OS will clear its own temp directory */
    }
  })

  function open() {
    const db = openDatabase({ file })
    return { db, repos: createRepositories(db, clock) }
  }

  const DRAFT = (userId: string) => ({
    branchId: BRANCH,
    billDate: toIsoDate('2026-08-30'),
    billTime: '14:05',
    customerId: null,
    customerName: 'IMRAN SAHIB',
    customerMobile: '03001234567',
    salesmanId: null,
    ratePurity: 'K22',
    ratePerTolaOverride: '',
    weightUnit: 'tola',
    activeSlipNo: 2,
    // Mid-edit, deliberately: an unresolved edit blocks a save, so resuming
    // without it would leave a screen that refuses to save and cannot say why.
    editingSlipNo: 2,
    editingLineNo: 1,
    createdByUserId: userId,
    slips: [
      {
        slipNo: 1,
        slipLabel: 'Full Bill',
        draftKey: 'draft-slip-1',
        customerGold: { text: '1.000', exactMg: 11_664 },
        customerGoldPurity: 'K21',
        hallmarkCharges: '25000',
        otherCharges: '',
        discount: '150000',
        amountPaid: '400000',
        paymentMethod: 'cash',
        remarks: 'gift wrap',
        items: [
          {
            lineNo: 1,
            itemName: 'Ring',
            purity: 'K22',
            gross: { text: '2.000', exactMg: 23_328 },
            stone: { text: '', exactMg: null },
            purityDeduction: { text: '0.090', exactMg: 1_050 },
            wastagePercent: '14.00',
            labourCharges: '5000',
            labourMode: 'fixed',
            stoneCharges: '',
          },
          {
            lineNo: 2,
            itemName: 'Baliyoon',
            purity: 'K21',
            gross: { text: '2.000', exactMg: null },
            stone: { text: '0.100', exactMg: null },
            purityDeduction: { text: '0.090', exactMg: null },
            wastagePercent: '14.00',
            labourCharges: '',
            labourMode: 'per_tola',
            stoneCharges: '2500',
          },
        ],
      },
      {
        slipNo: 2,
        slipLabel: 'Gold Bangles',
        draftKey: 'draft-slip-2',
        customerGold: { text: '', exactMg: null },
        customerGoldPurity: null,
        hallmarkCharges: '',
        otherCharges: '',
        discount: '',
        amountPaid: '',
        paymentMethod: 'credit',
        remarks: null,
        items: [
          {
            lineNo: 1,
            // Half-typed on purpose: "2." is not a weight, and a draft that
            // parsed it to 0 would eat the operator's work at exactly the
            // moment this feature exists to protect it.
            itemName: 'Gold Chain',
            purity: 'K18',
            gross: { text: '2.', exactMg: null },
            stone: { text: '', exactMg: null },
            purityDeduction: { text: '', exactMg: null },
            wastagePercent: '',
            labourCharges: '',
            labourMode: 'fixed',
            stoneCharges: '',
          },
        ],
      },
    ],
  })

  it('comes back identical after the connection is thrown away', () => {
    const first = open()
    const userId = seedBranchAndUser(first.repos)
    const original = DRAFT(userId)
    first.repos.retailDrafts.save(original)
    closeDatabase(first.db)

    const second = open()
    const recovered = second.repos.retailDrafts.find(BRANCH)
    // Identical, not merely similar — including the half-typed "2." and every
    // exactMg the unit toggle had set.
    expect(recovered).toEqual(original)
    closeDatabase(second.db)
  })

  it('remembers which line was mid-edit', () => {
    const first = open()
    const userId = seedBranchAndUser(first.repos)
    first.repos.retailDrafts.save(DRAFT(userId))
    closeDatabase(first.db)

    const second = open()
    const recovered = second.repos.retailDrafts.find(BRANCH)
    expect(recovered?.editingSlipNo).toBe(2)
    expect(recovered?.editingLineNo).toBe(1)
    closeDatabase(second.db)
  })

  it('keeps one draft per branch — saving replaces, never accumulates', () => {
    const { db, repos } = open()
    const userId = seedBranchAndUser(repos)
    repos.retailDrafts.save(DRAFT(userId))
    repos.retailDrafts.save({
      ...DRAFT(userId),
      customerName: 'SECOND CUSTOMER',
      slips: [DRAFT(userId).slips[0]!],
    })

    const rows = db.prepare('SELECT COUNT(*) n FROM retail_draft_bills').get() as { n: number }
    expect(rows.n).toBe(1)
    const recovered = repos.retailDrafts.find(BRANCH)
    expect(recovered?.customerName).toBe('SECOND CUSTOMER')
    // The removed slip and its items went with it, rather than being orphaned.
    expect(recovered?.slips).toHaveLength(1)
    const items = db.prepare('SELECT COUNT(*) n FROM retail_draft_items').get() as { n: number }
    expect(items.n).toBe(2)
    closeDatabase(db)
  })

  it('is thrown away only on an explicit discard', () => {
    const { db, repos } = open()
    const userId = seedBranchAndUser(repos)
    repos.retailDrafts.save(DRAFT(userId))
    expect(repos.retailDrafts.find(BRANCH)).toBeTruthy()
    repos.retailDrafts.clear(BRANCH)
    expect(repos.retailDrafts.find(BRANCH)).toBeNull()
    closeDatabase(db)
  })
})
