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
      ratePerTola: line.ratePerTola,
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
    ratePerTola: computed.ratePerTola,
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
    const written = repos.retailSales.post(saleOf())
    expect(written.items).toHaveLength(1)
    expect(written.sale.invoiceNumber).toBe(1)
    expect(written.sale.invoiceNo).toBe('1')
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

    expect(() => repos.retailSales.post(broken)).toThrow()

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
    expect(() => repos.retailSales.post(broken)).toThrow()

    // The next real sale still gets the first number: a failed attempt is not
    // a document, so it must not consume one.
    const good = repos.retailSales.post(saleOf())
    expect(good.sale.invoiceNumber).toBe(1)
  })
})

describe('walking the book with FIRST / PREV / NEXT / LAST', () => {
  /** Posts `count` invoices and hands back their numbers, in order. */
  const postMany = (count: number): number[] =>
    Array.from({ length: count }, () => repos.retailSales.post(saleOf()).sale.invoiceNumber)

  const neighbours = (current: number | null, includeVoid = false) =>
    repos.retailSales.neighbours(BRANCH, current, includeVoid)

  it('steps one at a time, and stops at both ends without wrapping', () => {
    postMany(3)

    expect(neighbours(1)).toEqual({ first: 1, previous: null, next: 2, last: 3 })
    expect(neighbours(2)).toEqual({ first: 1, previous: 1, next: 3, last: 3 })
    // No wrap-around. Past the newest there is nothing, and the toolbar renders
    // NEXT and LAST disabled rather than looping back to the oldest bill.
    expect(neighbours(3)).toEqual({ first: 1, previous: 2, next: null, last: 3 })
  })

  it('orders by the integer, so 9 → 10 and not 9 → 1', () => {
    // The failure this exists to catch: as TEXT, '10' sorts before '9', so NEXT
    // from 9 would land on 11 and PREV from 10 would go to 1 — the operator
    // pressing ▶ once would open a bill five documents away.
    postMany(12)

    expect(neighbours(9).next).toBe(10)
    expect(neighbours(10).previous).toBe(9)
    expect(neighbours(null).previous).toBe(12)
    expect(neighbours(1).first).toBe(1)
    expect(neighbours(1).last).toBe(12)
  })

  it('skips a voided invoice, leaving its number as a visible gap', () => {
    const [, second] = postMany(3)
    repos.retailSales.markVoid(
      repos.retailSales.findByInvoiceNumber(second as number)!.sale.id,
      'entered twice',
      toIsoTimestamp(clock.now()),
    )

    // 1 → 3. Invoice 2 still exists and still owns its number; it is simply not
    // somewhere the arrows stop, so the gap in the numbering is what tells the
    // operator a bill was cancelled rather than lost.
    expect(neighbours(1).next).toBe(3)
    expect(neighbours(3).previous).toBe(1)
  })

  it('shows the voided invoice again when the operator asks for it', () => {
    const [, second] = postMany(3)
    repos.retailSales.markVoid(
      repos.retailSales.findByInvoiceNumber(second as number)!.sale.id,
      'entered twice',
      toIsoTimestamp(clock.now()),
    )

    expect(neighbours(1, true).next).toBe(2)
    expect(neighbours(2, true).next).toBe(3)
  })

  it('treats an unposted bill as one past the end of the book', () => {
    postMany(3)

    // null = the screen is holding a bill that has not been posted. PREV goes
    // back to the newest real invoice; NEXT has nowhere to go, because nothing
    // has been written after the thing being typed.
    expect(neighbours(null)).toEqual({ first: 1, previous: 3, next: null, last: 3 })
  })

  it('has nowhere to go at all in an empty book', () => {
    expect(neighbours(null)).toEqual({
      first: null,
      previous: null,
      next: null,
      last: null,
    })
  })

  it('never leaves the branch it was asked about', () => {
    postMany(2)
    expect(repos.retailSales.neighbours('another-branch', null, false)).toEqual({
      first: null,
      previous: null,
      next: null,
      last: null,
    })
  })
})

