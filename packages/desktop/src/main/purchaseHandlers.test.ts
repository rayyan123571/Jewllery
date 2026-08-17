import { Money, Weight, fixedClock, type PublicUser } from '@jewellery/domain'
import {
  FakeAuditRepository,
  FakeGoldRateRepository,
  FakePartyRepository,
  FakePurchaseRepository,
  FakeSettingsRepository,
  FakeStockLedgerRepository,
  PurchaseService,
  RateService,
  Settings,
  StockService,
} from '@jewellery/application'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  purchaseLoadAsDraft,
  purchaseNeighbours,
  purchaseNextInvoiceNo,
  purchasePreview,
  purchaseSave,
  type PurchaseHandlerDeps,
} from './purchaseHandlers.js'
import { stockAdjust, stockLedger, stockSummary, type StockHandlerDeps } from './stockHandlers.js'

/**
 * The purchase boundary, with no Electron and no window.
 *
 * The arithmetic itself is proved in the domain suite (the lab figure: 5.425 g
 * at katt 19.59 → 4.318 g) and the atomicity in the persistence suite. What is
 * checked here is the boundary's contract:
 *
 *   1. the preview shows exactly what the save will store — the module's
 *      acceptance figures, preformatted
 *   2. HOLD writes nothing to stock; only POSTED does
 *   3. a loaded purchase comes back as the TYPED figures, priced at the rate
 *      it was saved with, and a later rate does not move a single digit
 *   4. cancelling reverses the stock and the summary returns to its old values
 *   5. the ledger's running khalis equals the summary total
 */

const clock = fixedClock('2026-08-15T09:00:00.000Z')
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

let deps: PurchaseHandlerDeps
let stockDeps: StockHandlerDeps
let purchases: FakePurchaseRepository
let stock: FakeStockLedgerRepository
let rates: FakeGoldRateRepository
let partyId: string

/** The reference purchase from the acceptance sheet, two lines. */
const REFERENCE_LINES = [
  {
    itemName: 'OLD BANGLES',
    grossGrams: '5.425',
    kattRatti: '19.59',
    rateRupees: '',
    bucket: 'SCRAP',
    remarks: null,
  },
  {
    itemName: 'OLD CHAIN',
    grossGrams: '11.381',
    kattRatti: '8.75',
    rateRupees: '',
    bucket: 'SCRAP',
    remarks: null,
  },
]

function referenceRequest() {
  return {
    partyId,
    entryDate: '2026-08-15',
    lines: REFERENCE_LINES,
    notes: null,
    heldId: null,
  }
}

function build(user: PublicUser | null): void {
  const audit = new FakeAuditRepository(clock)
  const parties = new FakePartyRepository(clock)
  stock = new FakeStockLedgerRepository(clock)
  purchases = new FakePurchaseRepository(clock, stock)
  rates = new FakeGoldRateRepository(clock)
  const settings = new Settings(new FakeSettingsRepository())
  const rateService = new RateService({ goldRates: rates, audit, clock })
  rates.seed(BRANCH, 'K24', 402_000, '2026-08-01')

  const party = parties.create({
    branchId: BRANCH,
    code: 'SELLER',
    name: 'WALK-IN SELLER',
    mobile: null,
    city: null,
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
  })
  partyId = party.id

  const session = { user }
  deps = {
    branchId: BRANCH,
    purchase: new PurchaseService({
      purchases,
      parties,
      audit,
      rates: rateService,
      settings,
      clock,
    }),
    parties,
    settings,
    session,
  }
  stockDeps = {
    branchId: BRANCH,
    stock: new StockService({ stockLedger: stock, audit, rates: rateService, clock }),
    purchases,
    settings,
    session,
  }
}

function summaryKhalis(): string {
  return stockSummary(stockDeps).totalKhalisDisplay
}

beforeEach(() => {
  build(admin)
})

