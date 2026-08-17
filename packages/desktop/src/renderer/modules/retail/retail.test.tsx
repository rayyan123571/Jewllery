/**
 * @vitest-environment jsdom
 */
import {
  Money,
  Weight,
  computeRetailLine,
  formatGram,
  formatPurity,
  formatTola,
  parsePurity,
  parseTola,
} from '@jewellery/domain'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'
import { createActionRegistry, type ActionContext, type ActionId } from '../../actions/registry.js'
import type {
  RetailBillCalculateRequest,
  RetailBillCalculationDto,
  RetailBillDraftDto,
  RetailCalculationDto,
  RetailItemDto,
  RetailLineDto,
  RetailSlipDto,
  WeightFieldDto,
  WeightUnit,
} from '../../../shared/ipc.js'

/**
 * The retail screen, with a main process that actually computes.
 *
 * The fake `retailCalculate` below is not a stub returning canned strings — it
 * runs the REAL `computeRetailLine` and the real Weight parsers over the
 * request, exactly as the handler in main does. That matters for one test in
 * particular: the Gram ⇄ Tola toggle can only be proved lossless against
 * arithmetic that is genuinely lossy, and a stub that echoed whatever it was
 * given would pass whether the toggle was safe or not.
 *
 * Three things are checked here:
 *
 *   1. **No dead buttons.** Every control on the screen resolves to a registry
 *      entry, and its disabled state matches what the registry says.
 *   2. **Edit-in-place is refused, not silently dropped.** The highest-risk
 *      behaviour on this screen.
 *   3. **The unit toggle leaves stored values byte-identical.** Not "close" —
 *      identical, to the milligram, after any number of flips.
 */

const RATE = Money.parse('237970')

function weightOf(field: WeightFieldDto, unit: WeightUnit): Weight {
  if (field.exactMg !== null) return Weight.fromMilligrams(field.exactMg)
  const text = field.text.trim()
  if (text === '') return Weight.ZERO
  return unit === 'tola' ? parseTola(text) : Weight.parse(text)
}

function weightDto(weight: Weight) {
  return { mg: weight.milligrams, gram: formatGram(weight), tola: formatTola(weight) }
}

function moneyDto(amount: Money) {
  return { paisa: amount.paisa, rupees: amount.format(), whole: amount.formatWhole() }
}

function moneyOf(text: string): Money {
  const trimmed = text.trim()
  if (trimmed === '') return Money.ZERO
  try {
    return Money.parse(trimmed)
  } catch {
    return Money.ZERO
  }
}

function lineOf(item: RetailItemDto, unit: WeightUnit): RetailLineDto {
  const computed = computeRetailLine(
    {
      itemName: item.itemName,
      grossWeight: weightOf(item.grossWeight, unit),
      stoneWeight: weightOf(item.stoneWeight, unit),
      purityDeduction: weightOf(item.purityDeduction, unit),
      wastageBp: moneyOf(item.wastagePercent).paisa,
      labourCharges: moneyOf(item.labourCharges),
      labourMode: item.labourMode === 'per_tola' ? 'per_tola' : 'fixed',
      stoneCharges: moneyOf(item.stoneCharges),
      ratePerTola: RATE,
    },
    { direction: 'add', basis: 'net' },
  )
  const purity = parsePurity(item.purity)
  return {
    itemName: computed.itemName,
    purity: formatPurity(purity),
    purityCode: purity,
    gross: weightDto(computed.grossWeight),
    stone: weightDto(computed.stoneWeight),
    purityDeduction: weightDto(computed.purityDeduction),
    purityDeductionPercent: '0.00',
    rateDisplay: RATE.formatWhole(),
    net: weightDto(computed.netWeight),
    wastagePercent: (computed.wastageBp / 100).toFixed(2),
    wastage: weightDto(computed.wastage),
    fine: weightDto(computed.fineWeight),
    labour: moneyDto(computed.labourAmount),
    labourMode: computed.labourMode,
    stoneCharges: moneyDto(computed.stoneCharges),
    amount: moneyDto(computed.lineAmount),
    error: null,
  }
}

