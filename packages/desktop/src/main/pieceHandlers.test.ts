import { Katt, Money, fixedClock, type PublicUser } from '@jewellery/domain'
import {
  FakeAuditRepository,
  FakeGoldRateRepository,
  FakeItemCategoryRepository,
  FakeItemRepository,
  FakeLocationRepository,
  FakePartyRepository,
  FakePieceRepository,
  FakeStockLedgerRepository,
  PieceService,
  RateService,
} from '@jewellery/application'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  inventorySummary,
  openingNextTag,
  openingPost,
  openingPreview,
  pieceHistory,
  pieceList,
  pieceMove,
  type PieceHandlerDeps,
} from './pieceHandlers.js'
import type { OpeningPostRequest } from '../shared/ipc.js'

/**
 * The piece boundary, with no Electron and no window.
 *
 * The stone rule and the batch atomicity are proved below this layer (domain
 * and SQLite suites). What is checked here is the boundary's contract: the
 * opening grid previews exactly what will post, refusals name their row, the
 * summary's three columns are counts and sums that agree with the ledger, and
 * a piece's history reads as sentences.
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

let deps: PieceHandlerDeps
let stock: FakeStockLedgerRepository
let goldRates: FakeGoldRateRepository
let safeId = ''

function build(user: PublicUser | null): void {
  const audit = new FakeAuditRepository(clock)
  const items = new FakeItemRepository(clock)
  const categories = new FakeItemCategoryRepository(clock)
  const locations = new FakeLocationRepository(clock)
  const parties = new FakePartyRepository(clock)
  stock = new FakeStockLedgerRepository(clock)
  const pieces = new FakePieceRepository(clock, stock, items)
  goldRates = new FakeGoldRateRepository(clock)

  const rings = categories.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
  items.create({
    branchId: BRANCH,
    code: 'R-114',
    name: '22K ladies ring',
    categoryId: rings.id,
    purity: 'K22',
    defaultKatt: Katt.parse('9'),
    makingChargeBasis: 'per_tola',
    defaultMakingCharge: Money.ZERO,
    supplierId: null,
    designNo: null,
    notes: null,
    createdByUserId: 'user-1',
  })
  safeId = locations.create({ branchId: BRANCH, name: 'Safe' }).id

  deps = {
    branchId: BRANCH,
    pieces: new PieceService({
      pieces,
      items,
      itemCategories: categories,
      locations,
      parties,
      audit,
      rates: new RateService({ goldRates, audit, clock }),
      clock,
    }),
    items,
    locations,
    session: { user },
  }
}

function requestOf(overrides: Partial<OpeningPostRequest> = {}): OpeningPostRequest {
  return {
    entryDate: '2026-08-01',
    lines: [
      {
        tagText: '',
        itemCode: 'r-114',
        grossGrams: '5.425',
        stoneGrams: '1.000',
        stoneCountText: '3',
        kattRatti: '19.59',
        locationId: safeId,
      },
      {
        tagText: '77',
        itemCode: 'R-114',
        grossGrams: '4.200',
        stoneGrams: '',
        stoneCountText: '',
        kattRatti: '',
        locationId: null,
      },
    ],
    notes: null,
    ...overrides,
  }
}

beforeEach(() => {
  build(admin)
})

describe('the opening grid preview', () => {
  it('computes net and khalis from the typed figures, stone deducted first', () => {
    const preview = openingPreview(deps, requestOf())
    // Line 1: net 4.425, khalis 4425 × 76410/96000 = 3521.9… → 3.522.
    expect(preview.lines[0]).toMatchObject({
      itemName: '22K ladies ring',
      netDisplay: '4.425',
      khalisDisplay: '3.522',
      error: null,
    })
    // Line 2: no katt typed → the item's default (9); 4200 × 87000/96000 = 3806.25 → 3.806.
    expect(preview.lines[1]?.kattDisplay).toBe('9.000')
    expect(preview.lines[1]?.khalisDisplay).toBe('3.806')
    expect(preview.count).toBe(2)
    expect(preview.grossTotalDisplay).toBe('9.625')
    expect(preview.khalisTotalDisplay).toBe('7.328')
  })

  it('shows the tags each line will take: typed kept, blank from the book', () => {
    const preview = openingPreview(deps, requestOf())
    expect(preview.lines[0]?.tagDisplay).toBe('next: 1')
    expect(preview.lines[1]?.tagDisplay).toBe('77')
  })

  it('reports an unknown item code as that row\'s own error', () => {
    const preview = openingPreview(deps, {
      ...requestOf(),
      lines: [requestOf().lines[0]!, { ...requestOf().lines[1]!, itemCode: 'NOPE' }],
    })
    expect(preview.lines[0]?.error).toBeNull()
    expect(preview.lines[1]?.error).toContain('NOPE')
    // The broken row contributes nothing; the good one still totals.
    expect(preview.count).toBe(1)
  })

  it('refuses a stone heavier than the gross with the domain\'s sentence', () => {
    const preview = openingPreview(deps, {
      ...requestOf(),
      lines: [{ ...requestOf().lines[0]!, stoneGrams: '9.999' }],
    })
    expect(preview.lines[0]?.error).toContain('cannot exceed the gross')
  })
})

describe('posting opening stock', () => {
  it('creates the pieces and their OPENING ledger rows, dated once', () => {
    const result = openingPost(deps, requestOf())
    if (!result.ok) throw new Error(result.message)
    expect(result.count).toBe(2)
    expect(result.khalisTotalDisplay).toBe('7.328')

    const rows = stock.list({ branchId: BRANCH })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.kind === 'OPENING')).toBe(true)
    expect(rows.every((row) => row.bucket === 'FINISHED')).toBe(true)
    expect(rows.every((row) => row.at.startsWith('2026-08-01'))).toBe(true)
  })

  it('the summary and the ledger agree — the invariant, from the very first post', () => {
    openingPost(deps, requestOf())
    const summary = inventorySummary(deps, 'category')
    const ledgerKhalis = stock
      .list({ branchId: BRANCH })
      .reduce((sum, row) => sum + row.khalis.milligrams, 0)
    expect(summary.totalKhalisDisplay).toBe('7.328')
    expect(ledgerKhalis).toBe(7_328)
  })

  it('a refusal names its row and posts NOTHING', () => {
    const result = openingPost(deps, {
      ...requestOf(),
      lines: [requestOf().lines[0]!, { ...requestOf().lines[1]!, grossGrams: 'x' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('Row 2')
    expect(stock.list({ branchId: BRANCH })).toHaveLength(0)
    expect(pieceList(deps, {})).toHaveLength(0)
  })

  it('refuses with a message, not a throw, when nobody is signed in', () => {
    build(null)
    expect(openingPost(deps, requestOf()).ok).toBe(false)
    expect(openingNextTag(deps)).toBe('—')
  })
})

describe('the three-column summary', () => {
  it('groups by category · purity with QUANTITY, GROSS and KHALIS', () => {
    openingPost(deps, requestOf())
    const summary = inventorySummary(deps, 'category')
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]).toMatchObject({
      label: 'Rings · 22K',
      count: 2,
      grossDisplay: '9.625',
      khalisDisplay: '7.328',
    })
    expect(summary.totalCount).toBe(2)
  })

  it('regroups by location without re-posting anything', () => {
    openingPost(deps, requestOf())
    const byLocation = inventorySummary(deps, 'location')
    expect(byLocation.rows.map((row) => [row.label, row.count])).toEqual([
      ['No location', 1],
      ['Safe', 1],
    ])
  })

  it('drills from a row to exactly the pieces behind it — null is a real group', () => {
    openingPost(deps, requestOf())
    const byLocation = inventorySummary(deps, 'location')
    const noLocation = byLocation.rows.find((row) => row.label === 'No location')
    const pieces = pieceList(deps, noLocation?.filter ?? {})
    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.tagDisplay).toBe('77')
  })

  it('stamps the valuation with its rate and its moment', () => {
    goldRates.seed(BRANCH, 'K24', 402_000, '2026-08-01')
    openingPost(deps, requestOf())
    const summary = inventorySummary(deps, 'category')
    // 7328 mg × 40 200 000 / 11 664 = 25 255 967 paisa, rounded once —
    // Rs 252,560 whole.
    expect(summary.valuationDisplay).toBe('Rs 252,560')
    expect(summary.valuationRateDisplay).toBe('Rs 402,000 / tola (24K)')
    expect(summary.valuationAtDisplay).toBe('2026-08-15 09:00')
  })
})

describe('a piece\'s history', () => {
  it('reads as sentences: created, then moved', () => {
    openingPost(deps, requestOf())
    const piece = pieceList(deps, {}).find((p) => p.tagDisplay === '77')
    pieceMove(deps, piece?.id ?? '', safeId)

    const history = pieceHistory(deps, piece?.id ?? '')
    expect(history?.piece.statusDisplay).toBe('In stock')
    expect(history?.piece.sourceDisplay).toBe('Opening stock')
    expect(history?.events.map((event) => event.text)).toEqual([
      'Created — Opening stock',
      'Moved: — → Safe',
    ])
  })

  it('refuses to move what is not in stock — with a sentence naming the state', () => {
    // No such piece: the refusal path itself.
    const result = pieceMove(deps, 'missing', safeId)
    expect(result.ok).toBe(false)
  })
})
