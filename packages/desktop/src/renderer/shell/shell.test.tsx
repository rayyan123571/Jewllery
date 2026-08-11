/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App.js'
import { MODULES, moduleById } from './modules.js'
import { createActionRegistry, type ActionContext, type ActionId } from '../actions/registry.js'

/**
 * Test two of two for the no-dead-buttons rule, and the one that makes it hold.
 *
 * registry.test.ts proves the registry is well formed. This renders the real
 * shell and inspects the actual DOM, so a control someone adds later cannot slip
 * through: a hand-written <button> has no data-action attribute and fails here.
 *
 * The three assertions together leave no room for a silent no-op:
 *
 *   1. every <button> carries a data-action                → nothing bypasses the registry
 *   2. every data-action resolves to a registry entry      → no dangling ids
 *   3. state matches the registry: not-built ⇒ disabled,
 *      ready ⇒ enabled                                     → no button that looks live and isn't
 */

function weight(): { mg: number; gram: string; tola: string } {
  return { mg: 0, gram: '0.000', tola: '0.000' }
}

function money(): { paisa: number; rupees: string; whole: string } {
  return { paisa: 0, rupees: '0.00', whole: '0' }
}

/** An empty retail calculation, in the shape the main process returns. */
function emptyCalculation() {
  return {
    lines: [],
    entry: null,
    totalFine: weight(),
    customerGold: weight(),
    remainingGold: weight(),
    goldValue: money(),
    totalLabour: money(),
    totalStone: money(),
    itemsTotal: money(),
    hallmarkCharges: money(),
    otherCharges: money(),
    discount: money(),
    customerGoldValue: money(),
    invoiceTotal: money(),
    grandTotal: money(),
    amountPaid: money(),
    balance: money(),
    amountInWords: 'Rupees Zero Only',
    ratePerTola: { paisa: 23_797_000, rupees: '237,970.00', whole: '237,970' },
    rateDisplay: 'Rs. 237,970',
    rateMissing: false,
    wastageRuleLabel: 'Wastage added to net weight, calculated on net weight',
    warnings: [],
  }
}