/** Every bill-calculate request the screen made, newest last. */
const requests: RetailBillCalculateRequest[] = []

/**
 * One slip, computed the way main computes it.
 *
 * Still the REAL `computeRetailLine` over the real parsers — which is what makes
 * the unit-toggle test meaningful. A stub echoing what it was handed would pass
 * whether or not the toggle was lossless.
 */
function calculateSlip(
  slip: RetailSlipDto,
  unit: WeightUnit,
): RetailCalculationDto {
  const lines = slip.items.map((item) => lineOf(item, unit))
  const totalFine = Weight.sum(lines.map((line) => Weight.fromMilligrams(line.fine.mg)))
  const itemsTotal = Money.sum(lines.map((line) => Money.fromPaisa(line.amount.paisa)))
  const paid = moneyOf(slip.amountPaid)
  return {
    lines,
    totalFine: weightDto(totalFine),
    customerGold: weightDto(weightOf(slip.customerGold, unit)),
    remainingGold: weightDto(totalFine),
    goldValue: moneyDto(Money.valueOfAtTolaRate(totalFine, RATE)),
    totalLabour: moneyDto(Money.ZERO),
    totalStone: moneyDto(Money.ZERO),
    itemsTotal: moneyDto(itemsTotal),
    hallmarkCharges: moneyDto(Money.ZERO),
    otherCharges: moneyDto(Money.ZERO),
    discount: moneyDto(Money.ZERO),
    customerGoldValue: moneyDto(Money.ZERO),
    invoiceTotal: moneyDto(itemsTotal),
    grandTotal: moneyDto(itemsTotal),
    amountPaid: moneyDto(paid),
    balance: moneyDto(itemsTotal.minus(paid)),
    amountInWords: 'Rupees Zero Only',
    ratePerTola: moneyDto(RATE),
    rateDisplay: RATE.formatWhole(),
    rateMissing: false,
    wastageRuleLabel: 'Polish added to net weight, calculated on net weight',
    warnings: [],
  }
}

function calculateBill(request: RetailBillCalculateRequest): RetailBillCalculationDto {
  requests.push(request)
  const unit: WeightUnit = request.draft.weightUnit === 'tola' ? 'tola' : 'gram'
  const slips = request.draft.slips.map((slip) => {
    const calculation = calculateSlip(slip, unit)
    return {
      slipNo: slip.slipNo,
      slipLabel: slip.slipLabel,
      calculation,
      total: calculation.invoiceTotal.rupees,
    }
  })
  const active =
    slips.find((slip) => slip.slipNo === request.activeSlipNo)?.calculation ??
    (slips[0]?.calculation as RetailCalculationDto)
  return {
    slips,
    active,
    billTotal: moneyDto(
      Money.sum(slips.map((slip) => Money.fromPaisa(slip.calculation.invoiceTotal.paisa))),
    ),
    rateDisplay: RATE.formatWhole(),
    rateMissing: false,
  }
}

const retailBillSave = vi.fn(async (_request: { draft: RetailBillDraftDto }) => ({
  ok: true as const,
  billId: 'bill-1',
  billNo: 'RB-00001',
  slips: [
    { slipNo: 1, slipLabel: 'Full Bill', saleId: 'sale-1', invoiceNo: '1' },
  ],
  billTotal: '1,102,596.13',
}))

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
  nextInvoiceNo: vi.fn(async () => 'WS-10001'),
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
  // The wholesale screen walks its slip book on mount, exactly as the retail
  // screen walks the invoice book. An empty book is enough here: this suite is
  // about which controls exist and whether they are wired.
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
  retailBillCalculate: vi.fn(async (request: RetailBillCalculateRequest) =>
    calculateBill(request),
  ),
  retailBillSave,
  retailBillNextNo: vi.fn(async () => 'RB-00001'),
  retailDraftSave: vi.fn(async () => ({ ok: true as const })),
  retailDraftFind: vi.fn(async () => null),
  retailDraftDiscard: vi.fn(async () => ({ ok: true as const })),
  retailBillReceipt: vi.fn(async () => null),
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
  // Typed loosely on purpose: individual tests give the mock a real book to
  // walk, and a literal-null default would fix the type at `null`.
  retailNeighbours: vi.fn(
    async () =>
      ({ first: null, previous: null, next: null, last: null }) as {
        first: { number: number; display: string } | null
        previous: { number: number; display: string } | null
        next: { number: number; display: string } | null
        last: { number: number; display: string } | null
      },
  ),
  retailLoadAsDraft: vi.fn(async (_invoiceNumber: number) => null as unknown),
  retailReceipt: vi.fn(async () => null),
  searchCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  listSalesmen: vi.fn(async () => []),
  retailWastageRule: vi.fn(),
  setRetailWastageRule: vi.fn(),
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
  requests.length = 0
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function control(id: ActionId): HTMLButtonElement {
  const found = document.querySelector(`[data-action="${id}"]`)
  if (!found) throw new Error(`No control for ${id}`)
  return found as HTMLButtonElement
}

