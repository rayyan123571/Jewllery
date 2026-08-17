/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { App } from '../../App.js'
import {
  purchaseCancel,
  purchaseLoadAsDraft,
  purchaseNeighbours,
  purchaseNextInvoiceNo,
  purchasePreview,
  purchaseRateFor,
  purchaseSave,
  type PurchaseHandlerDeps,
} from '../../../main/purchaseHandlers.js'
import {
  stockAdjust,
  stockLedger,
  stockSummary,
  type StockHandlerDeps,
} from '../../../main/stockHandlers.js'
import type {
  SavePurchaseRequest,
  StockAdjustRequest,
  StockLedgerRequest,
} from '../../../shared/ipc.js'

/**
 * The purchase screen, driven end-to-end minus Electron.
 *
 * Unlike the other renderer suites, the purchase/stock mocks here do not
 * return canned values — they DELEGATE to the real handler functions over the
 * in-memory fakes. What these tests read out of the grid cells is therefore
 * the module's real arithmetic: the acceptance figures (4.318 g from the lab,
 * 10.344 g from the formula), the snapshot behaviour on reopen, and the
 * summary the ledger's running balance must agree with.
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

let deps: PurchaseHandlerDeps
let stockDeps: StockHandlerDeps
let goldRates: FakeGoldRateRepository
let parties: FakePartyRepository

function buildBackend(): void {
  const audit = new FakeAuditRepository(clock)
  parties = new FakePartyRepository(clock)
  const stock = new FakeStockLedgerRepository(clock)
  const purchases = new FakePurchaseRepository(clock, stock)
  goldRates = new FakeGoldRateRepository(clock)
  const settings = new Settings(new FakeSettingsRepository())
  const rateService = new RateService({ goldRates, audit, clock })
  goldRates.seed(BRANCH, 'K24', 402_000, '2026-08-01')

  parties.create({
    branchId: BRANCH,
    code: 'SELLER',
    name: 'WALK-IN SELLER',
    mobile: null,
    city: null,
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
  })

  const session = { user: admin }
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

const api = {
  bootstrap: vi.fn(async () => ({
    branchId: BRANCH,
    branchName: 'Main Branch',
    shop: {
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: 'Trust in Purity',
      ownerName: '',
      secondOwnerName: '',
      phone1: '',
      phone2: '',
      phone3: '',
      address: '',
    },
    receiptFooter: 'Thank you — please visit again',
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

  // The party selector runs against the same fake directory the service uses.
  searchParties: vi.fn(async (query: string) => parties.search(BRANCH, query, 20)),
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

  // ── the real handlers, over the fakes. No canned figures anywhere below. ──
  purchaseNextInvoiceNo: vi.fn(async () => purchaseNextInvoiceNo(deps)),
  purchasePreview: vi.fn(async (request: SavePurchaseRequest) =>
    purchasePreview(deps, request),
  ),
  purchaseSave: vi.fn(async (request: SavePurchaseRequest) =>
    purchaseSave(deps, request, 'posted'),
  ),
  purchaseHold: vi.fn(async (request: SavePurchaseRequest) =>
    purchaseSave(deps, request, 'held'),
  ),
  purchaseCancel: vi.fn(async (entryId: string, reason: string) =>
    purchaseCancel(deps, entryId, reason),
  ),
  purchaseNeighbours: vi.fn(async (current: number | null, includeCancelled: boolean) =>
    purchaseNeighbours(deps, current, includeCancelled),
  ),
  purchaseLoadAsDraft: vi.fn(async (invoiceNumber: number) =>
    purchaseLoadAsDraft(deps, invoiceNumber),
  ),
  purchaseRateFor: vi.fn(async (date: string) => purchaseRateFor(deps, date)),
  stockSummary: vi.fn(async () => stockSummary(stockDeps)),
  stockLedger: vi.fn(async (filter: StockLedgerRequest) => stockLedger(stockDeps, filter)),
  stockAdjust: vi.fn(async (request: StockAdjustRequest) => stockAdjust(stockDeps, request)),

  retailCalculate: vi.fn(),
  retailBillCalculate: vi.fn(),
  retailBillSave: vi.fn(),
  retailBillNextNo: vi.fn(async () => 'RB-00001'),
  retailBillReceipt: vi.fn(async () => null),
  retailDraftSave: vi.fn(async () => ({ ok: true as const })),
  retailDraftFind: vi.fn(async () => null),
  retailDraftDiscard: vi.fn(async () => ({ ok: true as const })),
  retailSave: vi.fn(),
  inventoryItems: vi.fn(async () => []),
  inventoryItemCreate: vi.fn(),
  inventoryItemUpdate: vi.fn(),
  inventoryItemSetActive: vi.fn(),
  inventoryCategoryTree: vi.fn(async () => []),
  inventoryCategoryCreate: vi.fn(),
  inventoryCategoryRename: vi.fn(),
  inventoryCategorySetActive: vi.fn(),
  inventoryLocations: vi.fn(async () => []),
  inventoryLocationCreate: vi.fn(),
  inventoryLocationRename: vi.fn(),
  inventoryLocationSetActive: vi.fn(),
  inventorySummary: vi.fn(async () => ({
    groupBy: 'category',
    rows: [],
    totalCount: 0,
    totalGrossDisplay: '0.000',
    totalKhalisDisplay: '0.000',
    valuationDisplay: null,
    valuationRateDisplay: null,
    valuationAtDisplay: '',
  })),
  pieceList: vi.fn(async () => []),
  pieceHistory: vi.fn(async () => null),
  pieceMove: vi.fn(),
  openingNextTag: vi.fn(async () => '1'),
  openingPreview: vi.fn(async () => ({
    lines: [],
    count: 0,
    grossTotalDisplay: '0.000',
    khalisTotalDisplay: '0.000',
  })),
  openingPost: vi.fn(),
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

async function openPurchase(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Purchase'))
  await screen.findByText('ENTRY DETAILS')
}

async function chooseParty(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Party'), 'WALK')
  await user.click(await screen.findByLabelText('Select WALK-IN SELLER'))
}

/** Types the acceptance sheet's two lines into the real grid. */
async function typeReferencePurchase(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText('Item name row 1'), 'OLD BANGLES')
  await user.type(screen.getByLabelText('Gross weight row 1'), '5.425')
  await user.type(screen.getByLabelText('Katt row 1'), '19.59')
  await user.type(screen.getByLabelText('Item name row 2'), 'OLD CHAIN')
  await user.type(screen.getByLabelText('Gross weight row 2'), '11.381')
  await user.type(screen.getByLabelText('Katt row 2'), '8.75')
}

