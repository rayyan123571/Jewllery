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
  RetailCalculateRequest,
  RetailCalculationDto,
  RetailItemDto,
  RetailLineDto,
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
      cutPerTola: weightOf(item.cutPerTola, unit),
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
    cutPerTola: weightDto(computed.cutPerTola),
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

/** Every calculate request the screen made, newest last. */
const requests: RetailCalculateRequest[] = []

function calculate(request: RetailCalculateRequest): RetailCalculationDto {
  requests.push(request)
  const unit: WeightUnit = request.draft.weightUnit === 'tola' ? 'tola' : 'gram'
  const lines = request.draft.items.map((item) => lineOf(item, unit))
  const totalFine = Weight.sum(lines.map((line) => Weight.fromMilligrams(line.fine.mg)))
  const itemsTotal = Money.sum(lines.map((line) => Money.fromPaisa(line.amount.paisa)))
  const paid = moneyOf(request.draft.amountPaid)
  return {
    lines,
    entry: request.entry ? lineOf(request.entry, unit) : null,
    totalFine: weightDto(totalFine),
    customerGold: weightDto(weightOf(request.draft.customerGold, unit)),
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
    wastageRuleLabel: 'Wastage added to net weight, calculated on net weight',
    warnings: [],
  }
}

const retailSave = vi.fn(async () => ({
  ok: true as const,
  saleId: 'sale-1',
  invoiceNo: 'RS-00001',
  status: 'posted',
  grandTotal: '1,102,596.13',
  balance: '0.00',
  amountInWords: 'Rupees Eleven Lakh Two Thousand Five Hundred Ninety Six Only',
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

  retailCalculate: vi.fn(async (request: RetailCalculateRequest) => calculate(request)),
  retailSave,
  retailHold: vi.fn(),
  retailLoad: vi.fn(async () => null),
  retailList: vi.fn(async () => []),
  retailVoid: vi.fn(),
  retailNextInvoiceNo: vi.fn(async () => 'RS-00001'),
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

function itemRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.grid--retail tbody tr'))
}

/**
 * One cell of the items table.
 *
 * Queries are scoped to the row rather than to the document because the same
 * figures legitimately appear three times on this screen — in the table, in the
 * entry card and on the 80mm preview — and that is the point of the screen, not
 * a duplication to assert around.
 */
const COLUMN = {
  item: 1,
  purity: 2,
  gross: 3,
  net: 4,
  wastage: 5,
  fine: 6,
  amount: 9,
} as const

function cell(rowIndex: number, column: keyof typeof COLUMN): string {
  const row = itemRows()[rowIndex]
  if (!row) throw new Error(`No row ${rowIndex} in the items table.`)
  return (row.children[COLUMN[column]]?.textContent ?? '').trim()
}

/** Opens the retail screen the way an operator does. */
async function openRetail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await screen.findByLabelText('Main menu')
  await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Sale (Retail)'))
  await screen.findByText('SAVE (F5)')
}

/** Types one item into the entry card and adds it to the sale. */
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
      'retail.save-and-print',
      'retail.print',
      'retail.hold',
      'retail.new',
      'retail.cancel',
      'retail.item.add',
      'retail.item.clear',
      'retail.unit.toggle',
      'retail.customer.add',
      'retail.labour.mode',
      'quick.retail-whatsapp',
    ] as const) {
      expect(control(id).disabled).toBe(false)
    }
  })

  it('tells the operator to fill the entry card rather than showing a bare header', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    expect(screen.getByText('No items yet')).toBeTruthy()
    expect(control('retail.item.add').textContent).toContain('ADD ITEM (F2)')
  })
})

describe('edit in place is resolved, never silently dropped', () => {
  it('refuses to save while a line is open for editing', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(cell(0, 'item')).toContain('BANGLE'))

    await user.click(screen.getByLabelText('Edit line 1'))
    // The row says so, and the button changes what it promises.
    expect(within(itemRows()[0] as HTMLElement).getByText('editing')).toBeTruthy()
    expect(control('retail.item.add').textContent).toContain('UPDATE ITEM (F2)')

    await user.click(control('retail.save'))

    // Nothing was posted, and the operator was told why in words they can act on.
    expect(retailSave).not.toHaveBeenCalled()
    expect(await screen.findByText(/open for editing/)).toBeTruthy()
    expect(screen.getByText(/Saving now would drop what you have typed/)).toBeTruthy()
  })

  it('writes the edit back over the same line rather than adding a second', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(cell(0, 'item')).toContain('BANGLE'))

    await user.click(screen.getByLabelText('Edit line 1'))
    await user.clear(screen.getByLabelText('Gross weight'))
    await user.type(screen.getByLabelText('Gross weight'), '11.664')
    await user.click(control('retail.item.add'))

    await waitFor(() => expect(cell(0, 'gross')).toBe('11.664'))
    expect(itemRows()).toHaveLength(1)
    expect(screen.queryByText('editing')).toBeNull()
    // And the save it refused a moment ago now goes through.
    await user.click(control('retail.save'))
    await waitFor(() => expect(retailSave).toHaveBeenCalledTimes(1))
  })

  it('saves normally when no edit is open', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await user.click(control('retail.save'))
    await waitFor(() => expect(retailSave).toHaveBeenCalledTimes(1))
  })

  it('closes the edit when the line being edited is deleted', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(cell(0, 'item')).toContain('BANGLE'))

    await user.click(screen.getByLabelText('Edit line 1'))
    await user.click(screen.getByLabelText('Delete line 1'))

    // Otherwise the entry card would be holding a line that no longer exists,
    // and the save would stay refused with nothing on screen to resolve.
    await user.click(control('retail.save'))
    await waitFor(() => expect(retailSave).toHaveBeenCalledTimes(1))
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

describe('the Gram ⇄ Tola toggle converts what is displayed and nothing else', () => {
  it('leaves the stored milligrams byte-identical across four flips', async () => {
    const user = userEvent.setup()
    await openRetail(user)
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
    await openRetail(user)
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
    await openRetail(user)
    await addItem(user, 'BANGLE', '47.240')
    await waitFor(() => expect(storedGrossMg()).toBe(47_240))

    await flipUnit(user, 'tola')

    // This is the bug the exactMg field exists to prevent, stated as an
    // assertion: re-reading the displayed "4.050" as a weight gives 47,239 mg,
    // one milligram short of what is actually stored. The draft carries the
    // exact milligram instead, so nothing is ever re-read.
    expect(cell(0, 'gross')).toBe('4.050')
    expect(parseTola('4.050').milligrams).toBe(47_239)
    expect(lastRequest().draft.items[0]?.grossWeight.exactMg).toBe(47_240)
    expect(storedGrossMg()).toBe(47_240)
  })

  it('carries the exact milligram on the customer gold field too', async () => {
    const user = userEvent.setup()
    await openRetail(user)
    await user.type(screen.getByLabelText('Customer gold'), '11.664')
    await waitFor(() =>
      expect(lastRequest().draft.customerGold.text).toBe('11.664'),
    )

    await flipUnit(user, 'tola')
    // 11.664 g is exactly one tola, and the exact milligram travels with it.
    expect(lastRequest().draft.customerGold).toEqual({ text: '1.000', exactMg: 11_664 })
  })
})

function lastRequest(): RetailCalculateRequest {
  const request = requests[requests.length - 1]
  if (!request) throw new Error('The screen never asked main to calculate anything.')
  return request
}

/** What the NEXT save would carry for line 1's gross weight, in milligrams. */
function storedGrossMg(): number {
  const field = lastRequest().draft.items[0]?.grossWeight
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
