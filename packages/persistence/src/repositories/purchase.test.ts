import {
  Katt,
  Money,
  Weight,
  computePurchaseLine,
  fixedClock,
  toIsoDate,
  totalsOfPurchase,
  type PurchaseLineInput,
} from '@jewellery/domain'
import type { NewPurchaseEntry, Repositories } from '@jewellery/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type SqliteDatabase } from '../Database.js'
import { createRepositories } from './index.js'

/**
 * The reference purchase, posted through the real repository into a real
 * database.
 *
 * The two lines are the module's acceptance figures: 5.425 g at katt 19.59 must
 * come out at khalis 4.318 g (the gold-testing lab's number), and 11.381 g at
 * katt 8.75 at 10.344 g — all integer milligrams, no float anywhere in the path.
 * Beyond the arithmetic, this file proves the ledger rules: posting writes the
 * stock rows atomically, holding writes none, cancelling reverses without
 * deleting, and the running balance always equals the summary.
 */

const clock = fixedClock('2026-08-15T09:00:00.000Z')
const BRANCH = 'branch-1'
const RATE = Money.parse('402000')

let db: SqliteDatabase
let repos: Repositories
let partyId = ''
let userId = ''

const LINES: PurchaseLineInput[] = [
  {
    itemName: 'OLD BANGLES',
    gross: Weight.parse('5.425'),
    katt: Katt.parse('19.59'),
    ratePerTola: RATE,
    bucket: 'SCRAP',
    remarks: null,
  },
  {
    itemName: 'OLD CHAIN',
    gross: Weight.parse('11.381'),
    katt: Katt.parse('8.75'),
    ratePerTola: RATE,
    bucket: 'SCRAP',
    remarks: null,
  },
]

function purchaseOf(overrides: Partial<NewPurchaseEntry> = {}): NewPurchaseEntry {
  const computed = LINES.map(computePurchaseLine)
  const totals = totalsOfPurchase(computed)
  return {
    branchId: BRANCH,
    partyId,
    entryDate: toIsoDate('2026-08-15'),
    status: 'posted',
    ratePerTola: RATE,
    totalGross: totals.grossTotal,
    totalKhalis: totals.khalisTotal,
    totalAmount: totals.amountTotal,
    notes: null,
    createdByUserId: userId,
    heldId: null,
    lines: computed.map((line, index) => ({
      lineNo: index + 1,
      itemName: line.itemName,
      gross: line.gross,
      katt: line.katt,
      khalis: line.khalis,
      ratePerTola: line.ratePerTola,
      amount: line.amount,
      bucket: line.bucket,
      remarks: line.remarks,
    })),
    ...overrides,
  }
}

function stockSummary(): { grossMg: number; khalisMg: number } {
  const totals = repos.stockLedger.summary(BRANCH)
  return {
    grossMg: totals.reduce((sum, b) => sum + b.gross.milligrams, 0),
    khalisMg: totals.reduce((sum, b) => sum + b.khalis.milligrams, 0),
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
    passwordHash: 'scrypt$16$1$1$c2FsdA==$aGFzaA==',
    role: 'ADMIN',
    mustChangePassword: false,
  }).id
  partyId = repos.parties.create(
    {
      branchId: BRANCH,
      code: 'SELLER',
      name: 'WALK-IN SELLER',
      mobile: null,
      city: null,
      openingGold: Weight.ZERO,
      openingCash: Money.ZERO,
      notes: null,
    },
    userId,
  ).id
})

afterEach(() => db.close())