describe('the live preview — what the grid computes', () => {
  it('reproduces the acceptance figures to the milligram', () => {
    const preview = purchasePreview(deps, referenceRequest())
    // 5425 × (96000 − 19590) / 96000 = 4317.96… → 4.318 (the lab figure), and
    // 11381 × (96000 − 8750) / 96000 = 10343.67… → 10.344.
    expect(preview.lines.map((l) => l.khalisDisplay)).toEqual(['4.318', '10.344'])
    expect(preview.grossTotalDisplay).toBe('16.806')
    expect(preview.khalisTotalDisplay).toBe('14.662')
  })

  it('defaults every line to the header rate, and lets one line override it', () => {
    const preview = purchasePreview(deps, {
      ...referenceRequest(),
      lines: [
        REFERENCE_LINES[0]!,
        { ...REFERENCE_LINES[1]!, rateRupees: '400000' },
      ],
    })
    expect(preview.lines[0]?.rateDisplay).toBe('402,000')
    expect(preview.lines[1]?.rateDisplay).toBe('400,000')
  })

  it('reports a half-typed row as its own error, not a failed preview', () => {
    const preview = purchasePreview(deps, {
      ...referenceRequest(),
      lines: [REFERENCE_LINES[0]!, { ...REFERENCE_LINES[1]!, grossGrams: '1.2.3' }],
    })
    expect(preview.lines[0]?.error).toBeNull()
    expect(preview.lines[1]?.error).toBeTruthy()
    // The broken row contributes nothing; the good one still totals.
    expect(preview.grossTotalDisplay).toBe('5.425')
  })
})

describe('posting and holding', () => {
  it('posting moves stock by exactly the purchase', () => {
    expect(summaryKhalis()).toBe('0.000')
    const result = purchaseSave(deps, referenceRequest(), 'posted')
    expect(result.ok).toBe(true)
    expect(summaryKhalis()).toBe('14.662')
    expect(stockSummary(stockDeps).buckets.find((b) => b.bucket === 'SCRAP')?.grossDisplay).toBe(
      '16.806',
    )
  })

  it('HOLD takes a number and writes NO stock — a held purchase has not happened', () => {
    const result = purchaseSave(deps, referenceRequest(), 'held')
    expect(result.ok).toBe(true)
    expect(summaryKhalis()).toBe('0.000')
    expect(stockLedger(stockDeps, {})).toHaveLength(0)
  })

  it('posting a held purchase keeps its number and only then moves stock', () => {
    const held = purchaseSave(deps, referenceRequest(), 'held')
    if (!held.ok) throw new Error('hold refused')
    const loaded = purchaseLoadAsDraft(deps, 1)
    expect(loaded?.status).toBe('held')

    const posted = purchaseSave(
      deps,
      { ...referenceRequest(), heldId: loaded?.entryId ?? null },
      'posted',
    )
    if (!posted.ok) throw new Error('post refused')
    expect(posted.invoiceNo).toBe(held.invoiceNo)
    expect(summaryKhalis()).toBe('14.662')
  })

  it('refuses with a message, not a throw, when nobody is signed in', () => {
    build(null)
    const result = purchaseSave(deps, referenceRequest(), 'posted')
    expect(result.ok).toBe(false)
  })
})

describe('a saved purchase, read back in the shape the screen edits', () => {
  it('comes back as the TYPED figures — gross, katt, per-line rate, bucket', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    const loaded = purchaseLoadAsDraft(deps, 1)
    expect(loaded?.draft.lines).toEqual([
      {
        itemName: 'OLD BANGLES',
        grossGrams: '5.425',
        kattRatti: '19.590',
        rateRupees: '402,000.00',
        bucket: 'SCRAP',
        remarks: null,
      },
      {
        itemName: 'OLD CHAIN',
        grossGrams: '11.381',
        kattRatti: '8.750',
        rateRupees: '402,000.00',
        bucket: 'SCRAP',
        remarks: null,
      },
    ])
  })

  /**
   * The snapshot test — the one that matters most. If this fails, tomorrow's
   * rate silently rewrites yesterday's invoice and the customer's printed slip
   * stops matching the screen.
   */
  it('does not move a single digit when today\'s rate changes', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    const before = purchaseLoadAsDraft(deps, 1)
    const previewBefore = purchasePreview(deps, {
      partyId,
      entryDate: before?.draft.entryDate ?? '2026-08-15',
      lines: before?.draft.lines ?? [],
      ratePerTolaOverride: before?.draft.ratePerTolaOverride ?? '',
      notes: null,
      heldId: null,
    })

    // The rate doubles. Nothing about the stored purchase may move.
    rates.seed(BRANCH, 'K24', 804_000, '2026-08-15')

    const after = purchaseLoadAsDraft(deps, 1)
    expect(after?.draft.ratePerTolaOverride).toBe(before?.draft.ratePerTolaOverride)
    expect(after?.draft.lines).toEqual(before?.draft.lines)

    const previewAfter = purchasePreview(deps, {
      partyId,
      entryDate: after?.draft.entryDate ?? '2026-08-15',
      lines: after?.draft.lines ?? [],
      ratePerTolaOverride: after?.draft.ratePerTolaOverride ?? '',
      notes: null,
      heldId: null,
    })
    expect(previewAfter.amountTotalDisplay).toBe(previewBefore.amountTotalDisplay)
    expect(previewAfter.lines.map((l) => l.amountDisplay)).toEqual(
      previewBefore.lines.map((l) => l.amountDisplay),
    )
  })

  it('verifies the stored figures against their own arithmetic, quietly when they agree', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    expect(purchaseLoadAsDraft(deps, 1)?.figuresWarning).toBeNull()
  })

  it('answers null for a number that is not a purchase, rather than throwing', () => {
    expect(purchaseLoadAsDraft(deps, 99_999)).toBeNull()
    expect(purchaseLoadAsDraft(deps, 0)).toBeNull()
  })
})