describe('the grid computes the acceptance figures', () => {
  it('shows khalis 4.318 and 10.344, and totals 16.806 / 14.662', async () => {
    const user = userEvent.setup()
    await openPurchase(user)
    await typeReferencePurchase(user)

    // The lab figure for line 1 and the formula's figure for line 2, in the
    // read-only khalis cells — the operator cannot type either.
    await screen.findAllByText('4.318')
    await screen.findAllByText('10.344')
    await waitFor(() => {
      expect(screen.getAllByText('16.806').length).toBeGreaterThan(0)
      expect(screen.getAllByText('14.662').length).toBeGreaterThan(0)
    })
  })
})

describe('saving and holding against the real book', () => {
  it('SAVE posts, raises stock by exactly the purchase, and moves to number 2', async () => {
    const user = userEvent.setup()
    await openPurchase(user)
    await chooseParty(user)
    await typeReferencePurchase(user)
    await screen.findAllByText('4.318')

    await user.click(screen.getByText('SAVE (F5)'))

    await waitFor(() => {
      expect(api.purchaseSave).toHaveBeenCalled()
    })
    const summary = stockSummary(stockDeps)
    expect(summary.totalKhalisDisplay).toBe('14.662')
    expect(summary.totalGrossDisplay).toBe('16.806')
    await waitFor(() => {
      expect((screen.getByLabelText(/Purchase number/) as HTMLInputElement).value).toBe('2')
    })
  })

  it('HOLD parks the purchase and moves NOTHING into stock', async () => {
    const user = userEvent.setup()
    await openPurchase(user)
    await chooseParty(user)
    await typeReferencePurchase(user)
    await screen.findAllByText('4.318')

    await user.click(screen.getByText('HOLD (F8)'))

    await waitFor(() => {
      expect(api.purchaseHold).toHaveBeenCalled()
    })
    expect(stockSummary(stockDeps).totalKhalisDisplay).toBe('0.000')
    expect(stockLedger(stockDeps, {})).toHaveLength(0)
  })
})

