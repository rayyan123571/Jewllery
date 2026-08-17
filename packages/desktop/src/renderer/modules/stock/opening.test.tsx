/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { App } from '../../App.js'
import {
  inventorySummary,
  openingNextTag,
  openingPost,
  openingPreview,
  pieceHistory,
  pieceList,
  pieceMove,
  type PieceHandlerDeps,
} from '../../../main/pieceHandlers.js'
import type {
  OpeningPostRequest,
  PieceListRequest,
} from '../../../shared/ipc.js'

/**
 * Opening stock and the morning summary, driven end-to-end minus Electron —
 * the piece mocks delegate to the REAL handlers over fakes, so the figures
 * these tests read out of the grid and the three-column summary are the real
 * arithmetic: stone deducted before katt, quantity as a COUNT, khalis as a
 * SUM.
 */

const clock = fixedClock('2026-08-15T09:00:00.000Z')
const BRANCH = 'branch-1'

const admin: PublicUser = {
  id: 'u1',
  branchId: BRANCH,
  name: 'Admin',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

let deps: PieceHandlerDeps
let stock: FakeStockLedgerRepository
let locations: FakeLocationRepository
let categoriesRepo: FakeItemCategoryRepository

function buildBackend(): void {
  const audit = new FakeAuditRepository(clock)
  const items = new FakeItemRepository(clock)
  categoriesRepo = new FakeItemCategoryRepository(clock)
  locations = new FakeLocationRepository(clock)
  const parties = new FakePartyRepository(clock)
  stock = new FakeStockLedgerRepository(clock)
  const pieces = new FakePieceRepository(clock, stock, items)
  const goldRates = new FakeGoldRateRepository(clock)

  const rings = categoriesRepo.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
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
    createdByUserId: 'u1',
  })
  locations.create({ branchId: BRANCH, name: 'Safe' })

  deps = {
    branchId: BRANCH,
    pieces: new PieceService({
      pieces,
      items,
      itemCategories: categoriesRepo,
      locations,
      parties,
      audit,
      rates: new RateService({ goldRates, audit, clock }),
      clock,
    }),
    items,
    locations,
    session: { user: admin },
  }
}

const api = {
  bootstrap: vi.fn(async () => ({
    branchId: BRANCH,
    branchName: 'Main Branch',
    shop: {
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: '',
      ownerName: '',
      secondOwnerName: '',
      phone1: '',
      phone2: '',
      phone3: '',
      address: '',
    },
    receiptFooter: '',
    user: { id: 'u1', name: 'Admin', username: 'admin', role: 'ADMIN', mustChangePassword: false },
    rates: [],
    backup: { lastBackupAt: null, lastBackupDisplay: 'Never', daysSince: null, integrityOk: false },
    users: [
      { id: 'u1', name: 'Admin', username: 'admin', role: 'ADMIN', mustChangePassword: false },
    ],
    databaseConnected: true,
    sidebarCollapsed: false,
  })),
  login: vi.fn(),
  logout: vi.fn(),
  selectUser: vi.fn(),
  setSidebarCollapsed: vi.fn(async () => {}),
  currentRates: vi.fn(async () => []),
  runBackup: vi.fn(),
  restoreBackup: vi.fn(),
  quit: vi.fn(),
  searchParties: vi.fn(async () => []),
  createParty: vi.fn(),
  partyBalance: vi.fn(async () => null),
  rateFor: vi.fn(async () => null),
  nextInvoiceNo: vi.fn(async () => '1'),
  previewWholesale: vi.fn(async () => ({
    lines: [],
    grossTotalDisplay: '0.000',
    khalisTotalDisplay: '0.000',
    amountTotalDisplay: '0.00',
    rateDisplay: null,
    rateMissing: false,
    previousBalance: null,
    endBalance: null,
  })),
  postIssue: vi.fn(),
  settle: vi.fn(),
  partyLedger: vi.fn(async () => []),
  wholesaleNeighbours: vi.fn(async () => ({
    first: null,
    previous: null,
    next: null,
    last: null,
  })),
  wholesaleLoadAsDraft: vi.fn(async () => null),
  setRate: vi.fn(),
  rateHistory: vi.fn(async () => []),
  changePassword: vi.fn(),
  purchaseNextInvoiceNo: vi.fn(async () => '1'),
  purchasePreview: vi.fn(async () => ({
    lines: [],
    grossTotalDisplay: '0.000',
    khalisTotalDisplay: '0.000',
    amountTotalDisplay: '0.00',
    rateDisplay: null,
    rateMissing: false,
  })),
  purchaseSave: vi.fn(),
  purchaseHold: vi.fn(),
  purchaseCancel: vi.fn(),
  purchaseNeighbours: vi.fn(async () => ({
    first: null,
    previous: null,
    next: null,
    last: null,
  })),
  purchaseLoadAsDraft: vi.fn(async () => null),
  purchaseRateFor: vi.fn(async () => null),
  stockSummary: vi.fn(async () => ({
    buckets: [],
    totalGrossDisplay: '0.000',
    totalKhalisDisplay: '0.000',
    totalIsNegative: false,
    negativeBuckets: [],
    valuationDisplay: null,
    valuationRateDisplay: null,
    valuationAtDisplay: '',
  })),
  stockLedger: vi.fn(async () => []),
  stockAdjust: vi.fn(),
  inventoryItems: vi.fn(async () => []),
  inventoryItemCreate: vi.fn(),
  inventoryItemUpdate: vi.fn(),
  inventoryItemSetActive: vi.fn(),
  inventoryCategoryTree: vi.fn(async () => []),
  inventoryCategoryCreate: vi.fn(),
  inventoryCategoryRename: vi.fn(),
  inventoryCategorySetActive: vi.fn(),
  inventoryLocations: vi.fn(async (includeInactive: boolean) =>
    locations
      .list(BRANCH, includeInactive)
      .map((l) => ({ id: l.id, name: l.name, isActive: l.isActive })),
  ),
  inventoryLocationCreate: vi.fn(),
  inventoryLocationRename: vi.fn(),
  inventoryLocationSetActive: vi.fn(),

  // ── the real handlers, over the fakes ─────────────────────────────────────
  inventorySummary: vi.fn(async (groupBy: string) => inventorySummary(deps, groupBy)),
  pieceList: vi.fn(async (filter: PieceListRequest) => pieceList(deps, filter)),
  pieceHistory: vi.fn(async (pieceId: string) => pieceHistory(deps, pieceId)),
  pieceMove: vi.fn(async (pieceId: string, locationId: string | null) =>
    pieceMove(deps, pieceId, locationId),
  ),
  openingNextTag: vi.fn(async () => openingNextTag(deps)),
  openingPreview: vi.fn(async (request: OpeningPostRequest) => openingPreview(deps, request)),
  openingPost: vi.fn(async (request: OpeningPostRequest) => openingPost(deps, request)),

  retailCalculate: vi.fn(),
  retailBillCalculate: vi.fn(),
  retailBillSave: vi.fn(),
  retailBillNextNo: vi.fn(async () => 'RB-00001'),
  retailBillReceipt: vi.fn(async () => null),
  retailDraftSave: vi.fn(async () => ({ ok: true as const })),
  retailDraftFind: vi.fn(async () => null),
  retailDraftDiscard: vi.fn(async () => ({ ok: true as const })),
  retailSave: vi.fn(),
  retailHold: vi.fn(),
  retailLoad: vi.fn(async () => null),
  retailList: vi.fn(async () => []),
  retailVoid: vi.fn(),
  retailNextInvoiceNo: vi.fn(async () => '1'),
  retailNeighbours: vi.fn(async () => ({
    first: null,
    previous: null,
    next: null,
    last: null,
  })),
  retailLoadAsDraft: vi.fn(async () => null),
  retailReceipt: vi.fn(async () => null),
  searchCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  retailWastageRule: vi.fn(async () => ({ savedDirection: 'add', savedBasis: 'net', examples: [] })),
  setRetailWastageRule: vi.fn(async () => ({ ok: true as const })),
  retailRounding: vi.fn(async () => ({ savedStep: 1, exactDisplay: '', options: [] })),
  setRetailRounding: vi.fn(async () => ({ ok: true as const })),
  shopProfile: vi.fn(),
  setShopProfile: vi.fn(),
  printSettings: vi.fn(),
  setPrintSettings: vi.fn(),
  openExternal: vi.fn(async () => ({ ok: true as const })),

  windowControls: {
    minimize: vi.fn(async () => {}),
    toggleFullscreen: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    isFullscreen: vi.fn(async () => false),
    onFullscreenChange: vi.fn(() => () => {}),
  },
}