/**
 * The item COLUMNS that hold a real item.
 *
 * The card always draws at least four slots so an empty slip reads as a place
 * items go; the filled ones are what the assertions are about.
 */
function itemColumns(): HTMLElement[] {
  // The trailing blank column is an invitation, not an item.
  return Array.from(
    document.querySelectorAll<HTMLElement>('.item-column:not(.is-blank)'),
  )
}

/**
 * One cell of one item column.
 *
 * Items render as columns, not rows: the left-most column is a fixed label
 * stack and each item is a column beside it. So a cell is addressed by WHICH
 * ITEM and WHICH ROW, and the row order is the mockup's, top to bottom.
 *
 * Queries are scoped to the column rather than to the document because the same
 * figures legitimately appear more than once on this screen — in the column, in
 * DETAILS and in the SUMMARY — and that is the point of the screen, not a
 * duplication to assert around.
 */
const ROW = {
  item: 0,
  gross: 1,
  stone: 2,
  deduction: 3,
  net: 4,
  polishPercent: 5,
  polish: 6,
  labour: 7,
  stoneCharges: 8,
  rate: 9,
  amount: 10,
} as const

/**
 * What a cell SHOWS.
 *
 * Editable cells are inputs now, so their value is in `.value` and not in the
 * text content — a helper that only read textContent would report every typed
 * figure as an empty string and quietly pass any assertion for ''.
 */
function cell(columnIndex: number, row: keyof typeof ROW): string {
  const column = itemColumns()[columnIndex]
  if (!column) throw new Error(`No item column ${columnIndex}.`)
  const cells = column.querySelectorAll('.item-column__cell')
  const found = cells[ROW[row]]
  if (!found) return ''
  const input = found.querySelector('input')
  return (input ? input.value : (found.textContent ?? '')).trim()
}

/** Opens the retail screen the way an operator does. */
async function openRetail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Sale (Retail)'))
  // The label stack of the items grid. There is no DETAILS card to wait for
  // any more — the grid IS the form.
  await screen.findByText('Item Name')
}

/**
 * Types one item into the grid, the way an operator does: into the trailing
 * blank column, name then Enter then weight.
 *
 * Deliberately keyboard-only past the first click. If the keyboard model breaks,
 * every test that adds an item fails — which is the point: this grid is worked
 * two-handed at a counter and a mouse-driven test would not notice.
 */
async function addItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  grams: string,
): Promise<void> {
  const blank = itemColumns().length + 1
  await user.click(screen.getByLabelText(`Item ${blank} name`))
  await user.keyboard(name)
  await waitFor(() => expect(screen.getByLabelText(`Item ${blank} weight`)).toBeTruthy())
  await user.keyboard('{Enter}')
  await user.keyboard(grams)
}

