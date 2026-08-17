/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'
import type { PrintSettingsDto, ShopProfileDto } from '../../../shared/ipc.js'

/**
 * Settings, from the shopkeeper's side.
 *
 * What is checked is what somebody actually comes here to do: change the name
 * that prints on the receipt, and see the change before pressing Save. The
 * arithmetic under PRICING is proved with no window at all, in the domain and
 * application suites — repeating it here would test the fixture, not the screen.
 */

const SHOP: ShopProfileDto = {
  name: 'AL-HARAM GOLD JEWELLERS',
  tagline: 'Trust in Purity',
  ownerName: 'Haji Abdul Rehman',
  secondOwnerName: '',
  phone1: '0300-7779999',
  phone2: '',
  phone3: '',
  address: 'Sona Bazaar, Lahore',
}

const PRINT: PrintSettingsDto = {
  paperWidthMm: 80,
  copies: 1,
  printAfterSave: false,
  terms: '',
  footer: 'Thank you — please visit again',
  retailPrefix: '',
  wholesalePrefix: '',
  settlementPrefix: '',
  purchasePrefix: '',
}

/** The one stored shop row, so a save is visible to every later read. */
let stored: ShopProfileDto = SHOP

const api = {
  bootstrap: vi.fn(async () => ({
    branchId: 'branch-1',
    branchName: 'Main Branch',
    shop: stored,
    receiptFooter: 'Thank you — please visit again',

    user: { id: 'u1', name: 'Admin', username: 'admin', role: 'ADMIN', mustChangePassword: false },
    rates: [],
    backup: {
      lastBackupAt: null,
      lastBackupDisplay: '14-08-2026 09:15 PM',
      daysSince: 1,
      integrityOk: true,
    },
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

  retailCalculate: vi.fn(),
  retailBillCalculate: vi.fn(),
  retailBillSave: vi.fn(),
  retailBillNextNo: vi.fn(async () => 'RB-00001'),
  retailBillReceipt: vi.fn(async () => null),
  retailDraftSave: vi.fn(async () => ({ ok: true as const })),
  retailDraftFind: vi.fn(async () => null),
  retailDraftDiscard: vi.fn(async () => ({ ok: true as const })),
  retailSave: vi.fn(),
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
  retailWastageRule: vi.fn(async () => ({
    savedDirection: 'add',
    savedBasis: 'net',
    examples: [
      {
        title: 'A plain piece',
        note: null,
        sample: {
          grossTola: '4.050',
          stoneTola: '0.000',
          cutTola: '0.000',
          wastagePercent: '14.00',
          rateDisplay: 'Rs 237,970/tola',
        },
        options: [
          {
            direction: 'add',
            basis: 'net',
            label: 'Added to net weight, calculated on net weight',
            wastageDisplay: '0.567 tola',
            fineDisplay: '4.617 tola',
            amountDisplay: 'Rs 1,098,608',
            isSaved: true,
            isSelected: true,
          },
        ],
      },
    ],
  })),
  setRetailWastageRule: vi.fn(async () => ({ ok: true as const })),
  retailRounding: vi.fn(async () => ({
    savedStep: 1,
    exactDisplay: 'Rs 1,098,608.35',
    options: [
      {
        step: 1,
        label: 'Exact — no rounding',
        note: 'No rounding.',
        totalDisplay: 'Rs 1,098,608.35',
        isSaved: true,
      },
    ],
  })),
  setRetailRounding: vi.fn(async () => ({ ok: true as const })),
  shopProfile: vi.fn(async () => stored),
  setShopProfile: vi.fn(async (profile: ShopProfileDto) => {
    stored = profile
    return { ok: true as const }
  }),
  printSettings: vi.fn(async () => PRINT),
  setPrintSettings: vi.fn(async (_changes: Partial<PrintSettingsDto>) => ({
    ok: true as const,
  })),
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
  stored = SHOP
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Opens Settings the way an operator does — from the menu. */
async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Settings'))
  await screen.findByText('YOUR SHOP')
}

describe('the settings screen is four sections, not one long page', () => {
  it('opens on the shop details, because that is what people come here for', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    expect(screen.getByLabelText('Shop name')).toBeTruthy()
    // The pricing tables are NOT on screen until asked for.
    expect(screen.queryByText('POLISH (WASTAGE)')).toBeNull()
  })

  it('shows one section at a time, and every section has something in it', async () => {
    const user = userEvent.setup()
    await openSettings(user)
    const nav = screen.getByLabelText('Settings sections')

    await user.click(within(nav).getByText('Printing'))
    await screen.findByText('PRINTER')
    expect(screen.queryByText('YOUR SHOP')).toBeNull()

    await user.click(within(nav).getByText('Pricing'))
    await screen.findByText('POLISH (WASTAGE)')
    expect(screen.getByText('ROUNDING')).toBeTruthy()

    await user.click(within(nav).getByText('System'))
    await screen.findByText('STATUS')
    expect(screen.getByText('Open and working')).toBeTruthy()

    await user.click(within(nav).getByText('Shop Details'))
    await screen.findByText('YOUR SHOP')
  })
})

describe('the shop details', () => {
  it('shows what is stored, and saves what is typed', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    const name = screen.getByLabelText('Shop name') as HTMLInputElement
    await waitFor(() => expect(name.value).toBe('AL-HARAM GOLD JEWELLERS'))

    await user.clear(name)
    await user.type(name, 'CHAUDHRY GOLD')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(api.setShopProfile).toHaveBeenCalled())
    expect(api.setShopProfile.mock.calls[0]?.[0]).toMatchObject({ name: 'CHAUDHRY GOLD' })
  })

  /**
   * The preview is the point of this section.
   *
   * Somebody typing their shop's name wants to see the receipt change as they
   * type it, not press Save and go and print one to find out.
   */
  it('shows the receipt header changing as it is typed', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    const preview = screen.getByLabelText('Receipt header preview')
    await waitFor(() =>
      expect(within(preview).getByText('AL-HARAM GOLD JEWELLERS')).toBeTruthy(),
    )

    const name = screen.getByLabelText('Shop name')
    await user.clear(name)
    await user.type(name, 'CHAUDHRY GOLD')

    expect(within(preview).getByText('CHAUDHRY GOLD')).toBeTruthy()
  })

  /** A blank line is left OFF the paper rather than printed empty. */
  it('drops a line from the preview when its field is cleared', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    const preview = screen.getByLabelText('Receipt header preview')
    await waitFor(() => expect(within(preview).getByText('Trust in Purity')).toBeTruthy())

    await user.clear(screen.getByLabelText('Tagline (optional)'))
    expect(within(preview).queryByText('Trust in Purity')).toBeNull()
  })
})