const noopApi = {
  bootstrap: vi.fn(async () => ({
    branchId: 'branch-1',
    branchName: 'Main Branch',
    user: { id: 'u1', name: 'Admin', username: 'admin', role: 'ADMIN', mustChangePassword: false },
    rates: [
      { purity: '22K', ratePerGramPaisa: 895_000, effectiveFrom: '2026-07-15', display: 'Rs. 8,950' },
      { purity: '21K', ratePerGramPaisa: 855_000, effectiveFrom: '2026-07-15', display: 'Rs. 8,550' },
      { purity: '18K', ratePerGramPaisa: 730_000, effectiveFrom: '2026-07-15', display: 'Rs. 7,300' },
    ],
    backup: {
      lastBackupAt: '2026-07-14T21:15:00.000Z',
      lastBackupDisplay: '14-07-2026 09:15 PM',
      daysSince: 1,
      integrityOk: true,
    },
    users: [
      { id: 'u1', name: 'Admin', username: 'admin', role: 'ADMIN', mustChangePassword: false },
    ],
    databaseConnected: true,
    // Widened deliberately: `null` is the real "no manual choice" state, and one
    // test below overrides this to it to check the module default.
    sidebarCollapsed: false as boolean | null,
  })),
  login: vi.fn(),
  logout: vi.fn(),
  selectUser: vi.fn(),
  setSidebarCollapsed: vi.fn(async () => {}),
  currentRates: vi.fn(async () => []),
  runBackup: vi.fn(),
  restoreBackup: vi.fn(),
  quit: vi.fn(),

  // The wholesale screen asks for these on mount. Empty answers are enough:
  // this suite is about which controls exist and whether they are wired, not
  // about the figures — those are covered with no window at all, in the domain
  // and application tests.
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
    rateDisplay: 'Rs. 358,000',
    rateMissing: false,
    previousBalance: null,
    endBalance: null,
  })),
  postIssue: vi.fn(),
  settle: vi.fn(),
  partyLedger: vi.fn(async () => []),
  setRate: vi.fn(),
  // The Gold Rate screen asks for this on mount. An empty answer is enough:
  // this suite is about which controls exist and whether they are wired.
  rateHistory: vi.fn(async () => []),
  changePassword: vi.fn(),

  // The retail screen and the settings screen ask for these on mount. Empty
  // answers are enough: this suite is about which controls exist and whether
  // they are wired, not about the figures — those are covered with no window at
  // all, in the domain, application and IPC-handler tests.
  retailCalculate: vi.fn(async () => emptyCalculation()),
  retailSave: vi.fn(),
  retailHold: vi.fn(),
  retailLoad: vi.fn(async () => null),
  retailList: vi.fn(async () => []),
  retailVoid: vi.fn(),
  retailNextInvoiceNo: vi.fn(async () => 'RS-00001'),
  retailReceipt: vi.fn(async () => null),
  searchCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  listSalesmen: vi.fn(async () => []),
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
        note: 'No rounding. The total stands exactly as computed, to the paisa.',
        totalDisplay: 'Rs 1,098,608.35',
        isSaved: true,
      },
      {
        step: 100,
        label: 'Nearest Rs 100',
        note: 'The total lands on a round hundred rupees.',
        totalDisplay: 'Rs 1,098,600.00',
        isSaved: false,
      },
      {
        step: 1000,
        label: 'Nearest Rs 1000',
        note: 'The total lands on a round thousand rupees.',
        totalDisplay: 'Rs 1,099,000.00',
        isSaved: false,
      },
    ],
  })),
  setRetailRounding: vi.fn(async () => ({ ok: true as const })),
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
  Object.defineProperty(window, 'api', { value: noopApi, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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

function allButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button'))
}

describe('no dead buttons in the rendered shell', () => {
  it('renders a substantial number of controls to check', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    expect(allButtons().length).toBeGreaterThan(40)
  })

  it('gives every button a data-action attribute', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    const orphans = allButtons()
      .filter((button) => !button.getAttribute('data-action'))
      .map((button) => button.textContent?.trim() || button.outerHTML.slice(0, 120))

    // A bare <button> written by hand lands here. Route it through <Action>.
    expect(orphans).toEqual([])
  })

  it('resolves every data-action to a registry entry', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    const registry = createActionRegistry(stubContext())

    const dangling = allButtons()
      .map((button) => button.getAttribute('data-action') as ActionId)
      .filter((id) => !(id in registry))

    expect(dangling).toEqual([])
  })

  it('disables exactly the controls the registry says are not built', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    const registry = createActionRegistry(stubContext())

    const mismatched = allButtons()
      .map((button) => {
        const id = button.getAttribute('data-action') as ActionId
        const expected = registry[id].kind === 'not-built'
        return expected === button.disabled ? null : `${id}: expected disabled=${expected}`
      })
      .filter((problem): problem is string => problem !== null)

    expect(mismatched).toEqual([])
  })

  it('gives every disabled control hover text naming its module', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    const missing = allButtons()
      .filter((button) => button.disabled)
      .filter((button) => {
        const title = button.getAttribute('title') ?? ''
        return !title.includes('not built yet')
      })
      .map((button) => button.getAttribute('data-action'))

    expect(missing).toEqual([])
  })

  it('leaves no enabled button without a click handler', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    const registry = createActionRegistry(stubContext())

    const inert = allButtons()
      .filter((button) => !button.disabled)
      .map((button) => button.getAttribute('data-action') as ActionId)
      .filter((id) => registry[id].kind !== 'ready')

    expect(inert).toEqual([])
  })

  it('does nothing when a disabled control is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    // Import from Stock sits on the Whole Sale screen but belongs to Stock
    // Management, which is not built — so it is still off even though every
    // Whole Sale control beside it is now live.
    const disabled = document.querySelector(
      '[data-action="wholesale.import-from-stock"]',
    ) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    await user.click(disabled).catch(() => undefined)
    expect(screen.getByText('ENTRY DETAILS')).toBeTruthy()
  })

  it('has Whole Sale controls live now that the module is built', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    for (const id of ['wholesale.save', 'wholesale.save-and-print', 'wholesale.hold']) {
      const button = document.querySelector(`[data-action="${id}"]`) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    }
  })
})

describe('every module screen obeys the no-dead-buttons rule', () => {
  // The rule was only ever checked on whichever screen happened to be open —
  // Whole Sale. That let the Gold Rate screen ship a bare <button> with no
  // data-action, which is exactly the thing the rule exists to prevent. This
  // walks every module in the sidebar and checks the screen behind it.
  it.each(MODULES.map((m) => [m.label, m.id] as const))(
    '%s renders no button without a data-action',
    async (_label, id) => {
      const user = userEvent.setup()
      render(<App />)
      await screen.findByLabelText('Main menu')
      await user.click(within(screen.getByLabelText('Main menu')).getByTitle(_label))

      const orphans = Array.from(document.querySelectorAll('button'))
        .filter((button) => !button.getAttribute('data-action'))
        .map((button) => `${id}: ${button.textContent?.trim() || button.outerHTML.slice(0, 80)}`)

      expect(orphans).toEqual([])
    },
  )
})

describe('the shell shows the whole shape of the app', () => {
  it('renders every module in the sidebar, built or not', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    const sidebar = screen.getByLabelText('Main menu')

    for (const module of MODULES) {
      expect(within(sidebar).getAllByText(module.label).length).toBeGreaterThan(0)
    }
  })

  it('keeps navigation live even for unbuilt modules', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    const sidebar = screen.getByLabelText('Main menu')

    for (const module of MODULES) {
      const button = within(sidebar).getByTitle(module.label) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    }
  })

  it('navigates to an unbuilt module and explains what is coming', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    const sidebar = screen.getByLabelText('Main menu')
    await user.click(within(sidebar).getByTitle('Reports'))

    // "Reports" also appears in the sidebar and the top bar, so scope the
    // assertion to the placeholder rather than the whole document.
    const badge = await screen.findByText(`Coming in ${moduleById('reports').builtIn}`)
    const placeholder = badge.closest('.placeholder') as HTMLElement
    expect(within(placeholder).getByText('Reports')).toBeTruthy()
  })
})