describe('cancelling', () => {
  it('returns the summary to its previous values and keeps every original row', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    expect(summaryKhalis()).toBe('14.662')
    const loaded = purchaseLoadAsDraft(deps, 1)

    deps.purchase.cancel(admin, loaded?.entryId ?? '', 'Seller returned, deal off')

    expect(summaryKhalis()).toBe('0.000')
    // Four rows: two in, two reversing. Nothing deleted.
    expect(stockLedger(stockDeps, {})).toHaveLength(4)
    expect(purchaseLoadAsDraft(deps, 1)?.status).toBe('cancelled')
  })

  it('skips a cancelled purchase in the book unless asked for — the gap shows', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    purchaseSave(deps, referenceRequest(), 'posted')
    const first = purchaseLoadAsDraft(deps, 1)
    deps.purchase.cancel(admin, first?.entryId ?? '', 'gone')

    expect(purchaseNeighbours(deps, null, false).first?.number).toBe(2)
    expect(purchaseNeighbours(deps, null, true).first?.number).toBe(1)
  })
})

describe('the stock ledger boundary', () => {
  it('carries running balances whose newest row equals the summary total', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    stockAdjust(stockDeps, {
      bucket: 'SCRAP',
      direction: 'remove',
      grossGrams: '0.100',
      kattRatti: '',
      itemName: null,
      reason: 'Filings lost in handling',
    })

    const rows = stockLedger(stockDeps, {})
    expect(rows).toHaveLength(3)
    // Newest first; its running khalis is the summary's total.
    expect(rows[0]?.runningKhalisDisplay).toBe(summaryKhalis())
  })

  it('shows an out movement as a magnitude with a direction, never a minus sign', () => {
    stockAdjust(stockDeps, {
      bucket: 'FINISHED',
      direction: 'remove',
      grossGrams: '5.000',
      kattRatti: '',
      itemName: 'SOLD WHILE BEING MADE',
      reason: 'Sold before the books had it',
    })
    const row = stockLedger(stockDeps, {})[0]
    expect(row?.direction).toBe('out')
    expect(row?.grossDisplay).toBe('5.000')
    expect(row?.runningIsNegative).toBe(true)
    expect(row?.runningGrossDisplay).toBe('5.000')

    const summary = stockSummary(stockDeps)
    expect(summary.negativeBuckets).toEqual(['FINISHED'])
    const finished = summary.buckets.find((b) => b.bucket === 'FINISHED')
    expect(finished?.isNegative).toBe(true)
    expect(finished?.grossDisplay).toBe('5.000')
  })

  it('refuses an adjustment without a reason', () => {
    const result = stockAdjust(stockDeps, {
      bucket: 'SCRAP',
      direction: 'add',
      grossGrams: '1.000',
      kattRatti: '',
      itemName: null,
      reason: '   ',
    })
    expect(result.ok).toBe(false)
  })

  it('names the purchase a movement came from, so the screen can open it', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    const rows = stockLedger(stockDeps, {})
    expect(rows.every((row) => row.refInvoiceNumber === 1)).toBe(true)
    expect(rows.every((row) => row.refDisplay === '1')).toBe(true)
  })

  it('states the rate and the moment its valuation is true for', () => {
    purchaseSave(deps, referenceRequest(), 'posted')
    const summary = stockSummary(stockDeps)
    // 14 662 mg at Rs 402,000/tola: 14662 × 40 200 000 / 11 664 = 50 532 613
    // paisa, rounded once — Rs 505,326 whole.
    expect(summary.valuationDisplay).toBe('Rs 505,326')
    expect(summary.valuationRateDisplay).toBe('Rs 402,000 / tola (24K)')
    expect(summary.valuationAtDisplay).toBe('2026-08-15 09:00')
  })
})

describe('the next purchase number', () => {
  it('previews without reserving', () => {
    expect(purchaseNextInvoiceNo(deps)).toBe('1')
    expect(purchaseNextInvoiceNo(deps)).toBe('1')
    purchaseSave(deps, referenceRequest(), 'posted')
    expect(purchaseNextInvoiceNo(deps)).toBe('2')
  })
})