describe('reopening a posted purchase — the snapshot test', () => {
  async function postReference(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await openPurchase(user)
    await chooseParty(user)
    await typeReferencePurchase(user)
    await screen.findAllByText('4.318')
    await user.click(screen.getByText('SAVE (F5)'))
    await waitFor(() =>
      expect((screen.getByLabelText(/Purchase number/) as HTMLInputElement).value).toBe('2'),
    )
  }

  it('reopens locked, with every figure unchanged', async () => {
    const user = userEvent.setup()
    await postReference(user)

    // PREV walks back onto purchase 1.
    await user.click(screen.getByText('PREV'))

    await screen.findByText(/1 · POSTED · read-only/)
    expect((screen.getByLabelText('Gross weight row 1') as HTMLInputElement).value).toBe(
      '5.425',
    )
    expect((screen.getByLabelText('Gross weight row 1') as HTMLInputElement).disabled).toBe(
      true,
    )
    await screen.findAllByText('4.318')
    await screen.findAllByText('10.344')
  })

  it('does NOT reprice when today\'s gold rate changes', async () => {
    const user = userEvent.setup()
    await postReference(user)

    // Today's 24K rate doubles after the purchase was posted.
    goldRates.seed(BRANCH, 'K24', 804_000, '2026-08-15')

    await user.click(screen.getByText('PREV'))
    await screen.findByText(/1 · POSTED · read-only/)

    // The rate box holds the rate it was PRICED at — and the amounts computed
    // from it are the stored ones, not double.
    expect((screen.getByLabelText('Gold rate per tola') as HTMLInputElement).value).toBe(
      '402,000.00',
    )
    await screen.findAllByText('4.318')
    // Line 1's amount at the ORIGINAL rate: 4318 mg × Rs 402,000 / 11664 mg.
    await screen.findAllByText('148,819.96')
    expect(screen.queryByText('297,639.92')).toBeNull()
  })
})

describe('cancelling a posted purchase', () => {
  it('writes reversing rows and returns the summary to its previous values', async () => {
    const user = userEvent.setup()
    await openPurchase(user)
    await chooseParty(user)
    await typeReferencePurchase(user)
    await screen.findAllByText('4.318')
    await user.click(screen.getByText('SAVE (F5)'))
    await waitFor(() =>
      expect((screen.getByLabelText(/Purchase number/) as HTMLInputElement).value).toBe('2'),
    )

    await user.click(screen.getByText('PREV'))
    await screen.findByText(/1 · POSTED · read-only/)

    await user.click(screen.getByText('CANCEL INVOICE'))
    await user.type(
      screen.getByLabelText('Cancellation reason'),
      'Seller returned, deal off',
    )
    await user.click(screen.getByText('Cancel it'))

    await screen.findByText(/1 · CANCELLED/)
    const summary = stockSummary(stockDeps)
    expect(summary.totalKhalisDisplay).toBe('0.000')
    expect(summary.totalGrossDisplay).toBe('0.000')
    // Nothing deleted: two original rows plus two reversing rows.
    expect(stockLedger(stockDeps, {})).toHaveLength(4)
  })
})