describe('the shell chrome matches the mockup', () => {
  /**
   * The rate is a CARD on the screens that price metal now, not a panel in a
   * bar across the whole application — so it is asserted where it actually
   * lives. The figures are the same three; the card drops the "Rs." prefix
   * because it is a column of per-tola figures under a GOLD RATE header and the
   * currency is stated once, by the header, rather than four times.
   */
  it('shows the gold rate card with a rate per purity', async () => {
    render(<App />)
    await screen.findByText('GOLD RATE')
    expect(screen.getByText('8,950')).toBeTruthy()
    expect(screen.getByText('8,550')).toBeTruthy()
    expect(screen.getByText('7,300')).toBeTruthy()
  })

  it('gives every purity its own editable figure and refresh', async () => {
    render(<App />)
    await screen.findByText('GOLD RATE')
    for (const purity of ['22K', '21K', '18K']) {
      expect(screen.getByLabelText(`Edit ${purity} rate`)).toBeTruthy()
      expect(screen.getByLabelText(`Refresh ${purity} rate`)).toBeTruthy()
    }
  })

  /**
   * The status bar is gone, and with it the four strings this used to assert.
   * Two of them mattered and moved rather than being dropped: database
   * connected and last backup are now in the account popover and on the
   * Settings card. This checks they are still reachable — the fact survived
   * even though the strip did not.
   */
  it('keeps database and backup reachable from the account popover', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    await user.click(screen.getByLabelText('Account — Admin'))
    const menu = await screen.findByRole('menu', { name: 'Account' })
    expect(within(menu).getByText('Connected')).toBeTruthy()
    expect(within(menu).getByText('14-07-2026 09:15 PM')).toBeTruthy()
  })

  it('no longer shows a status bar', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    expect(document.querySelector('.status-bar')).toBeNull()
    // The company name and the version went with it: one is on every printed
    // slip already and the other had no second reader.
    expect(screen.queryByText('1.0.0.0')).toBeNull()
    expect(screen.queryByText(/Financial Year/)).toBeNull()
    expect(screen.queryByText(/To 30-06-/)).toBeNull()
  })

  /**
   * The drag region. With the top bar gone this strip is the ONLY thing that
   * can move the window, so its absence is not a cosmetic regression — it is a
   * window the operator cannot move. Double-click-to-maximise comes from the
   * same property, which is why the assertion is on the property and not on a
   * class name.
   */
  it('keeps exactly one drag region, and the window buttons opt out of it', async () => {
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    const strip = document.querySelector('.drag-strip') as HTMLElement
    expect(strip).toBeTruthy()

    for (const id of ['window.minimize', 'window.maximize', 'window.close']) {
      const button = strip.querySelector(`[data-action="${id}"]`) as HTMLButtonElement
      expect(button).toBeTruthy()
      expect(button.disabled).toBe(false)
    }
  })

  /**
   * The module default, which is the WEAKEST of the three inputs.
   *
   * So the setup has to remove the other two or it proves nothing: a wide window
   * (or the width rule collapses everything) and no stored choice (or the
   * operator's answer wins, which is the behaviour that matters most and is
   * checked below).
   */
  it('opens the retail module with the sidebar collapsed to its icon rail', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1550, configurable: true })
    noopApi.bootstrap.mockResolvedValueOnce({
      ...(await noopApi.bootstrap()),
      sidebarCollapsed: null,
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('ENTRY DETAILS')
    // Wholesale opens expanded at this width…
    expect(document.querySelector('.app')?.classList.contains('is-collapsed')).toBe(false)

    await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Sale (Retail)'))
    // …and retail opens on the rail, with navigation still there.
    expect(document.querySelector('.app')?.classList.contains('is-collapsed')).toBe(true)
    expect(within(screen.getByLabelText('Main menu')).getByTitle('Whole Sale')).toBeTruthy()
  })

  it('lets a stored sidebar choice outrank the retail default', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1550, configurable: true })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    // The fixture stores `sidebarCollapsed: false` — an operator who has said
    // "keep it open" keeps it open, on retail as much as anywhere else.
    await user.click(within(screen.getByLabelText('Main menu')).getByTitle('Sale (Retail)'))
    expect(document.querySelector('.app')?.classList.contains('is-collapsed')).toBe(false)
  })

  it('never renders a signed weight or amount anywhere on the screen', async () => {
    // docs/DECISIONS.md §4. Balances are rendered as a magnitude plus an
    // explicit label, because a bare minus is misread at a counter. This scans
    // the whole rendered document rather than one panel, so a new screen that
    // formats a balance itself is caught too.
    render(<App />)
    await screen.findByText('ENTRY DETAILS')

    const text = document.body.textContent ?? ''
    // e.g. "-0.500 g" or "-1,200.00" — a minus immediately before a figure.
    expect(text).not.toMatch(/-\s?\d[\d,]*\.\d/)
  })
})