describe('posting the reference purchase', () => {
  it('reproduces the lab figures: 4.318 g and 10.344 g khalis', () => {
    const posted = repos.purchases.post(purchaseOf())
    expect(posted.lines.map((l) => l.khalis.format())).toEqual(['4.318', '10.344'])
  })

  it('round-trips the totals: 16.806 g gross, 14.662 g khalis', () => {
    const posted = repos.purchases.post(purchaseOf())
    expect(posted.entry.totalGross.format()).toBe('16.806')
    expect(posted.entry.totalKhalis.format()).toBe('14.662')
  })

  it('stores weights as integers with no float in the path', () => {
    repos.purchases.post(purchaseOf())
    const row = db
      .prepare(
        `SELECT typeof(gross_mg) AS g, typeof(khalis_mg) AS k,
                typeof(katt_milli_ratti) AS katt, typeof(amount_paisa) AS a
           FROM purchase_line_items LIMIT 1`,
      )
      .get() as Record<string, string>
    expect(Object.values(row)).toEqual(['integer', 'integer', 'integer', 'integer'])
  })

  it('raises stock by exactly the purchase, one movement per line', () => {
    repos.purchases.post(purchaseOf())
    const summary = stockSummary()
    expect(summary.grossMg).toBe(16_806)
    expect(summary.khalisMg).toBe(14_662)

    const movements = repos.stockLedger.list({ branchId: BRANCH })
    expect(movements).toHaveLength(2)
    expect(movements.map((m) => m.kind)).toEqual(['PURCHASE_IN', 'PURCHASE_IN'])
    expect(movements.map((m) => m.bucket)).toEqual(['SCRAP', 'SCRAP'])
  })

  it('snapshots katt and rate on every stock row', () => {
    const posted = repos.purchases.post(purchaseOf())
    const movements = repos.stockLedger.forRef('purchase', posted.entry.id)
    expect(movements.map((m) => m.katt?.format())).toEqual(['19.590', '8.750'])
    expect(movements.map((m) => m.ratePerTola?.paisa)).toEqual([RATE.paisa, RATE.paisa])
  })

  it('allocates numbers from its own book, inside the transaction', () => {
    expect(repos.purchases.peekNextNumber()).toBe(1)
    const first = repos.purchases.post(purchaseOf())
    const second = repos.purchases.post(purchaseOf())
    expect([first.entry.invoiceNumber, second.entry.invoiceNumber]).toEqual([1, 2])
    expect(repos.purchases.peekNextNumber()).toBe(3)
  })

  it('reads back the STORED figures, unchanged by a later rate', () => {
    const posted = repos.purchases.post(purchaseOf())
    // A new rate lands after the purchase. Nothing about the purchase moves.
    repos.goldRates.record({
      branchId: BRANCH,
      purity: 'K24',
      ratePerTola: Money.parse('999999'),
      effectiveFrom: toIsoDate('2026-08-15'),
      createdByUserId: userId,
      note: null,
    })
    const reread = repos.purchases.findById(posted.entry.id)
    expect(reread?.entry.ratePerTola.paisa).toBe(RATE.paisa)
    expect(reread?.entry.totalAmount.paisa).toBe(posted.entry.totalAmount.paisa)
    expect(reread?.lines.map((l) => l.amount.paisa)).toEqual(
      posted.lines.map((l) => l.amount.paisa),
    )
  })
})

describe('holding', () => {
  it('takes a number but writes NO stock — a held purchase has not happened', () => {
    const held = repos.purchases.post(purchaseOf({ status: 'held' }))
    expect(held.entry.status).toBe('held')
    expect(held.entry.invoiceNumber).toBe(1)
    expect(repos.stockLedger.list({ branchId: BRANCH })).toHaveLength(0)
  })

  it('posting a held purchase keeps its number, replaces its lines, moves stock', () => {
    const held = repos.purchases.post(purchaseOf({ status: 'held' }))
    // A second purchase takes number 2 while the first sits on hold.
    repos.purchases.post(purchaseOf())

    const posted = repos.purchases.post(purchaseOf({ heldId: held.entry.id }))
    expect(posted.entry.id).toBe(held.entry.id)
    expect(posted.entry.invoiceNumber).toBe(1)
    expect(posted.entry.status).toBe('posted')
    // Both purchases now count: 2 × 16.806 g.
    expect(stockSummary().grossMg).toBe(33_612)
  })

  it('refuses to save over a posted purchase', () => {
    const posted = repos.purchases.post(purchaseOf())
    expect(() => repos.purchases.post(purchaseOf({ heldId: posted.entry.id }))).toThrow(
      /not held/,
    )
  })
})

describe('cancelling', () => {
  it('writes reversing rows and returns the summary to its previous values', () => {
    const before = stockSummary()
    const posted = repos.purchases.post(purchaseOf())
    expect(stockSummary().grossMg).toBe(before.grossMg + 16_806)

    repos.purchases.cancel(posted.entry.id, 'Seller returned, deal off')

    const after = stockSummary()
    expect(after.grossMg).toBe(before.grossMg)
    expect(after.khalisMg).toBe(before.khalisMg)
  })

  it('keeps every original row — the pair nets to zero, nothing is deleted', () => {
    const posted = repos.purchases.post(purchaseOf())
    repos.purchases.cancel(posted.entry.id, 'Wrong party')

    const movements = repos.stockLedger.forRef('purchase', posted.entry.id)
    expect(movements).toHaveLength(4)
    const positives = movements.filter((m) => m.gross.isPositive)
    const negatives = movements.filter((m) => m.gross.isNegative)
    expect(positives).toHaveLength(2)
    expect(negatives).toHaveLength(2)
    expect(movements.reduce((sum, m) => sum + m.gross.milligrams, 0)).toBe(0)
    expect(movements.reduce((sum, m) => sum + m.khalis.milligrams, 0)).toBe(0)
  })

  it('keeps the purchase row and its number; only the status flips', () => {
    const posted = repos.purchases.post(purchaseOf())
    const cancelled = repos.purchases.cancel(posted.entry.id, 'Typo in the weights')
    expect(cancelled.entry.status).toBe('cancelled')
    expect(cancelled.entry.invoiceNumber).toBe(posted.entry.invoiceNumber)
    expect(cancelled.entry.cancelReason).toBe('Typo in the weights')
    expect(cancelled.lines).toHaveLength(2)
    // The next purchase takes a fresh number; the cancelled one stays burned.
    expect(repos.purchases.post(purchaseOf()).entry.invoiceNumber).toBe(2)
  })

  it('a cancelled HELD purchase writes no stock at all', () => {
    const held = repos.purchases.post(purchaseOf({ status: 'held' }))
    repos.purchases.cancel(held.entry.id, 'Never happened')
    expect(repos.stockLedger.list({ branchId: BRANCH })).toHaveLength(0)
  })
})

