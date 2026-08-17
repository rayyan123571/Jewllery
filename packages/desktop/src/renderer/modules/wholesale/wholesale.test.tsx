/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'
import { createActionRegistry, type ActionContext, type ActionId } from '../../actions/registry.js'
import type { WholesaleEntryDto } from '../../../shared/ipc.js'

/**
 * Walking the wholesale slip book, from the screen.
 *
 * The behaviours here are the retail toolbar's, over the other book, and they
 * are tested for the same reason they were tested there: the four arrows, the
 * number box and NEW are every way OFF a slip, and a guard with one exception is
 * a guard that loses work through that exception.
 *
 * Four things are checked:
 *
 *   1. **The ends are ends.** An empty book disables all four arrows rather than
 *      hiding them; a slip at the end disables the one that has nowhere to go.
 *   2. **A stored slip opens LOCKED.** SAVE is off, the grid cannot be typed
 *      into, and EDIT is the way out — because a posted slip is corrected by
 *      writing a new one, never amended in place.
 *   3. **The number box finds a slip, and refuses to move when it cannot.**
 *   4. **The guard stops every navigation** once anything has been typed.
 */

const CHAIN: WholesaleEntryDto = {
  entryId: 'entry-2',
  invoiceNumber: 10_002,
  invoiceNo: 'WS-10002',
  kind: 'ISSUE',
  isReversed: false,
  draft: {
    partyId: 'party-1',
    partyName: 'CHAUDHARY JEWELLER',
    partyCode: 'CHJ',
    entryDate: '2026-08-14',
    ratePerTolaOverride: '237,970.00',
    lines: [
      { itemName: 'SINGAPORI CHAIN', grossGrams: '254.200', kattRatti: '13.000', remarks: null },
    ],
    notes: null,
  },
}

/** A book with two slips in it, 10001 and 10002. */
const BOOK = {
  first: { number: 10_001, display: 'WS-10001' },
  previous: { number: 10_002, display: 'WS-10002' },
  next: null,
  last: { number: 10_002, display: 'WS-10002' },
}

const EMPTY_BOOK = { first: null, previous: null, next: null, last: null }

type Neighbours = typeof BOOK

