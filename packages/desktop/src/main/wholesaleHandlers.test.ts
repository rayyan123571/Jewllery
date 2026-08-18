import { Katt, Money, Weight, fixedClock, toIsoDate, type PublicUser } from '@jewellery/domain'
import {
  FakeAuditRepository,
  FakeGoldRateRepository,
  FakePartyRepository,
  FakeSettingsRepository,
  FakeWholesaleRepository,
  RateService,
  Settings,
  WholesaleService,
} from '@jewellery/application'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  wholesaleLoadAsDraft,
  wholesaleNeighbours,
  wholesaleNextInvoiceNo,
  type WholesaleNavDeps,
} from './wholesaleHandlers.js'

/**
 * Walking the slip book, with no Electron and no window.
 *
 * This is why the bodies live in `wholesaleHandlers.ts` rather than inside
 * `ipcMain.handle` calls: every refusal below is a path the renderer can reach,
 * and a refusal only exercised by launching the app is one nobody finds out is
 * broken.
 *
 * What is checked is the BOUNDARY's contract, not the arithmetic — the pricing
 * is covered with no database at all in the domain and application suites:
 *
 *   1. no session, no answer — and the answer is four nulls, not a throw
 *   2. the ends of the book are ends: FIRST/LAST exist, PREV/NEXT go null
 *   3. a loaded slip comes back as the two figures that were TYPED, priced at
 *      the rate it was posted with rather than at today's
 */

const clock = fixedClock('2026-08-30T09:00:00.000Z')
const BRANCH = 'branch-1'