describe('the invoice sequence', () => {
  it('never issues the same number twice', () => {
    const numbers = Array.from(
      { length: 25 },
      () => repos.retailSales.post(saleOf()).sale.invoiceNumber,
    )
    expect(new Set(numbers).size).toBe(25)
    expect(numbers[0]).toBe(1)
    expect(numbers[24]).toBe(25)
  })

  it('burns the number of a voided sale — it is never reused', () => {
    const first = repos.retailSales.post(saleOf())
    repos.retailSales.markVoid(
      first.sale.id,
      'entered twice',
      toIsoTimestamp(clock.now()),
    )

    const second = repos.retailSales.post(saleOf())
    // A gap is auditable. A reused number is a second document claiming to be
    // the first, and the void row keeps its own number forever.
    expect(second.sale.invoiceNumber).toBe(2)
    expect(repos.retailSales.findById(first.sale.id)?.sale.invoiceNumber).toBe(1)
    expect(repos.retailSales.findById(first.sale.id)?.sale.status).toBe('void')
  })

  it('never reuses a burned number even after every sale is voided', () => {
    // The harder version of the rule. Voiding the WHOLE book does not put the
    // shop back at 1: the counter records what has been ISSUED, not what is
    // currently live, and three cancelled bills are still three numbers that
    // were printed and handed across the counter.
    const issued = Array.from({ length: 3 }, () => repos.retailSales.post(saleOf()))
    for (const sale of issued) {
      repos.retailSales.markVoid(sale.sale.id, 'cancelled', toIsoTimestamp(clock.now()))
    }

    const next = repos.retailSales.post(saleOf())
    expect(next.sale.invoiceNumber).toBe(4)
    expect(
      issued.map((sale) => repos.retailSales.findById(sale.sale.id)?.sale.invoiceNumber),
    ).toEqual([1, 2, 3])
  })

  it('sorts numerically, so 10 comes after 9 and not before it', () => {
    // The reason the integer column exists at all. As TEXT, '10' sorts before
    // '9' — which would put the tenth sale above the ninth in every report, and
    // the operator clicking the top row would open the wrong bill.
    for (let n = 0; n < 12; n += 1) repos.retailSales.post(saleOf())

    const byInteger = (
      db
        .prepare('SELECT invoice_number FROM retail_sales ORDER BY invoice_number')
        .all() as { invoice_number: number }[]
    ).map((row) => row.invoice_number)
    expect(byInteger).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    // The same rows ordered by the TEXT column, so the difference is shown to
    // be real rather than asserted: this is what a lexical sort would give.
    const byText = (
      db.prepare('SELECT invoice_no FROM retail_sales ORDER BY invoice_no').all() as {
        invoice_no: string
      }[]
    ).map((row) => row.invoice_no)
    expect(byText[1]).toBe('10')
    expect(byText).not.toEqual(byInteger.map(String))
  })

  it('refuses a duplicate invoice number at the database level', () => {
    repos.retailSales.post(saleOf())
    // Belt and braces: even if the sequence were bypassed, UNIQUE stops it.
    // Both columns are asserted, one at a time, because they are two separate
    // constraints — a change that dropped either would still pass the other.
    const insertWith = (id: string, invoiceNumber: number, invoiceNo: string) => () =>
      db
        .prepare(
          `INSERT INTO retail_sales
             (id, invoice_number, invoice_no, branch_id, sale_date, sale_time,
              customer_name_snapshot, rate_purity, rate_per_tola_paisa,
              gold_value_paisa, grand_total_paisa, payment_method,
              amount_in_words, status, created_by, created_at)
           VALUES (?,?,?,?, '2026-08-30','14:05','X','K22',1,1,1,'cash','x','posted',?, '2026-08-30')`,
        )
        .run(id, invoiceNumber, invoiceNo, BRANCH, userId)

    expect(insertWith('dup-int', 1, '999')).toThrow(/UNIQUE/i)
    expect(insertWith('dup-text', 999, '1')).toThrow(/UNIQUE/i)
  })

  it('previews the next number without reserving it', () => {
    expect(repos.retailSales.peekNextInvoiceNumber()).toBe(1)
    expect(repos.retailSales.peekNextInvoiceNumber()).toBe(1)
    // Peeking twice changed nothing; the first real save still takes 1.
    expect(repos.retailSales.post(saleOf()).sale.invoiceNumber).toBe(1)
  })

  it('stores no prefix, whatever the shop later chooses to display', () => {
    const written = repos.retailSales.post(saleOf())
    const row = db
      .prepare('SELECT invoice_no FROM retail_sales WHERE id = ?')
      .get(written.sale.id) as { invoice_no: string }
    expect(row.invoice_no).toBe('1')
    expect(row.invoice_no).not.toMatch(/[^0-9]/)

    const sequence = db
      .prepare("SELECT prefix FROM invoice_sequences WHERE key = 'retail'")
      .get() as { prefix: string }
    expect(sequence.prefix).toBe('')
  })

  it('never resets, so a number is unique on its own terms', () => {
    // The financial year is gone from the sequence entirely. One continuous
    // counter for the life of the shop means there is no reset, and therefore
    // no year boundary at which two sales could claim the same number — the
    // collision this test previously existed to catch cannot occur at all.
    const first = repos.retailSales.post(saleOf())
    const second = repos.retailSales.post(saleOf())
    expect(first.sale.invoiceNumber).toBe(1)
    expect(second.sale.invoiceNumber).toBe(2)
  })
})