describe('no dead buttons on the retail screen', () => {
  it('gives every button a data-action that resolves to a registry entry', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    const registry = createActionRegistry(stubContext())

    const orphans = Array.from(document.querySelectorAll('button'))
      .filter((button) => !button.getAttribute('data-action'))
      .map((button) => button.textContent?.trim() || button.outerHTML.slice(0, 100))
    expect(orphans).toEqual([])

    const dangling = Array.from(document.querySelectorAll('button'))
      .map((button) => button.getAttribute('data-action') as ActionId)
      .filter((id) => !(id in registry))
    expect(dangling).toEqual([])
  })

  it('disables exactly the controls the registry says are not built', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    const registry = createActionRegistry(stubContext())

    const mismatched = Array.from(document.querySelectorAll('button'))
      .map((button) => {
        const id = button.getAttribute('data-action') as ActionId
        // A control may also be disabled because it has nothing to act on right
        // now — PREV on the first invoice. That is a READY control at an edge,
        // and it says so in the DOM, so it is not a dead button.
        if (button.getAttribute('data-unavailable') === 'true') return null
        const expected = registry[id].kind === 'not-built'
        return expected === button.disabled ? null : `${id}: expected disabled=${expected}`
      })
      .filter((problem): problem is string => problem !== null)
    expect(mismatched).toEqual([])
  })

  it('has every retail control live now that the module is built', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    for (const id of [
      'retail.save',
      'retail.print',
      'retail.new',
      'retail.item.add',
      'retail.unit.toggle',
      'retail.customer.add',
      'retail.labour.mode',
      'quick.retail-whatsapp',
    ] as const) {
      expect(control(id).disabled).toBe(false)
    }
  })

  it('draws ONE blank column on an empty bill, not four placeholders', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    // One column, and it is the blank one. Padding the grid out to four says
    // nothing about how many items are on the bill and makes the header count
    // meaningless — the operator would have to count the filled ones.
    expect(document.querySelectorAll('.item-column')).toHaveLength(1)
    expect(document.querySelectorAll('.item-column.is-blank')).toHaveLength(1)
    expect(itemColumns()).toHaveLength(0)
    expect(screen.getByText('ITEMS — 0')).toBeTruthy()
    expect(control('retail.item.add').textContent).toContain('ADD ITEM')
  })
})


/**
 * Flips the toggle and waits for the DRAFT to come back round.
 *
 * Waiting on the rendered cell alone is not enough and the difference matters:
 * the cell changes the instant the toggle is pressed, because the renderer
 * simply picks the other string out of a DTO it already has. What has to be
 * checked is the draft the NEXT save would carry, and that only exists once the
 * 120 ms debounce has fired and main has answered.
 */
async function flipUnit(
  user: ReturnType<typeof userEvent.setup>,
  expected: WeightUnit,
): Promise<void> {
  await user.click(control('retail.unit.toggle'))
  await waitFor(() => expect(lastRequest().draft.weightUnit).toBe(expected))
}

/**
 * Slips, on the screen.
 *
 * The mockup's tabs are not decoration: each one is a separate printable
 * document under one bill, and the screen has to keep their items apart while
 * sharing the customer between them.
 */
describe('one invoice, one set of items', () => {
  it('shows no slip tabs, no add-slip and no delete-slip control', () => {
    // The tab strip is GONE, not hidden. A counter serves one customer and one
    // invoice at a time, and a strip offering to split the bill into documents
    // is a question nobody at this counter is asking.
    expect(document.querySelector('.slip-tabs')).toBeNull()
    expect(document.querySelector('.slip-tab')).toBeNull()
  })

  it('still sends exactly one slip, so the atomic post is unchanged', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')

    // Waits on the ITEM, not on the slip count — the slip count is 1 from the
    // first render, so waiting on it races the calculate debounce and reads the
    // request that went out before the item was added.
    await waitFor(() =>
      expect(lastRequest().draft.slips[0]?.items.map((i) => i.itemName)).toEqual([
        'BANGLE',
      ]),
    )
    const slip = lastRequest().draft.slips[0]
    // Slip 1, 'Full Bill' — the implicit slip every invoice now carries. The
    // schema still stores a bill wrapping a slip, which is what keeps the
    // all-or-nothing transaction downstream reachable.
    expect(slip?.slipNo).toBe(1)
    expect(slip?.slipLabel).toBe('Full Bill')
  })

  it('saves the whole bill through one call', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await waitFor(() => expect(lastRequest().draft.slips).toHaveLength(1))

    await user.click(control('retail.save'))
    await waitFor(() => expect(retailBillSave).toHaveBeenCalledTimes(1))
    expect(lastRequest().draft.slips).toHaveLength(1)
  })

  it('carries the customer on the bill, not copied onto the slip', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await user.type(screen.getByLabelText('Customer'), 'IMRAN SAHIB')

    await waitFor(() => expect(lastRequest().draft.customerName).toBe('IMRAN SAHIB'))
    expect(lastRequest().draft.slips).toHaveLength(1)
  })
})