const api = {
  bootstrap: vi.fn(async () => ({
    branchId: 'branch-1',
    branchName: 'Main Branch',
    shop: {
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: 'Trust in Purity',
      ownerName: 'Haji Abdul Rehman',
      secondOwnerName: '',
      phone1: '0300-7779999',
      phone2: '',
      phone3: '',
      address: 'Sona Bazaar, Lahore',
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

  searchParties: vi.fn(async () => []),
  createParty: vi.fn(),
  partyBalance: vi.fn(async () => null),
  rateFor: vi.fn(async () => null),
  nextInvoiceNo: vi.fn(async () => 'WS-10003'),
  previewWholesale: vi.fn(async () => ({
    lines: [],
    grossTotalDisplay: '0.000',
    khalisTotalDisplay: '0.000',
    amountTotalDisplay: '0.00',
    rateDisplay: 'Rs. 237,970',
    rateMissing: false,
    previousBalance: null,
    endBalance: null,
  })),
  postIssue: vi.fn(async () => ({
    ok: true as const,
    invoiceNo: 'WS-10003',
    entryId: 'entry-3',
    balanceAfter: { milligramsOrPaisa: 0, text: 'settled', direction: 'settled', drCr: '' },
    warnings: [],
  })),
  settle: vi.fn(),
  partyLedger: vi.fn(async () => []),
  // Typed loosely on purpose: individual tests give the mock a real book to
  // walk, and a literal-null default would fix the type at `null`.
  wholesaleNeighbours: vi.fn(async () => EMPTY_BOOK as unknown as Neighbours),
  wholesaleLoadAsDraft: vi.fn(
    async (_invoiceNumber: number) => null as WholesaleEntryDto | null,
  ),
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
  retailNeighbours: vi.fn(async () => EMPTY_BOOK),
  retailLoadAsDraft: vi.fn(async () => null),
  retailReceipt: vi.fn(async () => null),
  searchCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  retailWastageRule: vi.fn(),
  setRetailWastageRule: vi.fn(),
  retailRounding: vi.fn(),
  setRetailRounding: vi.fn(),
  shopProfile: vi.fn(async () => ({
    name: 'AL-HARAM GOLD JEWELLERS',
    tagline: 'Trust in Purity',
    ownerName: 'Haji Abdul Rehman',
    secondOwnerName: '',
    phone1: '0300-7779999',
    phone2: '',
    phone3: '',
    address: 'Sona Bazaar, Lahore',
  })),
  setShopProfile: vi.fn(async () => ({ ok: true as const })),
  printSettings: vi.fn(async () => ({
    paperWidthMm: 80,
    copies: 1,
    printAfterSave: false,
    terms: '',
    footer: 'Thank you — please visit again',
    retailPrefix: '',
    wholesalePrefix: '',
    settlementPrefix: '',
  })),
  setPrintSettings: vi.fn(async () => ({ ok: true as const })),
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
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  api.wholesaleNeighbours.mockImplementation(async () => EMPTY_BOOK as unknown as Neighbours)
  api.wholesaleLoadAsDraft.mockImplementation(async () => null)
})

function control(id: ActionId): HTMLButtonElement {
  const found = document.querySelector(`[data-action="${id}"]`)
  if (!found) throw new Error(`No control for ${id}`)
  return found as HTMLButtonElement
}

function stubContext(): ActionContext {
  return {
    navigate: vi.fn(),
    exit: vi.fn(),
    refreshRates: vi.fn(async () => {}),
    runBackup: vi.fn(async () => {}),
    restoreBackup: vi.fn(async () => {}),
    toggleUserMenu: vi.fn(),
    dispatch: vi.fn(),
    minimizeWindow: vi.fn(),
    toggleFullscreenWindow: vi.fn(),
    toggleSidebar: vi.fn(),
    switchUser: vi.fn(),
    closeWindow: vi.fn(),
  }
}

/** Whole Sale is the module the shell opens on. */
async function openWholesale(): Promise<void> {
  render(<App />)
  await screen.findByText('ENTRY DETAILS')
  // The number box seeds itself from the next slip number, which arrives from
  // main a tick later. Waiting for it means a test types over a settled box
  // rather than racing the answer.
  await waitFor(() => expect(numberBox().value).toBe('WS-10003'))
}

function numberBox(): HTMLInputElement {
  return screen.getByLabelText(/Slip number/) as HTMLInputElement
}

/** Puts a book with WS-10002 in it behind the arrows. */
function seedBook(): void {
  api.wholesaleNeighbours.mockImplementation(async () => BOOK)
  api.wholesaleLoadAsDraft.mockImplementation(async (invoiceNumber: number) =>
    invoiceNumber === 10_002 ? CHAIN : null,
  )
}

/** Types a gross weight into the first row, which is what makes a slip dirty. */
async function typeARow(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Item name row 1'), 'BANGLE')
  await waitFor(() => expect(control('wholesale.nav.prev').disabled).toBe(false))
}

describe('no dead buttons on the wholesale toolbar', () => {
  it('resolves every control to a registry entry, disabled ones included', async () => {
    await openWholesale()
    const registry = createActionRegistry(stubContext())

    const dangling = Array.from(document.querySelectorAll('button'))
      .map((button) => button.getAttribute('data-action') as ActionId)
      .filter((id) => !(id in registry))
    expect(dangling).toEqual([])
  })
})

describe('the four navigation controls', () => {
  it('renders all four, disabled rather than hidden, on an empty book', async () => {
    await openWholesale()
    for (const id of [
      'wholesale.nav.first',
      'wholesale.nav.prev',
      'wholesale.nav.next',
      'wholesale.nav.last',
    ] as const) {
      expect(control(id).disabled).toBe(true)
      // A READY control at an edge, and it says so in the DOM — that is what
      // separates it from a button somebody forgot to wire.
      expect(control(id).getAttribute('data-unavailable')).toBe('true')
    }
  })

  it('asks the book where it can go from the slip being typed', async () => {
    await openWholesale()
    await waitFor(() => expect(api.wholesaleNeighbours).toHaveBeenCalled())
    // Null: a slip that has not been posted sits one PAST the end of the book.
    expect(api.wholesaleNeighbours).toHaveBeenCalledWith(null, false)
  })

  it('opens the newest slip on PREV, and asks the book again from there', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()

    await waitFor(() => expect(control('wholesale.nav.prev').disabled).toBe(false))
    await user.click(control('wholesale.nav.prev'))

    await screen.findByText(/WS-10002/)
    expect(api.wholesaleLoadAsDraft).toHaveBeenCalledWith(10_002)
    await waitFor(() => expect(api.wholesaleNeighbours).toHaveBeenCalledWith(10_002, false))
  })
})

describe('a posted slip opens locked', () => {
  it('refuses to be typed into, and offers EDIT instead', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await waitFor(() => expect(control('wholesale.nav.prev').disabled).toBe(false))
    await user.click(control('wholesale.nav.prev'))
    await screen.findByText(/WS-10002/)

    expect(control('wholesale.save').disabled).toBe(true)
    expect((screen.getByLabelText('Item name row 1') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Gold rate per tola') as HTMLInputElement).disabled).toBe(true)
    expect(control('wholesale.edit').disabled).toBe(false)
  })

  it('shows what was typed on it, not something worked backwards out of a total', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await waitFor(() => expect(control('wholesale.nav.prev').disabled).toBe(false))
    await user.click(control('wholesale.nav.prev'))
    await screen.findByText(/WS-10002/)

    expect((screen.getByLabelText('Item name row 1') as HTMLInputElement).value).toBe(
      'SINGAPORI CHAIN',
    )
    expect((screen.getByLabelText('Gross weight row 1') as HTMLInputElement).value).toBe(
      '254.200',
    )
    expect((screen.getByLabelText('Katt row 1') as HTMLInputElement).value).toBe('13.000')
    // The rate it was PRICED at, pinned — not today's.
    expect((screen.getByLabelText('Gold rate per tola') as HTMLInputElement).value).toBe(
      '237,970.00',
    )
  })

  it('unlocks for a correction, and says the original still stands', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await waitFor(() => expect(control('wholesale.nav.prev').disabled).toBe(false))
    await user.click(control('wholesale.nav.prev'))
    await screen.findByText(/WS-10002/)

    await user.click(control('wholesale.edit'))

    expect(control('wholesale.save').disabled).toBe(false)
    expect((screen.getByLabelText('Item name row 1') as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByText(/NEW slip with a new number/)).toBeTruthy()
  })
})

describe('the slip-number box', () => {
  it('opens that slip when the number is one that exists', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()

    const box = numberBox()
    await user.clear(box)
    await user.type(box, '10002{Enter}')

    await screen.findByText(/WS-10002/)
    expect(api.wholesaleLoadAsDraft).toHaveBeenCalledWith(10_002)
  })

  it('takes the number with or without the prefix on it', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()

    const box = numberBox()
    await user.clear(box)
    await user.type(box, 'WS-10002{Enter}')

    await waitFor(() => expect(api.wholesaleLoadAsDraft).toHaveBeenCalledWith(10_002))
  })

  it('says so and does NOT navigate when the number is unknown', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()

    const box = numberBox()
    await user.clear(box)
    await user.type(box, '99999{Enter}')

    await screen.findByText('No slip 99999.')
    // Still on the slip being typed: landing somewhere unasked-for is worse
    // than not moving.
    expect(screen.queryByText(/WS-10002 ·/)).toBeNull()
  })
})

