/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixedClock, type PublicUser } from '@jewellery/domain'
import {
  FakeAuditRepository,
  FakeItemCategoryRepository,
  FakeItemRepository,
  FakeLocationRepository,
  FakePartyRepository,
  InventoryService,
} from '@jewellery/application'
import { App } from '../../App.js'
import {
  inventoryCategoryCreate,
  inventoryCategoryRename,
  inventoryCategorySetActive,
  inventoryCategoryTree,
  inventoryItemCreate,
  inventoryItems,
  inventoryItemSetActive,
  inventoryItemUpdate,
  inventoryLocationCreate,
  inventoryLocationRename,
  inventoryLocations,
  inventoryLocationSetActive,
  type InventoryHandlerDeps,
} from '../../../main/inventoryHandlers.js'
import type { SaveItemRequest } from '../../../shared/ipc.js'

/**
 * The item master, driven end-to-end minus Electron — the same pattern the
 * purchase suite established: the inventory mocks delegate to the REAL handler
 * functions over in-memory fakes, so what these tests read out of the register
 * is the real validation and the real formatting, not canned values.
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

let deps: InventoryHandlerDeps
let parties: FakePartyRepository

function buildBackend(): void {
  const audit = new FakeAuditRepository(clock)
  parties = new FakePartyRepository(clock)
  deps = {
    branchId: BRANCH,
    inventory: new InventoryService({
      items: new FakeItemRepository(clock),
      itemCategories: new FakeItemCategoryRepository(clock),
      locations: new FakeLocationRepository(clock),
      parties,
      audit,
      clock,
    }),
    parties,
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

  // ── the real handlers, over the fakes ─────────────────────────────────────
  inventoryItems: vi.fn(async (query: string, includeInactive: boolean) =>
    inventoryItems(deps, query, includeInactive),
  ),
  inventoryItemCreate: vi.fn(async (request: SaveItemRequest) =>
    inventoryItemCreate(deps, request),
  ),
  inventoryItemUpdate: vi.fn(async (itemId: string, request: SaveItemRequest) =>
    inventoryItemUpdate(deps, itemId, request),
  ),
  inventoryItemSetActive: vi.fn(async (itemId: string, isActive: boolean) =>
    inventoryItemSetActive(deps, itemId, isActive),
  ),
  inventoryCategoryTree: vi.fn(async (includeInactive: boolean) =>
    inventoryCategoryTree(deps, includeInactive),
  ),
  inventoryCategoryCreate: vi.fn(async (parentId: string | null, name: string) =>
    inventoryCategoryCreate(deps, parentId, name),
  ),
  inventoryCategoryRename: vi.fn(async (categoryId: string, name: string) =>
    inventoryCategoryRename(deps, categoryId, name),
  ),
  inventoryCategorySetActive: vi.fn(async (categoryId: string, isActive: boolean) =>
    inventoryCategorySetActive(deps, categoryId, isActive),
  ),
  inventoryLocations: vi.fn(async (includeInactive: boolean) =>
    inventoryLocations(deps, includeInactive),
  ),
  inventoryLocationCreate: vi.fn(async (name: string) => inventoryLocationCreate(deps, name)),
  inventoryLocationRename: vi.fn(async (locationId: string, name: string) =>
    inventoryLocationRename(deps, locationId, name),
  ),
  inventoryLocationSetActive: vi.fn(async (locationId: string, isActive: boolean) =>
    inventoryLocationSetActive(deps, locationId, isActive),
  ),

  retailCalculate: vi.fn(),
  retailBillCalculate: vi.fn(),
  retailBillSave: vi.fn(),
  retailBillNextNo: vi.fn(async () => 'RB-00001'),
  retailBillReceipt: vi.fn(async () => null),
  retailDraftSave: vi.fn(async () => ({ ok: true as const })),
  retailDraftFind: vi.fn(async () => null),
  retailDraftDiscard: vi.fn(async () => ({ ok: true as const })),
  retailSave: vi.fn(),
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

function control(id: string): HTMLButtonElement {
  const found = document.querySelector(`[data-action="${id}"]`)
  if (!found) throw new Error(`No control for ${id}`)
  return found as HTMLButtonElement
}

async function openItemsTab(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Stock Management'))
  await user.click(await screen.findByText('Items'))
  await screen.findByLabelText('Search items')
}

describe('the item register', () => {
  it('adds an item through the form and shows it, preformatted', async () => {
    const user = userEvent.setup()
    await openItemsTab(user)

    await user.click(control('item.add'))
    await user.type(screen.getByLabelText('Item code'), 'r-114')
    await user.type(screen.getByLabelText('Item name'), '22K ladies ring')
    await user.type(screen.getByLabelText('Default katt'), '9')
    await user.type(screen.getByLabelText('Making charge amount'), '3500')
    await user.click(control('item.save'))

    // Normalised to uppercase by the service, formatted by the handler.
    await screen.findByText('R-114')
    await screen.findByText('Rs 3,500 / tola')
    expect(screen.getByText('22K ladies ring')).toBeTruthy()
  })

  it('shows a duplicate code as an inline sentence and keeps the form open', async () => {
    inventoryItemCreate(deps, {
      code: 'R-114',
      name: 'Existing ring',
      categoryId: null,
      purity: 'K22',
      defaultKattRatti: '9',
      makingChargeBasis: 'per_tola',
      makingChargeRupees: '',
      supplierId: null,
      designNo: '',
      notes: '',
    })
    const user = userEvent.setup()
    await openItemsTab(user)

    await user.click(control('item.add'))
    await user.type(screen.getByLabelText('Item code'), 'r-114')
    await user.type(screen.getByLabelText('Item name'), 'Second ring')
    await user.click(control('item.save'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('R-114')
    // Still open — nothing was lost.
    expect((screen.getByLabelText('Item name') as HTMLInputElement).value).toBe('Second ring')
  })

  it('deactivating an item drops it from the default view, not from history', async () => {
    inventoryItemCreate(deps, {
      code: 'CH-1',
      name: 'Singapori chain',
      categoryId: null,
      purity: 'K22',
      defaultKattRatti: '',
      makingChargeBasis: 'fixed',
      makingChargeRupees: '',
      supplierId: null,
      designNo: '',
      notes: '',
    })
    const user = userEvent.setup()
    await openItemsTab(user)
    await screen.findByText('CH-1')

    await user.click(screen.getByLabelText('Deactivate CH-1'))
    await waitFor(() => expect(screen.queryByText('CH-1')).toBeNull())

    await user.click(screen.getByText('Show deactivated'))
    await screen.findByText('CH-1')
  })
})

describe('categories and locations', () => {
  it('builds the two-level tree from the screen and refuses the third level', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByLabelText('Main menu')
    await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Stock Management'))
    await user.click(await screen.findByText('Categories & Locations'))

    await user.type(screen.getByLabelText('New category name'), 'Rings')
    await user.keyboard('{Enter}')
    await screen.findByText('Rings')

    await user.click(screen.getByLabelText('Add a sub-category under Rings'))
    await user.type(await screen.findByLabelText('New sub-category under Rings'), 'Ladies')
    await user.keyboard('{Enter}')
    await screen.findByText('› Ladies')

    // The third level has no control at all: a sub-category row offers rename
    // and deactivate, never "add under". The refusal is structural.
    expect(screen.queryByLabelText('Add a sub-category under Ladies')).toBeNull()
  })

  it('adds a location and refuses its case-insensitive twin with a message', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByLabelText('Main menu')
    await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Stock Management'))
    await user.click(await screen.findByText('Categories & Locations'))

    await user.type(screen.getByLabelText('New location name'), 'Showcase 1')
    await user.keyboard('{Enter}')
    await screen.findByText('Showcase 1')

    await user.type(screen.getByLabelText('New location name'), 'SHOWCASE 1')
    await user.keyboard('{Enter}')
    await screen.findByText(/already a location/)
  })
})