describe('the navigation book', () => {
  it('skips cancelled purchases unless asked, leaving the visible gap', () => {
    const one = repos.purchases.post(purchaseOf())
    repos.purchases.post(purchaseOf())
    const three = repos.purchases.post(purchaseOf())
    repos.purchases.cancel(one.entry.id, 'gone')

    expect(repos.purchases.neighbours(BRANCH, null, false)).toEqual({
      first: 2,
      previous: 3,
      next: null,
      last: 3,
    })
    expect(repos.purchases.neighbours(BRANCH, three.entry.invoiceNumber, true)).toEqual({
      first: 1,
      previous: 2,
      next: null,
      last: 3,
    })
  })

  it('finds a purchase by its printed number, cancelled included', () => {
    const posted = repos.purchases.post(purchaseOf())
    repos.purchases.cancel(posted.entry.id, 'gone')
    const found = repos.purchases.findByNumber(BRANCH, posted.entry.invoiceNumber)
    expect(found?.entry.id).toBe(posted.entry.id)
    expect(found?.entry.status).toBe('cancelled')
  })
})

describe('the stock ledger on its own', () => {
  it('appends adjustments and filters by bucket and kind', () => {
    repos.purchases.post(purchaseOf())
    repos.stockLedger.append({
      branchId: BRANCH,
      kind: 'ADJUSTMENT',
      bucket: 'FINISHED',
      gross: Weight.parse('2.000'),
      khalis: Weight.parse('1.900'),
      katt: null,
      ratePerTola: null,
      refType: null,
      refId: null,
      itemName: null,
      note: 'Physical count found two grams unbooked',
      createdByUserId: userId,
    })

    expect(repos.stockLedger.list({ branchId: BRANCH })).toHaveLength(3)
    expect(repos.stockLedger.list({ branchId: BRANCH, bucket: 'FINISHED' })).toHaveLength(1)
    expect(repos.stockLedger.list({ branchId: BRANCH, kind: 'ADJUSTMENT' })).toHaveLength(1)
  })

  it('lets a bucket go negative and says so in the sum — never a refusal', () => {
    repos.stockLedger.append({
      branchId: BRANCH,
      kind: 'SALE_OUT',
      bucket: 'FINISHED',
      gross: Weight.parse('5.000').negated(),
      khalis: Weight.parse('4.500').negated(),
      katt: null,
      ratePerTola: null,
      refType: null,
      refId: null,
      itemName: 'BESPOKE SET, STILL BEING MADE',
      note: null,
      createdByUserId: userId,
    })
    const finished = repos.stockLedger.summary(BRANCH).find((b) => b.bucket === 'FINISHED')
    expect(finished?.gross.isNegative).toBe(true)
    expect(finished?.gross.milligrams).toBe(-5_000)
  })

  it('running khalis over the whole ledger equals the summary total', () => {
    repos.purchases.post(purchaseOf())
    repos.purchases.post(purchaseOf({ status: 'held' }))
    repos.stockLedger.append({
      branchId: BRANCH,
      kind: 'ADJUSTMENT',
      bucket: 'SCRAP',
      gross: Weight.parse('0.100').negated(),
      khalis: Weight.parse('0.090').negated(),
      katt: null,
      ratePerTola: null,
      refType: null,
      refId: null,
      itemName: null,
      note: 'Filings lost in handling',
      createdByUserId: userId,
    })

    const running = repos.stockLedger
      .list({ branchId: BRANCH })
      .reduce((sum, m) => sum + m.khalis.milligrams, 0)
    expect(running).toBe(stockSummary().khalisMg)
  })
})