/**
 * The screen opens in TOLA, because that is the unit the mockup labels every
 * weight row with and the unit this trade quotes in. These tests start by
 * flipping to grams: the scenario they exist to prove is that 47.240 g and
 * 4.050 tola are the same stored weight and that moving between the two costs
 * nothing, which needs the gram figure to be the one that was typed.
 */
async function openRetailInGrams(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await openRetail(user)
  await flipUnit(user, 'gram')
}

describe('the Gram ⇄ Tola toggle converts what is displayed and nothing else', () => {
  it('opens in tola, the unit the trade quotes', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await waitFor(() => expect(lastRequest().draft.weightUnit).toBe('tola'))
    expect(screen.getByText('Weight (Tola)')).toBeTruthy()
  })

  it('leaves the stored milligrams byte-identical across four flips', async () => {
    const user = userEvent.setup()
    await openRetailInGrams(user)
    await addItem(user, 'BANGLE', '47.240')

    await waitFor(() => expect(storedGrossMg()).toBe(47_240))

    for (const unit of ['tola', 'gram', 'tola', 'gram'] as const) {
      await flipUnit(user, unit)
      expect(storedGrossMg()).toBe(47_240)
    }

    // Four flips is an even number, so the display is back in grams — and the
    // stored weight never moved at any point in between.
    expect(storedGrossMg()).toBe(47_240)
    expect(cell(0, 'gross')).toBe('47.240')
  })

  it('shows tola on the odd flip and gram on the even one', async () => {
    const user = userEvent.setup()
    await openRetailInGrams(user)
    await addItem(user, 'BANGLE', '47.240')
    // Waits on a DERIVED cell, not the typed one: the typed value is there the
    // instant it is keyed, while the flip needs main's computed milligrams.
    await waitFor(() => expect(cell(0, 'net')).not.toBe('0.000'))

    // 47.240 g is 4.050 tola. The screen converted nothing: main sent both.
    await flipUnit(user, 'tola')
    expect(cell(0, 'gross')).toBe('4.050')
    expect(storedGrossMg()).toBe(47_240)

    await flipUnit(user, 'gram')
    expect(cell(0, 'gross')).toBe('47.240')
    expect(storedGrossMg()).toBe(47_240)
  })

  it('would have lost a milligram per flip if the text had been re-parsed', async () => {
    const user = userEvent.setup()
    await openRetailInGrams(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(storedGrossMg()).toBe(47_240))

    await flipUnit(user, 'tola')

    // This is the bug the exactMg field exists to prevent, stated as an
    // assertion: re-reading the displayed "4.050" as a weight gives 47,239 mg,
    // one milligram short of what is actually stored. The draft carries the
    // exact milligram instead, so nothing is ever re-read.
    expect(cell(0, 'gross')).toBe('4.050')
    expect(parseTola('4.050').milligrams).toBe(47_239)
    expect(activeSlipDraft().items[0]?.grossWeight.exactMg).toBe(47_240)
    expect(storedGrossMg()).toBe(47_240)
  })

  it('carries the exact milligram on the advance gold field too', async () => {
    const user = userEvent.setup()
    await openRetailInGrams(user)
    await user.type(screen.getByLabelText('Advance gold'), '11.664')
    await waitFor(() =>
      expect(activeSlipDraft().customerGold.text).toBe('11.664'),
    )

    await flipUnit(user, 'tola')
    // 11.664 g is exactly one tola, and the exact milligram travels with it.
    expect(activeSlipDraft().customerGold).toEqual({ text: '1.000', exactMg: 11_664 })
  })
})