describe('the unsaved-changes guard', () => {
  it('does not ask when nothing has been typed', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await waitFor(() => expect(control('wholesale.nav.prev').disabled).toBe(false))

    await user.click(control('wholesale.nav.prev'))
    await screen.findByText(/WS-10002/)
    expect(screen.queryByText('Save this slip first?')).toBeNull()
  })

  it('stops a navigation once a row has been typed, and offers three answers', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await typeARow(user)

    await user.click(control('wholesale.nav.prev'))

    await screen.findByText('Save this slip first?')
    expect(control('wholesale.guard.cancel').disabled).toBe(false)
    expect(control('wholesale.guard.discard').disabled).toBe(false)
    expect(control('wholesale.guard.save').disabled).toBe(false)
    // Nothing has moved while the question is up.
    expect(api.wholesaleLoadAsDraft).not.toHaveBeenCalled()
  })

  it('stays exactly where it was when the answer is Stay here', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await typeARow(user)
    await user.click(control('wholesale.nav.prev'))
    await screen.findByText('Save this slip first?')

    await user.click(control('wholesale.guard.cancel'))

    expect(screen.queryByText('Save this slip first?')).toBeNull()
    expect(api.wholesaleLoadAsDraft).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Item name row 1') as HTMLInputElement).value).toBe('BANGLE')
  })

  it('throws the rows away and goes when the answer is Discard', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await typeARow(user)
    await user.click(control('wholesale.nav.prev'))
    await screen.findByText('Save this slip first?')

    await user.click(control('wholesale.guard.discard'))

    await waitFor(() => expect(api.wholesaleLoadAsDraft).toHaveBeenCalledWith(10_002))
    expect(api.postIssue).not.toHaveBeenCalled()
  })

  /**
   * The answer that must not lose the rows.
   *
   * "Save, then go" on a slip with no party chosen is a save that gets REFUSED.
   * Navigating anyway would make the dialog that exists to protect the rows the
   * thing that throws them away, so the screen stays exactly where it is and
   * says why.
   */
  it('does not go when the save is refused', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await typeARow(user)
    await user.click(control('wholesale.nav.prev'))
    await screen.findByText('Save this slip first?')

    await user.click(control('wholesale.guard.save'))

    await screen.findByText('Choose a party before saving.')
    expect(api.postIssue).not.toHaveBeenCalled()
    expect(api.wholesaleLoadAsDraft).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Item name row 1') as HTMLInputElement).value).toBe('BANGLE')
  })

  it('stops NEW as well, because NEW loses the rows just as thoroughly', async () => {
    seedBook()
    const user = userEvent.setup()
    await openWholesale()
    await typeARow(user)

    await user.click(control('wholesale.new'))

    await screen.findByText('Save this slip first?')
    expect((screen.getByLabelText('Item name row 1') as HTMLInputElement).value).toBe('BANGLE')
  })
})
