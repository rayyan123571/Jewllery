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

const noopApi = {
  bootstrap: vi.fn(async () => ({
    shop: { name: 'AL-HARAM GOLD JEWELLERS', ownerName: 'Haji Abdul Rehman', address: 'Lahore' },
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
    databaseConnected: true,
    financialYear: '01-07-2026 To 30-06-2027',
    appVersion: '1.0.0.0',
  })),
  login: vi.fn(),
  logout: vi.fn(),
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
  windowControls: {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => true),
    onMaximizedChange: vi.fn(() => () => {}),
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
    toggleMaximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
  }
}

function allButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button'))
}

describe('no dead buttons in the rendered shell', () => {
  it('renders a substantial number of controls to check', async () => {
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')
    expect(allButtons().length).toBeGreaterThan(40)
  })

  it('gives every button a data-action attribute', async () => {
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')

    const orphans = allButtons()
      .filter((button) => !button.getAttribute('data-action'))
      .map((button) => button.textContent?.trim() || button.outerHTML.slice(0, 120))

    // A bare <button> written by hand lands here. Route it through <Action>.
    expect(orphans).toEqual([])
  })

  it('resolves every data-action to a registry entry', async () => {
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')
    const registry = createActionRegistry(stubContext())

    const dangling = allButtons()
      .map((button) => button.getAttribute('data-action') as ActionId)
      .filter((id) => !(id in registry))

    expect(dangling).toEqual([])
  })

  it('disables exactly the controls the registry says are not built', async () => {
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')
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
    await screen.findByText('WHOLE SALE MODULE')

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
    await screen.findByText('WHOLE SALE MODULE')
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
    await screen.findByText('WHOLE SALE MODULE')

    // Import from Stock sits on the Whole Sale screen but belongs to Stock
    // Management, which is not built — so it is still off even though every
    // Whole Sale control beside it is now live.
    const disabled = document.querySelector(
      '[data-action="wholesale.import-from-stock"]',
    ) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    await user.click(disabled).catch(() => undefined)
    expect(screen.getByText('WHOLE SALE MODULE')).toBeTruthy()
  })

  it('has Whole Sale controls live now that the module is built', async () => {
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')

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
    await screen.findByText('WHOLE SALE MODULE')
    const sidebar = screen.getByLabelText('Main menu')

    for (const module of MODULES) {
      expect(within(sidebar).getAllByText(module.label).length).toBeGreaterThan(0)
    }
  })

  it('keeps navigation live even for unbuilt modules', async () => {
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')
    const sidebar = screen.getByLabelText('Main menu')

    for (const module of MODULES) {
      const button = within(sidebar).getByTitle(module.label) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    }
  })

  it('navigates to an unbuilt module and explains what is coming', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')

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
  it('shows the gold rate panel with a rate per purity', async () => {
    render(<App />)
    await screen.findByText('Rs. 8,950')
    expect(screen.getByText('Rs. 8,550')).toBeTruthy()
    expect(screen.getByText('Rs. 7,300')).toBeTruthy()
  })

  it('shows the status bar fields', async () => {
    render(<App />)
    await screen.findByText('AL-HARAM GOLD JEWELLERS')
    expect(screen.getByText('01-07-2026 To 30-06-2027')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('14-07-2026 09:15 PM')).toBeTruthy()
    expect(screen.getByText('1.0.0.0')).toBeTruthy()
  })

  it('never renders a signed weight or amount anywhere on the screen', async () => {
    // docs/DECISIONS.md §4. Balances are rendered as a magnitude plus an
    // explicit label, because a bare minus is misread at a counter. This scans
    // the whole rendered document rather than one panel, so a new screen that
    // formats a balance itself is caught too.
    render(<App />)
    await screen.findByText('WHOLE SALE MODULE')

    const text = document.body.textContent ?? ''
    // e.g. "-0.500 g" or "-1,200.00" — a minus immediately before a figure.
    expect(text).not.toMatch(/-\s?\d[\d,]*\.\d/)
  })
})