function lastRequest(): RetailBillCalculateRequest {
  const request = requests[requests.length - 1]
  if (!request) throw new Error('The screen never asked main to calculate anything.')
  return request
}

/** The slip the screen is showing, as the NEXT save would carry it. */
function activeSlipDraft(): RetailSlipDto {
  const request = lastRequest()
  const slip = request.draft.slips.find((s) => s.slipNo === request.activeSlipNo)
  if (!slip) throw new Error('No active slip in the draft.')
  return slip
}

/** What the NEXT save would carry for line 1's gross weight, in milligrams. */
function storedGrossMg(): number {
  const field = activeSlipDraft().items[0]?.grossWeight
  if (!field) throw new Error('No line 1 in the draft.')
  return weightOf(field, lastRequest().draft.weightUnit).milligrams
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


/**
 * The guard, and the box that finds an old bill.
 *
 * `retail_draft_bills` holds ONE draft per branch, so navigating away from an
 * unsaved bill destroys it rather than parking it. Every one of these tests is
 * about that: the arrows, the jump box and NEW must all stop and ask, and the
 * question must have three real answers.
 */
describe('the unsaved-changes guard', () => {
  /** A book of three invoices, so PREV and FIRST are reachable. */
  function aBookOfThree(): void {
    api.retailNeighbours.mockResolvedValue({
      first: { number: 1, display: '1' },
      previous: { number: 3, display: '3' },
      next: null,
      last: { number: 3, display: '3' },
    })
    api.retailLoadAsDraft.mockResolvedValue({
      saleId: 'sale-3',
      invoiceNumber: 3,
      invoiceNo: '3',
      status: 'posted',
      voidReason: null,
      slipCount: 1,
      draft: {
        saleDate: '2026-08-30',
        saleTime: '12:48',
        customerId: null,
        customerName: 'IMRAN SAHIB',
        customerMobile: '03001234567',
        ratePurity: 'K22',
        ratePerTolaOverride: '237970.00',
        weightUnit: 'tola',
        slips: [
          {
            slipNo: 1,
            slipLabel: 'Full Bill',
            draftId: 'draft-3',
            items: [],
            customerGold: { text: '', exactMg: null },
            customerGoldPurity: 'K22',
            hallmarkCharges: '',
            otherCharges: '',
            discount: '',
            amountPaid: '',
            paymentMethod: 'cash',
            remarks: null,
          },
        ],
      },
    })
  }

  it('does not ask when nothing has been changed', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await waitFor(() => expect(control('retail.nav.prev').disabled).toBe(false))

    await user.click(control('retail.nav.prev'))

    // Straight there. A guard that asks on an untouched bill is one the
    // operator learns to click through without reading.
    await waitFor(() => expect(api.retailLoadAsDraft).toHaveBeenCalledWith(3))
    expect(screen.queryByText('Save this invoice first?')).toBeNull()
  })

  it('stops every navigation Action and asks first', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await waitFor(() => expect(control('retail.nav.prev').disabled).toBe(false))

    await user.click(control('retail.nav.prev'))

    expect(await screen.findByText('Save this invoice first?')).toBeTruthy()
    // Nothing moved while the question is up.
    expect(api.retailLoadAsDraft).not.toHaveBeenCalled()
  })

  it('stops NEW as well, because NEW loses the bill just as thoroughly', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')

    await user.click(control('retail.new'))

    expect(await screen.findByText('Save this invoice first?')).toBeTruthy()
  })

  it('offers three real answers, Cancel among them', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await user.click(control('retail.nav.prev'))
    await screen.findByText('Save this invoice first?')

    // Cancel is a control pressed on purpose, not Escape-and-hope.
    expect(control('retail.guard.cancel').disabled).toBe(false)
    expect(control('retail.guard.discard').disabled).toBe(false)
    expect(control('retail.guard.save').disabled).toBe(false)
  })

  it('stays exactly where it was when the answer is Cancel', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await user.click(control('retail.nav.prev'))
    await screen.findByText('Save this invoice first?')

    await user.click(control('retail.guard.cancel'))

    await waitFor(() => expect(screen.queryByText('Save this invoice first?')).toBeNull())
    expect(api.retailLoadAsDraft).not.toHaveBeenCalled()
    // The work is still on screen.
    expect(itemColumns()).toHaveLength(1)
  })

  it('throws the changes away and goes when the answer is Discard', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await user.click(control('retail.nav.prev'))
    await screen.findByText('Save this invoice first?')

    await user.click(control('retail.guard.discard'))

    // The draft is cleared on the way out, so nothing comes back offering to
    // resume a bill the operator has just said to throw away.
    await waitFor(() => expect(api.retailDraftDiscard).toHaveBeenCalled())
    await waitFor(() => expect(api.retailLoadAsDraft).toHaveBeenCalledWith(3))
  })

  it('saves first, then goes, when the answer is Save', async () => {
    const user = userEvent.setup()
    aBookOfThree()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await user.click(control('retail.nav.prev'))
    await screen.findByText('Save this invoice first?')

    await user.click(control('retail.guard.save'))

    await waitFor(() => expect(retailBillSave).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.retailLoadAsDraft).toHaveBeenCalledWith(3))
  })
})

