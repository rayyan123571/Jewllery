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
  entry: RetailItemDto | null,
): RetailCalculationDto {
  const lines = slip.items.map((item) => lineOf(item, unit))
  const totalFine = Weight.sum(lines.map((line) => Weight.fromMilligrams(line.fine.mg)))
  const itemsTotal = Money.sum(lines.map((line) => Money.fromPaisa(line.amount.paisa)))
  const paid = moneyOf(slip.amountPaid)
  return {
    lines,
    entry: entry ? lineOf(entry, unit) : null,
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
    const calculation = calculateSlip(
      slip,
      unit,
      slip.slipNo === request.activeSlipNo ? request.entry : null,
    )
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
  retailBillAddSlip: vi.fn(),
  retailBillDeleteSlip: vi.fn(),
  retailBillReceipt: vi.fn(async () => null),
  retailSave: vi.fn(),
  retailHold: vi.fn(),
  retailLoad: vi.fn(async () => null),
  retailList: vi.fn(async () => []),
  retailVoid: vi.fn(),
  retailNextInvoiceNo: vi.fn(async () => '1'),
  retailReceipt: vi.fn(async () => null),
  searchCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  listSalesmen: vi.fn(async () => []),
  retailWastageRule: vi.fn(),
  setRetailWastageRule: vi.fn(),
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
/** The nth slip tab, by position — "Slip 2" is both a tab name and a label. */
function slipTab(slipNo: number): HTMLElement {
  const tabs = document.querySelectorAll<HTMLElement>('.slip-tab:not(.slip-tab--add)')
  const tab = tabs[slipNo - 1]
  if (!tab) throw new Error(`No slip tab ${slipNo}.`)
  return tab
}

function itemColumns(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.item-column:not(.is-empty)'),
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
  rate: 7,
  amount: 8,
} as const

function cell(columnIndex: number, row: keyof typeof ROW): string {
  const column = itemColumns()[columnIndex]
  if (!column) throw new Error(`No item column ${columnIndex}.`)
  const cells = column.querySelectorAll('.item-column__cell')
  return (cells[ROW[row]]?.textContent ?? '').trim()
}

/** Opens the retail screen the way an operator does. */
async function openRetail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Sale (Retail)'))
  await screen.findByText('DETAILS (SELECTED ITEM)')
}

/** Types one item into DETAILS and adds it to the active slip. */
async function addItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  grams: string,
): Promise<void> {
  await user.clear(screen.getByLabelText('Item name'))
  await user.type(screen.getByLabelText('Item name'), name)
  await user.clear(screen.getByLabelText('Gross weight'))
  await user.type(screen.getByLabelText('Gross weight'), grams)
  await user.click(control('retail.item.add'))
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
      'retail.slip.add',
      'retail.item.clear',
      'retail.unit.toggle',
      'retail.customer.add',
      'retail.labour.mode',
      'quick.retail-whatsapp',
    ] as const) {
      expect(control(id).disabled).toBe(false)
    }
  })

  it('draws the mockup’s four item slots on an empty slip, and offers ADD ITEM', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    // Four slots, none of them holding an item yet — a place items go rather
    // than a blank card.
    expect(document.querySelectorAll('.item-column')).toHaveLength(4)
    expect(itemColumns()).toHaveLength(0)
    expect(control('retail.item.add').textContent).toContain('ADD ITEM')
  })
})