describe('what a sale stores', () => {
  it('round-trips every figure as an exact integer', () => {
    const written = repos.retailSales.post(saleOf())
    const read = repos.retailSales.findById(written.sale.id)
    expect(read?.sale.grandTotal.paisa).toBe(written.sale.grandTotal.paisa)
    expect(read?.items[0]?.fineWeight.milligrams).toBe(written.items[0]?.fineWeight.milligrams)
    expect(read?.items[0]?.wastageBp).toBe(1400)
  })

  it('stores the wastage rule the sale was priced with', () => {
    const written = repos.retailSales.post(
      saleOf({ wastageDirection: 'subtract', wastageBasis: 'gross' }),
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
    )
    db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run('Someone Else', customer.id)

    // The paper in the customer's hand says Ahmed Ali. So does the screen.
    expect(repos.retailSales.findById(written.sale.id)?.sale.customerNameSnapshot).toBe(
      'Ahmed Ali',
    )
  })

  it('finds a sale by its invoice number', () => {
    const written = repos.retailSales.post(saleOf())
    expect(repos.retailSales.findByInvoiceNumber(1)?.sale.id).toBe(written.sale.id)
  })

  it('lists by date, customer and status', () => {
    repos.retailSales.post(saleOf())
    repos.retailSales.post(saleOf({ status: 'held' }))
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
    )

    expect(written.bill.billNo).toBe('RB-00001')
    expect(written.slips.map((s) => s.sale.invoiceNumber)).toEqual([1, 2, 3])
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

    expect(() => repos.retailBills.postBill(broken, 'RB-')).toThrow(/CHECK|constraint/i)

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
    expect(() => repos.retailBills.postBill(broken, 'RB-')).toThrow()

    // The bump rolled back with everything else, so the next real sale takes
    // the first number rather than leaving a gap nothing accounts for.
    expect(repos.retailSales.post(saleOf()).sale.invoiceNumber).toBe(1)
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
      ),
    ).toThrow(/UNIQUE/i)
  })

  it('leaves a sale with no bill alone — a single-slip sale is a whole sale', () => {
    const solo = repos.retailSales.post(saleOf())
    expect(solo.sale.invoiceNumber).toBe(1)
    // Two of them, to prove the partial unique index tolerates many NULLs.
    const second = repos.retailSales.post(saleOf())
    expect(second.sale.invoiceNumber).toBe(2)
    expect(count('retail_bills')).toBe(0)
  })

  it('keeps bill numbers on their own sequence, not the invoice one', () => {
    repos.retailSales.post(saleOf())
    repos.retailSales.post(saleOf())
    const written = repos.retailBills.postBill(
      billOf([{ slipNo: 1, slipLabel: 'Full Bill' }]),
      'RB-',
    )
    // Two standalone sales spent invoices 1 and 2; the bill is still the FIRST
    // bill, and its slip takes the third invoice number. Bill numbers keep
    // their prefix on purpose — a bill and a slip must not look alike.
    expect(written.bill.billNo).toBe('RB-00001')
    expect(written.slips[0]?.sale.invoiceNumber).toBe(3)
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
    expect(read.slips.map((s) => s.sale.invoiceNumber)).toEqual([1, 2])

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
    ratePurity: 'K22',
    ratePerTolaOverride: '',
    weightUnit: 'tola',
    activeSlipNo: 2,
    // Mid-edit, deliberately: an unresolved edit blocks a save, so resuming
    // without it would leave a screen that refuses to save and cannot say why.
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
            ratePerTola: '',
            remarks: '',
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
            ratePerTola: '',
            // The shop's own per-item note. Optional going in, always present
            // coming back — the column exists on the row either way.
            remarks: 'stone loose',
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
            ratePerTola: '',
            // Left blank here, so the round trip proves an untouched note
            // survives as '' rather than coming back as null.
            remarks: '',
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