const admin: PublicUser = {
  id: 'user-1',
  branchId: BRANCH,
  name: 'Administrator',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

let deps: WholesaleNavDeps
let parties: FakePartyRepository
let entries: FakeWholesaleRepository
let rates: FakeGoldRateRepository
let partyId: string

function build(user: PublicUser | null): WholesaleNavDeps {
  const audit = new FakeAuditRepository(clock)
  parties = new FakePartyRepository(clock)
  entries = new FakeWholesaleRepository(clock)
  rates = new FakeGoldRateRepository(clock)
  const settings = new Settings(new FakeSettingsRepository())
  rates.seed(BRANCH, 'K22', 237_970, '2026-08-01')

  const party = parties.create({
    branchId: BRANCH,
    code: 'CHJ',
    name: 'CHAUDHARY JEWELLER',
    mobile: null,
    city: 'Lahore',
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
  })
  partyId = party.id

  return {
    branchId: BRANCH,
    wholesale: new WholesaleService({
      wholesale: entries,
      parties,
      audit,
      rates: new RateService({ goldRates: rates, audit, clock }),
      settings,
      clock,
    }),
    parties,
    settings,
    session: { user },
  }
}

/** Posts one slip and returns the number the screen would navigate by. */
function postSlip(
  on: WholesaleNavDeps,
  itemName: string,
  grams: string,
  katt: string,
): number {
  const posted = on.wholesale.postIssue(admin, {
    branchId: BRANCH,
    partyId,
    entryDate: toIsoDate('2026-08-30'),
    lines: [
      {
        itemName,
        gross: Weight.parse(grams),
        katt: Katt.parse(katt),
        remarks: null,
      },
    ],
    notes: null,
  })
  return posted.posted.entry.invoiceNumber
}

beforeEach(() => {
  deps = build(admin)
})

describe('the four navigation controls', () => {
  it('has nowhere to go while the book is empty', () => {
    expect(wholesaleNeighbours(deps, null, false)).toEqual({
      first: null,
      previous: null,
      next: null,
      last: null,
    })
  })

  it('answers with four nulls rather than throwing when nobody is signed in', () => {
    const anonymous = build(null)
    postSlip(deps, 'CHAIN', '100.000', '9.000')
    expect(wholesaleNeighbours(anonymous, null, false)).toEqual({
      first: null,
      previous: null,
      next: null,
      last: null,
    })
  })

  it('points PREV at the newest slip from a slip that has not been posted', () => {
    postSlip(deps, 'CHAIN', '100.000', '9.000')
    const second = postSlip(deps, 'RING', '20.000', '9.000')

    const where = wholesaleNeighbours(deps, null, false)
    expect(where.previous?.number).toBe(second)
    // One PAST the end of the book: there is nothing after a slip being typed.
    expect(where.next).toBeNull()
    expect(where.last?.number).toBe(second)
  })

  it('goes dead at the ends, and says so with a null rather than a wrong number', () => {
    const first = postSlip(deps, 'CHAIN', '100.000', '9.000')
    const middle = postSlip(deps, 'RING', '20.000', '9.000')
    const last = postSlip(deps, 'BANGLE', '47.240', '9.000')

    expect(wholesaleNeighbours(deps, first, false).previous).toBeNull()
    expect(wholesaleNeighbours(deps, first, false).next?.number).toBe(middle)
    expect(wholesaleNeighbours(deps, last, false).next).toBeNull()
    expect(wholesaleNeighbours(deps, middle, false)).toMatchObject({
      first: { number: first },
      previous: { number: first },
      next: { number: last },
      last: { number: last },
    })
  })

  it('preformats every number with the shop prefix, so the screen never builds one', () => {
    const only = postSlip(deps, 'CHAIN', '100.000', '9.000')
    expect(wholesaleNeighbours(deps, null, false).previous?.display).toBe(String(only))
  })

  /**
   * The gap a reversal leaves is the point.
   *
   * A reversed slip is never deleted and its number is never reused, so hiding
   * it leaves a visible hole in the numbering — which is what tells the operator
   * a slip was corrected rather than lost.
   */
  it('skips a reversed slip unless the operator asks to see them', () => {
    const first = postSlip(deps, 'CHAIN', '100.000', '9.000')
    const middle = postSlip(deps, 'RING', '20.000', '9.000')
    const last = postSlip(deps, 'BANGLE', '47.240', '9.000')

    const entry = entries.findByNumber(BRANCH, 'ISSUE', middle)
    deps.wholesale.reverse(admin, entry?.entry.id ?? '', 'Wrong party')

    expect(wholesaleNeighbours(deps, first, false).next?.number).toBe(last)
    expect(wholesaleNeighbours(deps, first, true).next?.number).toBe(middle)
  })

  /**
   * A reversal carries the NUMBER of the slip it reverses — it is the same
   * document being corrected. So the book holds two rows numbered 4, and if the
   * arrows counted rows rather than slips, NEXT would step onto the correction
   * instead of the fifth slip.
   */
  it('never mistakes a reversal row for a slip in the book', () => {
    const only = postSlip(deps, 'CHAIN', '100.000', '9.000')
    const entry = entries.findByNumber(BRANCH, 'ISSUE', only)
    deps.wholesale.reverse(admin, entry?.entry.id ?? '', 'Wrong party')

    // With reversed slips shown, the ORIGINAL is the only thing in the book —
    // the reversal is not a second one.
    const where = wholesaleNeighbours(deps, null, true)
    expect(where.first?.number).toBe(only)
    expect(where.last?.number).toBe(only)
  })
})

describe('a posted slip, read back in the shape the screen edits', () => {
  it('comes back as the two figures that were typed', () => {
    const number = postSlip(deps, 'GOLD CHAIN', '47.240', '9.000')

    const loaded = wholesaleLoadAsDraft(deps, number)
    expect(loaded?.invoiceNumber).toBe(number)
    expect(loaded?.invoiceNo).toBe(String(number))
    expect(loaded?.draft.lines).toEqual([
      {
        itemName: 'GOLD CHAIN',
        grossGrams: '47.240',
        kattRatti: '9.000',
        remarks: null,
        // Written by the fake at post time: a line that named no karat is
        // stored as the shop default it was actually priced at.
        purity: 'K22',
        male: null,
      },
    ])
  })

  it('names the party the slip was posted against', () => {
    const number = postSlip(deps, 'GOLD CHAIN', '47.240', '9.000')
    const loaded = wholesaleLoadAsDraft(deps, number)
    expect(loaded?.draft.partyId).toBe(partyId)
    expect(loaded?.draft.partyName).toBe('CHAUDHARY JEWELLER')
    expect(loaded?.draft.partyCode).toBe('CHJ')
  })

  /**
   * The one that matters most. Without the pinned rate a slip priced last week
   * reprices itself at today's rate the moment somebody opens it to look at, and
   * the screen then disagrees with the paper in the customer's hand.
   */
  it('pins the rate it was PRICED at, not the rate in force today', () => {
    const number = postSlip(deps, 'GOLD CHAIN', '47.240', '9.000')
    rates.seed(BRANCH, 'K22', 300_000, '2026-08-31')

    const loaded = wholesaleLoadAsDraft(deps, number)
    expect(loaded?.draft.ratePerTolaOverride).toBe('237,970.00')
    // And it survives the round trip: the pinned string is what the preview and
    // the post path parse, so it must be readable by Money.parse.
    expect(Money.parse(loaded?.draft.ratePerTolaOverride ?? '').paisa).toBe(23_797_000)
  })

  it('answers null for a number that is not a slip, rather than throwing', () => {
    expect(wholesaleLoadAsDraft(deps, 99_999)).toBeNull()
    expect(wholesaleLoadAsDraft(deps, 0)).toBeNull()
    expect(wholesaleLoadAsDraft(deps, -1)).toBeNull()
    expect(wholesaleLoadAsDraft(deps, 1.5)).toBeNull()
  })

  it('refuses to read anything back with nobody signed in', () => {
    const number = postSlip(deps, 'GOLD CHAIN', '47.240', '9.000')
    const anonymous = { ...deps, session: { user: null } }
    expect(wholesaleLoadAsDraft(anonymous, number)).toBeNull()
  })

  it('marks a reversed slip as reversed, and still shows it', () => {
    const number = postSlip(deps, 'GOLD CHAIN', '47.240', '9.000')
    const entry = entries.findByNumber(BRANCH, 'ISSUE', number)
    deps.wholesale.reverse(admin, entry?.entry.id ?? '', 'Wrong party')

    const loaded = wholesaleLoadAsDraft(deps, number)
    expect(loaded?.isReversed).toBe(true)
    expect(loaded?.draft.lines).toHaveLength(1)
  })
})

describe('the next slip number', () => {
  it('previews the next one without reserving it', () => {
    expect(wholesaleNextInvoiceNo(deps)).toBe('1')
    expect(wholesaleNextInvoiceNo(deps)).toBe('1')
    postSlip(deps, 'CHAIN', '100.000', '9.000')
    expect(wholesaleNextInvoiceNo(deps)).toBe('2')
  })
})