describe('edit in place is resolved, never silently dropped', () => {
  it('refuses to save while a line is open for editing', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(cell(0, 'item')).toContain('BANGLE'))

    await user.click(screen.getByLabelText('Edit item 1'))
    // The row says so, and the button changes what it promises.
    expect(within(itemColumns()[0] as HTMLElement).getByText('editing')).toBeTruthy()
    expect(control('retail.item.add').textContent).toContain('UPDATE ITEM')

    await user.click(control('retail.save'))

    // Nothing was posted, and the operator was told why in words they can act on.
    expect(retailBillSave).not.toHaveBeenCalled()
    expect(await screen.findByText(/open for editing/)).toBeTruthy()
    expect(screen.getByText(/Saving now would drop what you have typed/)).toBeTruthy()
  })

  it('writes the edit back over the same line rather than adding a second', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(cell(0, 'item')).toContain('BANGLE'))

    await user.click(screen.getByLabelText('Edit item 1'))
    await user.clear(screen.getByLabelText('Gross weight'))
    await user.type(screen.getByLabelText('Gross weight'), '11.664')
    await user.click(control('retail.item.add'))

    await waitFor(() => expect(cell(0, 'gross')).toBe('11.664'))
    expect(itemColumns()).toHaveLength(1)
    expect(screen.queryByText('editing')).toBeNull()
    // And the save it refused a moment ago now goes through.
    await user.click(control('retail.save'))
    await waitFor(() => expect(retailBillSave).toHaveBeenCalledTimes(1))
  })

  it('saves normally when no edit is open', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await user.click(control('retail.save'))
    await waitFor(() => expect(retailBillSave).toHaveBeenCalledTimes(1))
  })

  it('closes the edit when the line being edited is deleted', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(cell(0, 'item')).toContain('BANGLE'))

    await user.click(screen.getByLabelText('Edit item 1'))
    await user.click(screen.getByLabelText('Delete item 1'))

    // Otherwise the entry card would be holding a line that no longer exists,
    // and the save would stay refused with nothing on screen to resolve.
    await user.click(control('retail.save'))
    await waitFor(() => expect(retailBillSave).toHaveBeenCalledTimes(1))
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
describe('slips are separate documents under one bill', () => {
  it('opens with one slip, labelled Full Bill', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    expect(document.querySelectorAll('.slip-tab:not(.slip-tab--add)')).toHaveLength(1)
    expect(screen.getByText('(Full Bill)')).toBeTruthy()
  })

  it('adds a slip, and the new one starts empty', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await waitFor(() => expect(itemColumns()).toHaveLength(1))

    await user.click(control('retail.slip.add'))
    await waitFor(() =>
      expect(document.querySelectorAll('.slip-tab:not(.slip-tab--add)')).toHaveLength(2),
    )
    // The items belong to the slip, not to the bill.
    await waitFor(() => expect(itemColumns()).toHaveLength(0))
  })

  it('keeps each slip’s items to itself, and sends both to main', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await user.click(control('retail.slip.add'))
    await addItem(user, 'CHAIN', '2.000')

    await waitFor(() => expect(lastRequest().draft.slips).toHaveLength(2))
    const draft = lastRequest().draft
    expect(draft.slips[0]?.items.map((i) => i.itemName)).toEqual(['BANGLE'])
    expect(draft.slips[1]?.items.map((i) => i.itemName)).toEqual(['CHAIN'])
    // Each slip is its own document in the sequence, so each carries its own key.
    expect(draft.slips[0]?.draftId).not.toBe(draft.slips[1]?.draftId)
  })

  it('shares the customer across every slip — it belongs to the visit', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await user.type(screen.getByLabelText('Customer'), 'IMRAN SAHIB')
    await user.click(control('retail.slip.add'))

    await waitFor(() => expect(lastRequest().draft.customerName).toBe('IMRAN SAHIB'))
    // Once, on the bill — not copied onto each slip where two could disagree.
    expect(lastRequest().draft.slips).toHaveLength(2)
  })

  it('refuses to leave a slip with an edit still open', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await waitFor(() => expect(itemColumns()).toHaveLength(1))
    await user.click(control('retail.slip.add'))
    await waitFor(() =>
      expect(document.querySelectorAll('.slip-tab:not(.slip-tab--add)')).toHaveLength(2),
    )

    // Back to slip 1, open an edit, then try to walk away from it.
    await user.click(slipTab(1))
    await waitFor(() => expect(itemColumns()).toHaveLength(1))
    await user.click(screen.getByLabelText('Edit item 1'))
    await user.click(slipTab(2))

    expect(await screen.findByText(/open for editing on Slip 1/)).toBeTruthy()
  })

  it('asks before deleting a draft slip', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await user.click(control('retail.slip.add'))
    await waitFor(() =>
      expect(document.querySelectorAll('.slip-tab:not(.slip-tab--add)')).toHaveLength(2),
    )

    await user.click(screen.getByLabelText('Delete slip 2'))
    // A confirmation, not an immediate deletion.
    expect(await screen.findByText(/Delete slip 2\?/)).toBeTruthy()
    expect(document.querySelectorAll('.slip-tab:not(.slip-tab--add)')).toHaveLength(2)

    await user.click(screen.getByText('Delete this slip'))
    await waitFor(() =>
      expect(document.querySelectorAll('.slip-tab:not(.slip-tab--add)')).toHaveLength(1),
    )
  })

  it('saves the whole bill through one call, not one call per slip', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '4.050')
    await user.click(control('retail.slip.add'))
    await addItem(user, 'CHAIN', '2.000')
    await waitFor(() => expect(lastRequest().draft.slips).toHaveLength(2))

    await user.click(control('retail.save'))
    await waitFor(() => expect(retailBillSave).toHaveBeenCalledTimes(1))
    // The whole bill in one call, not one call per slip — which is what makes
    // the all-or-nothing transaction downstream reachable at all.
    const sent = lastRequest().draft
    expect(sent.slips).toHaveLength(2)
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
    await waitFor(() => expect(cell(0, 'gross')).toBe('47.240'))

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
