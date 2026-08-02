import {
  Katt,
  Money,
  Weight,
  computeLine,
  fixedClock,
  toIsoDate,
  totalsOf,
  type WholesaleLineInput,
} from '@jewellery/domain'
import type { NewWholesaleEntry, Repositories } from '@jewellery/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type SqliteDatabase } from '../Database.js'
import { createRepositories } from './index.js'

/**
 * The real slip, posted through the real repository into a real database.
 *
 * lineMath.test.ts proves the arithmetic; this proves the arithmetic survives a
 * round trip through SQLite as integers, and that the party's balance comes out
 * of the entries rather than being stored anywhere.
 */

const clock = fixedClock('2026-08-30T09:00:00.000Z')
const BRANCH = 'branch-1'
const RATE = Money.parse('358000')

let db: SqliteDatabase
let repos: Repositories
let partyId = ''
let userId = ''

const SLIP: WholesaleLineInput[] = [
  { itemName: 'SINGAPORI CHAIN 15', gross: Weight.parse('254.200'), katt: Katt.parse('13'), ratePerTola: RATE, remarks: null },
  { itemName: 'JEWELRY', gross: Weight.parse('10.280'), katt: Katt.parse('13'), ratePerTola: RATE, remarks: null },
  { itemName: 'OS JEWELARY', gross: Weight.parse('7.030'), katt: Katt.parse('11.5'), ratePerTola: RATE, remarks: null },
]

function issueEntry(overrides: Partial<NewWholesaleEntry> = {}): NewWholesaleEntry {
  const computed = SLIP.map(computeLine)
  const totals = totalsOf(computed)
  return {
    branchId: BRANCH,
    partyId,
    kind: 'ISSUE',
    invoiceNo: repos.wholesale.nextInvoiceNo(BRANCH, 'WS-'),
    entryDate: toIsoDate('2026-08-30'),
    ratePerTola: RATE,
    totalGross: totals.grossTotal,
    totalKhalis: totals.khalisTotal,
    totalAmount: totals.amountTotal,
    settledGold: Weight.ZERO,
    settledCash: Money.ZERO,
    settledCashAsGold: Weight.ZERO,
    // An issue increases what the party owes.
    goldDelta: totals.khalisTotal,
    cashDelta: Money.ZERO,
    isOverReturn: false,
    confirmedByUserId: null,
    reversesEntryId: null,
    notes: null,
    createdByUserId: userId,
    lines: computed.map((line, index) => ({
      lineNo: index + 1,
      itemName: line.itemName,
      gross: line.gross,
      katt: line.katt,
      khalis: line.khalis,
      ratePerTola: line.ratePerTola,
      amount: line.amount,
      remarks: line.remarks,
    })),
    ...overrides,
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
  partyId = repos.parties.create({
    branchId: BRANCH,
    code: 'CHJ',
    name: 'CHAUDHARY JEWELLER',
    mobile: '03067380000',
    city: null,
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
  }).id
})

afterEach(() => db.close())

describe('posting the real slip', () => {
  it('round-trips every line exactly', () => {
    const posted = repos.wholesale.post(issueEntry())
    expect(posted.lines.map((l) => l.khalis.format())).toEqual([
      '219.777',
      '8.888',
      '6.188',
    ])
    expect(posted.lines.map((l) => l.katt.format())).toEqual([
      '13.000',
      '13.000',
      '11.500',
    ])
  })

  it('round-trips the bracketed totals', () => {
    const posted = repos.wholesale.post(issueEntry())
    expect(posted.entry.totalGross.format()).toBe('271.510')
    expect(posted.entry.totalKhalis.format()).toBe('234.853')
  })

  it('stores the rate on the transaction', () => {
    // Not looked up again at read time — history must not move when the rate
    // changes.
    const posted = repos.wholesale.post(issueEntry())
    expect(posted.entry.ratePerTola?.paisa).toBe(35_800_000)
  })

  it('stores katt as an integer, and every money and weight column too', () => {
    repos.wholesale.post(issueEntry())
    const types = db
      .prepare(
        `SELECT typeof(katt_milli_ratti) AS k, typeof(gross_mg) AS g,
                typeof(khalis_mg) AS kh, typeof(amount_paisa) AS a
           FROM wholesale_line_items LIMIT 1`,
      )
      .get() as Record<string, string>
    expect(Object.values(types)).toEqual(['integer', 'integer', 'integer', 'integer'])
  })

  it('writes the header and the lines atomically', () => {
    // A duplicate invoice number fails the unique index mid-transaction; the
    // lines from the failed attempt must not survive.
    const first = issueEntry()
    repos.wholesale.post(first)
    expect(() => repos.wholesale.post({ ...issueEntry(), invoiceNo: first.invoiceNo })).toThrow()

    const lineCount = db
      .prepare('SELECT COUNT(*) AS n FROM wholesale_line_items')
      .get() as { n: number }
    expect(lineCount.n).toBe(3)
  })

  it('numbers slips sequentially', () => {
    const a = repos.wholesale.post(issueEntry())
    const b = repos.wholesale.post(issueEntry())
    expect(a.entry.invoiceNo).toBe('WS-10001')
    expect(b.entry.invoiceNo).toBe('WS-10002')
  })

  it('finds a slip by its number', () => {
    const posted = repos.wholesale.post(issueEntry())
    const found = repos.wholesale.findByInvoiceNo(BRANCH, posted.entry.invoiceNo)
    expect(found?.entry.id).toBe(posted.entry.id)
    expect(found?.lines).toHaveLength(3)
  })
})