/**
 * The name the shop types must show up where the shop can SEE it, not only on
 * paper it has to print to check. The menu's wordmark is the one place it is on
 * screen all day, so that is what this asserts on.
 */
describe('the shop name reaches the rest of the app', () => {
  it('shows the stored name in the menu rather than a name typed into the code', async () => {
    const user = userEvent.setup()
    await openSettings(user)
    const menu = screen.getByLabelText('Main menu')
    expect(within(menu).getByText('AL-HARAM GOLD JEWELLERS')).toBeTruthy()
  })

  it('updates the menu as soon as a new name is saved, with no restart', async () => {
    const user = userEvent.setup()
    await openSettings(user)

    const name = screen.getByLabelText('Shop name')
    await user.clear(name)
    await user.type(name, 'CHAUDHRY GOLD')
    await user.click(screen.getByText('Save'))

    const menu = screen.getByLabelText('Main menu')
    await waitFor(() => expect(within(menu).getByText('CHAUDHRY GOLD')).toBeTruthy())
    expect(within(menu).queryByText('AL-HARAM GOLD JEWELLERS')).toBeNull()
  })
})

describe('the receipt number prefix', () => {
  it('says what the number will look like before it is saved', async () => {
    const user = userEvent.setup()
    await openSettings(user)
    await user.click(within(screen.getByLabelText('Settings sections')).getByText('Printing'))
    await screen.findByText('RECEIPT NUMBERS')

    // Empty is the default, and all four books print a bare number.
    expect(screen.getAllByText('Shows as 7')).toHaveLength(4)

    await user.type(screen.getByLabelText('Wholesale slip prefix'), 'WS-')
    expect(screen.getByText('Shows as WS-7')).toBeTruthy()
    // Only the one that was typed into moves. The other books keep their own.
    expect(screen.getAllByText('Shows as 7')).toHaveLength(3)
  })
})