describe('the invoice-number jump', () => {
  function jumpBox(): HTMLInputElement {
    return screen.getByLabelText(
      'Invoice number — type one and press Enter to open it',
    ) as HTMLInputElement
  }

  it('opens that invoice when the number is one that exists', async () => {
    const user = userEvent.setup()
    api.retailLoadAsDraft.mockResolvedValue({
      saleId: 'sale-4',
      invoiceNumber: 4,
      invoiceNo: '4',
      status: 'posted',
      voidReason: null,
      slipCount: 1,
      draft: {
        saleDate: '2026-08-30',
        saleTime: '12:48',
        customerId: null,
        customerName: 'IMRAN SAHIB',
        customerMobile: '',
        ratePurity: 'K22',
        ratePerTolaOverride: '237970.00',
        weightUnit: 'tola',
        slips: [
          {
            slipNo: 1,
            slipLabel: 'Full Bill',
            draftId: 'draft-4',
            items: [],
            customerGold: { text: '', exactMg: null },
            customerGoldPurity: 'K22',
            hallmarkCharges: '',
            otherCharges: '',
            discount: '',
            amountPaid: '',
            paymentMethod: 'cash',
            remarks: null,
          },
        ],
      },
    })
    await openRetail(user)

    await user.clear(jumpBox())
    await user.type(jumpBox(), '4{Enter}')

    await waitFor(() => expect(api.retailLoadAsDraft).toHaveBeenCalledWith(4))
  })

  it('says so and does NOT navigate when the number is unknown', async () => {
    const user = userEvent.setup()
    api.retailLoadAsDraft.mockResolvedValue(null)
    await openRetail(user)

    await user.clear(jumpBox())
    await user.type(jumpBox(), '999{Enter}')

    // A message beside the box, and the screen stays where it was. Landing on
    // something the operator did not ask for is worse than not moving.
    expect(await screen.findByText('No invoice 999.')).toBeTruthy()
    expect(screen.queryByText(/read-only/)).toBeNull()
  })

  it('refuses anything that is not a number, without navigating', async () => {
    const user = userEvent.setup()
    await openRetail(user)

    await user.clear(jumpBox())
    await user.type(jumpBox(), 'abc{Enter}')

    expect(await screen.findByText('Numbers only.')).toBeTruthy()
    expect(api.retailLoadAsDraft).not.toHaveBeenCalled()
  })

  it('goes through the guard too, so a jump cannot skip the question', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')

    await user.clear(jumpBox())
    await user.type(jumpBox(), '4{Enter}')

    expect(await screen.findByText('Save this invoice first?')).toBeTruthy()
    expect(api.retailLoadAsDraft).not.toHaveBeenCalled()
  })
})