describe('balances come out of the entries', () => {
  it('is zero before anything is posted', () => {
    expect(repos.wholesale.balances(partyId)).toEqual({ goldMg: 0, cashPaisa: 0 })
  })

  it('an issue increases what the party owes', () => {
    repos.wholesale.post(issueEntry())
    expect(repos.wholesale.balances(partyId).goldMg).toBe(234_853)
  })

  it('a settlement reduces it', () => {
    repos.wholesale.post(issueEntry())
    repos.wholesale.post(
      issueEntry({
        kind: 'SETTLEMENT',
        invoiceNo: 'RT-10001',
        settledGold: Weight.parse('100'),
        settledCash: Money.ZERO,
        settledCashAsGold: Weight.ZERO,
        goldDelta: Weight.parse('-100'),
        lines: [],
      }),
    )
    expect(repos.wholesale.balances(partyId).goldMg).toBe(134_853)
  })

  it('a cash settlement reduces the GOLD balance, not a separate cash one', () => {
    // The shop's model (DECISIONS §10): cash handed over in place of gold is a
    // gold-debt transaction.
    repos.wholesale.post(issueEntry())
    const cash = Money.parse('1000000')
    const asGold = Weight.boughtByAtTolaRate(cash.paisa, RATE.paisa)
    repos.wholesale.post(
      issueEntry({
        kind: 'SETTLEMENT',
        invoiceNo: 'RT-10002',
        settledGold: Weight.ZERO,
        settledCash: cash,
        settledCashAsGold: asGold,
        goldDelta: asGold.negated(),
        cashDelta: Money.ZERO,
        lines: [],
      }),
    )
    const balances = repos.wholesale.balances(partyId)
    expect(balances.goldMg).toBe(234_853 - 32_581)
    // The cash ledger is untouched: this was not a cash credit.
    expect(balances.cashPaisa).toBe(0)
  })

  it('goes negative on overpayment rather than clamping', () => {
    repos.wholesale.post(
      issueEntry({
        kind: 'SETTLEMENT',
        settledGold: Weight.parse('300'),
        goldDelta: Weight.parse('-300'),
        lines: [],
      }),
    )
    expect(repos.wholesale.balances(partyId).goldMg).toBe(-300_000)
  })
})

describe('reversal, never edit', () => {
  it('offers no update or delete for a posted entry', () => {
    expect('update' in repos.wholesale).toBe(false)
    expect('delete' in repos.wholesale).toBe(false)
  })

  it('nets to zero when an entry is reversed', () => {
    const original = repos.wholesale.post(issueEntry())
    const reversal = repos.wholesale.post(
      issueEntry({
        invoiceNo: 'WS-REV-1',
        goldDelta: original.entry.totalKhalis.negated(),
        reversesEntryId: original.entry.id,
        lines: [],
      }),
    )
    repos.wholesale.markReversed(original.entry.id, reversal.entry.id)

    expect(repos.wholesale.balances(partyId).goldMg).toBe(0)
    // Both rows survive — the books show what happened AND what corrected it.
    expect(repos.wholesale.listForParty(partyId, 10)).toHaveLength(2)
    expect(repos.wholesale.findById(original.entry.id)?.entry.reversedByEntryId).toBe(
      reversal.entry.id,
    )
  })
})

describe('the party ledger ordering', () => {
  it('returns entries oldest first, so a running balance accumulates', () => {
    repos.wholesale.post(issueEntry({ entryDate: toIsoDate('2026-08-30') }))
    repos.wholesale.post(issueEntry({ entryDate: toIsoDate('2026-07-15') }))
    const dates = repos.wholesale.listForParty(partyId, 10).map((e) => e.entryDate)
    expect(dates).toEqual(['2026-07-15', '2026-08-30'])
  })
})