beforeEach(() => {
  buildBackend()
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function openStock(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Stock Management'))
  await screen.findByText('Opening Stock')
}

async function typeOpeningRows(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByText('Opening Stock'))
  await screen.findByLabelText('Item code row 1')
  await user.type(screen.getByLabelText('Item code row 1'), 'r-114')
  await user.type(screen.getByLabelText('Gross weight row 1'), '5.425')
  await user.type(screen.getByLabelText('Stone weight row 1'), '1.000')
  await user.type(screen.getByLabelText('Stone count row 1'), '3')
  await user.type(screen.getByLabelText('Katt row 1'), '19.59')
  await user.type(screen.getByLabelText('Item code row 2'), 'R-114')
  await user.type(screen.getByLabelText('Gross weight row 2'), '4.200')
}

describe('the opening grid', () => {
  it('resolves the item from its code and computes khalis from NET × katt', async () => {
    const user = userEvent.setup()
    await openStock(user)
    await typeOpeningRows(user)

    // Stone deducted first: 4.425 × (1 − 19.59/96) → 3.522. No katt typed on
    // row 2 → the item's default 9 → 3.806.
    await screen.findByText('3.522')
    await screen.findByText('3.806')
    await waitFor(() => {
      expect(screen.getAllByText('9.625').length).toBeGreaterThan(0)
      expect(screen.getAllByText('7.328').length).toBeGreaterThan(0)
    })
  })

  it('posts, and the morning summary shows QUANTITY · GROSS · KHALIS', async () => {
    const user = userEvent.setup()
    await openStock(user)
    await typeOpeningRows(user)
    await screen.findByText('3.522')

    await user.click(screen.getByText('Post Opening Stock'))

    // Posting lands back on the Inventory tab, whose row is a COUNT and two
    // SUMs. findAll: the figures appear in the row and the total line both.
    await screen.findByText('Rings · 22K')
    await screen.findAllByText('9.625')
    await screen.findAllByText('7.328')
    expect(stock.rows).toHaveLength(2)
    expect(stock.rows.every((row) => row.kind === 'OPENING')).toBe(true)
  })

  it('drills from the summary row into the pieces, and a piece into its history', async () => {
    const user = userEvent.setup()
    await openStock(user)
    await typeOpeningRows(user)
    await screen.findByText('3.522')
    await user.click(screen.getByText('Post Opening Stock'))
    await screen.findByText('Rings · 22K')

    await user.click(screen.getByLabelText('Show the pieces in Rings · 22K'))
    // Two pieces, tags 1 and 2, each with its own weight.
    await screen.findByLabelText('Open tag 1')
    await screen.findByLabelText('Open tag 2')

    await user.click(screen.getByLabelText('Open tag 1'))
    await screen.findByText(/Created — Opening stock/)
  })
})
