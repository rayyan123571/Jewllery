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
      purity: line.purity ?? 'K22',
      male: line.male ?? null,
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
  }, userId).id
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
    // A row that fails mid-transaction — here a line priced at nothing, refused
    // by the rate CHECK — must take its lines with it.
    repos.wholesale.post(issueEntry())
    expect(() =>
      repos.wholesale.post(
        issueEntry({
          lines: [
            {
              lineNo: 1,
              itemName: 'BAD',
              gross: Weight.parse('1'),
              katt: Katt.parse('13'),
              khalis: Weight.parse('1'),
              ratePerTola: Money.ZERO,
              amount: Money.ZERO,
              remarks: null,
              purity: 'K22',
              male: null,
            },
          ],
        }),
      ),
    ).toThrow()

    const lineCount = db
      .prepare('SELECT COUNT(*) AS n FROM wholesale_line_items')
      .get() as { n: number }
    expect(lineCount.n).toBe(3)
  })

  it('numbers slips from 1, in its own book', () => {
    const a = repos.wholesale.post(issueEntry())
    const b = repos.wholesale.post(issueEntry())
    expect(a.entry.invoiceNumber).toBe(1)
    expect(b.entry.invoiceNumber).toBe(2)
  })

  /**
   * Two books, and both hold a slip 1.
   *
   * An issue and a settlement are different documents; sharing one counter
   * would leave both books full of the gaps the other one took.
   */
  it('numbers settlements from their own 1', () => {
    repos.wholesale.post(issueEntry())
    const settlement = repos.wholesale.post(
      issueEntry({
        kind: 'SETTLEMENT',
        settledGold: Weight.parse('100'),
        goldDelta: Weight.parse('-100'),
        lines: [],
      }),
    )
    expect(settlement.entry.invoiceNumber).toBe(1)
    expect(repos.wholesale.peekNextNumber('ISSUE')).toBe(2)
    expect(repos.wholesale.peekNextNumber('SETTLEMENT')).toBe(2)
  })

  it('finds a slip by its number, in the book it belongs to', () => {
    const posted = repos.wholesale.post(issueEntry())
    const found = repos.wholesale.findByNumber(BRANCH, 'ISSUE', posted.entry.invoiceNumber)
    expect(found?.entry.id).toBe(posted.entry.id)
    expect(found?.lines).toHaveLength(3)
    // The settlement book has no slip 1 yet, and answering with the issue would
    // put the wrong document on screen.
    expect(repos.wholesale.findByNumber(BRANCH, 'SETTLEMENT', 1)).toBeNull()
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

/**
 * Walking the book, in SQL.
 *
 * The number lives in the table as TEXT — "WS-10001" — and everything that
 * navigates uses the integer at the end of it. That conversion happens in a
 * `CAST(SUBSTR(...))`, which is exactly the sort of expression that is right in
 * the four cases somebody thought of and wrong in the fifth. So the fifth cases
 * are here: the ends, a reversal, and the numbers where text ordering and
 * numeric ordering disagree.
 */
describe('where the four navigation controls can go', () => {
  it('has nowhere to go while the book is empty', () => {
    expect(repos.wholesale.neighbours(BRANCH, null, false)).toEqual({
      first: null,
      previous: null,
      next: null,
      last: null,
    })
  })

  it('puts a slip that has not been posted one PAST the end of the book', () => {
    repos.wholesale.post(issueEntry())
    repos.wholesale.post(issueEntry())

    const where = repos.wholesale.neighbours(BRANCH, null, false)
    expect(where.previous).toBe(2)
    expect(where.next).toBeNull()
    expect(where.last).toBe(2)
  })

  it('goes dead at the ends rather than wrapping round', () => {
    repos.wholesale.post(issueEntry())
    repos.wholesale.post(issueEntry())
    repos.wholesale.post(issueEntry())

    expect(repos.wholesale.neighbours(BRANCH, 1, false)).toEqual({
      first: 1,
      previous: null,
      next: 2,
      last: 3,
    })
    expect(repos.wholesale.neighbours(BRANCH, 3, false)).toEqual({
      first: 1,
      previous: 2,
      next: null,
      last: 3,
    })
  })

  /**
   * Nine, ten, eleven — the boundary where a TEXT column used to go wrong.
   *
   * As text, '10' sorts before '9', so NEXT from the ninth slip would land on
   * the tenth only by accident and PREV from the tenth would go somewhere else
   * entirely. The column is an INTEGER now, and this walks that boundary to
   * prove it stayed one.
   */
  it('steps in numeric order across the two-digit boundary', () => {
    for (let i = 0; i < 11; i++) repos.wholesale.post(issueEntry())

    expect(repos.wholesale.neighbours(BRANCH, 9, false).next).toBe(10)
    expect(repos.wholesale.neighbours(BRANCH, 10, false).previous).toBe(9)
    expect(repos.wholesale.neighbours(BRANCH, 10, false).next).toBe(11)
    expect(repos.wholesale.neighbours(BRANCH, null, false).last).toBe(11)
  })

  it('skips a reversed slip unless asked, leaving a visible gap in the numbers', () => {
    repos.wholesale.post(issueEntry())
    const middle = repos.wholesale.post(issueEntry())
    repos.wholesale.post(issueEntry())
    const reversal = repos.wholesale.post(
      issueEntry({
        goldDelta: middle.entry.totalKhalis.negated(),
        reversesEntryId: middle.entry.id,
        lines: [],
      }),
    )
    repos.wholesale.markReversed(middle.entry.id, reversal.entry.id)

    expect(repos.wholesale.neighbours(BRANCH, 1, false).next).toBe(3)
    expect(repos.wholesale.neighbours(BRANCH, 1, true).next).toBe(2)
  })

  /**
   * The `-REV` row carries its original's number with a suffix glued on, so a
   * naive CAST reads it as a SECOND slip claiming to be WS-10002 — and the book
   * then has a duplicate the arrows can step onto.
   */
  it('never reads a reversal row as a slip of its own', () => {
    const original = repos.wholesale.post(issueEntry())
    repos.wholesale.post(
      issueEntry({
        goldDelta: original.entry.totalKhalis.negated(),
        reversesEntryId: original.entry.id,
        lines: [],
      }),
    )

    // The original is the only thing in the book, whichever way it is asked.
    expect(repos.wholesale.neighbours(BRANCH, null, true)).toMatchObject({
      first: 1,
      last: 1,
    })
    expect(repos.wholesale.neighbours(BRANCH, 1, true).next).toBeNull()
  })

  /**
   * A settlement is numbered from its own sequence (RT-). It is a real entry on
   * the party's ledger and it is deliberately NOT in the book these arrows walk:
   * this screen edits issues, and stepping onto a settlement would put a slip on
   * screen the grid cannot represent.
   */
  it('walks the issue book only, leaving settlements to the ledger', () => {
    repos.wholesale.post(issueEntry())
    repos.wholesale.post(
      issueEntry({
        kind: 'SETTLEMENT',
        goldDelta: Weight.ZERO,
        lines: [],
      }),
    )

    expect(repos.wholesale.neighbours(BRANCH, null, false)).toMatchObject({
      first: 1,
      last: 1,
    })
  })

  it('finds a slip by the integer the screen navigates with', () => {
    const posted = repos.wholesale.post(issueEntry())
    const found = repos.wholesale.findByNumber(BRANCH, 'ISSUE', 1)
    expect(found?.entry.id).toBe(posted.entry.id)
    expect(found?.lines).toHaveLength(SLIP.length)
    expect(repos.wholesale.findByNumber(BRANCH, 'ISSUE', 99_999)).toBeNull()
  })

  /** A branch with no slips has an empty book, not the other branch's. */
  it('answers for the branch it was asked about', () => {
    repos.wholesale.post(issueEntry())
    expect(repos.wholesale.neighbours('branch-2', null, false)).toEqual({
      first: null,
      previous: null,
      next: null,
      last: null,
    })
  })
})
