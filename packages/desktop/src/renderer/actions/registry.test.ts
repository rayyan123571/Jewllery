import { describe, expect, it, vi } from 'vitest'
import { MODULES, isModuleBuilt, notBuiltMessage, type ModuleId } from '../shell/modules.js'
import { actionTitle, createActionRegistry, type ActionContext } from './registry.js'

/**
 * Test one of two for the no-dead-buttons rule.
 *
 * This one checks the registry itself: every entry is well formed, and there is
 * no entry that is neither wired nor disabled. The second test
 * (shell.test.tsx) checks the rendered DOM, which is what makes the rule hold
 * for controls someone adds later.
 */

function context(): ActionContext {
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

const registry = createActionRegistry(context())
const entries = Object.entries(registry)

describe('every action is either ready or explicitly not built', () => {
  it('has entries to check', () => {
    expect(entries.length).toBeGreaterThan(30)
  })

  it.each(entries)('%s is exactly one of the two kinds', (_id, action) => {
    expect(['ready', 'not-built']).toContain(action.kind)
  })

  it.each(entries)('%s has a label', (_id, action) => {
    expect(action.label.trim().length).toBeGreaterThan(0)
  })

  // The core of the rule: no entry may have neither a handler nor a disabled
  // state. A "ready" action must carry a callable run; a "not-built" action must
  // name a real module and must NOT carry a handler for a no-op to hide in.
  it.each(entries)('%s has a handler or a module, never neither', (_id, action) => {
    if (action.kind === 'ready') {
      expect(typeof action.run).toBe('function')
    } else {
      expect(MODULES.map((m) => m.id)).toContain(action.module)
      expect(action).not.toHaveProperty('run')
    }
  })

  it.each(entries)('%s produces hover text', (_id, action) => {
    expect(actionTitle(action).trim().length).toBeGreaterThan(0)
  })
})

describe('a not-built action explains itself', () => {
  it('names the module and the milestone in its hover text', () => {
    const action = registry['wholesale.hold']
    expect(action.kind).toBe('ready')
    // Import-from-stock is a feature that has not been drawn. Its owning
    // module IS built now, so the message says "screen not built yet" rather
    // than promising a milestone that has already shipped — an unbuilt module
    // still gets the milestone form, which quick.party-balance shows.
    const unbuilt = registry['wholesale.import-from-stock']
    expect(unbuilt.kind).toBe('not-built')
    expect(actionTitle(unbuilt)).toBe('Stock Management — screen not built yet')

    const milestone = registry['quick.party-balance']
    expect(milestone.kind).toBe('not-built')
    expect(actionTitle(milestone)).toBe('Customers — not built yet (M1)')
  })

  it('attributes a control to the module that actually blocks it', () => {
    // "Import from Stock" sits on the Whole Sale screen but is blocked by Stock
    // Management. Saying "Whole Sale" would send someone to the wrong place.
    const action = registry['wholesale.import-from-stock']
    expect(action.kind).toBe('not-built')
    if (action.kind === 'not-built') expect(action.module).toBe('stock')
    expect(actionTitle(action)).toContain('Stock Management')
  })

  it('never claims a built module is unbuilt', () => {
    for (const [id, action] of entries) {
      if (action.kind === 'not-built' && isModuleBuilt(action.module)) {
        // Built modules may still have undrawn screens, but then the message
        // must not promise a future milestone.
        expect(notBuiltMessage(action.module)).not.toMatch(/\(M\d\)/)
        expect(id).toBeTruthy()
      }
    }
  })
})

describe('navigation always works, even to an unbuilt module', () => {
  it('wires a ready action for every module in the sidebar', () => {
    for (const module of MODULES) {
      const action = registry[`nav.${module.id}` as keyof typeof registry]
      expect(action.kind).toBe('ready')
    }
  })

  it('navigates when run', () => {
    const ctx = context()
    const nav = createActionRegistry(ctx)['nav.reports']
    expect(nav.kind).toBe('ready')
    if (nav.kind === 'ready') void nav.run()
    expect(ctx.navigate).toHaveBeenCalledWith('reports' satisfies ModuleId)
  })
})

describe('Whole Sale is built, so its controls are live', () => {
  // The flip that matters: these were disabled while M2 was unbuilt. Now that
  // the screen posts, they must all be wired — and the shell test checks the
  // rendered DOM agrees.
  it.each([
    'wholesale.save',
    'wholesale.save-and-print',
    'wholesale.print',
    'wholesale.hold',
    'wholesale.cancel',
    'wholesale.row.add',
    'wholesale.row.clear',
    'wholesale.row.delete',
    'wholesale.party.add',
    'wholesale.tab.new',
    'wholesale.tab.ledger',
    'wholesale.tab.return',
    'wholesale.tab.history',
    'wholesale.ledger.view-full',
    'wholesale.ledger.view-entry',
    'quick.wholesale-ledger',
    'quick.return-receive',
    'quick.print-last-invoice',
    'goldrate.set',
  ] as const)('%s is ready', (id) => {
    expect(registry[id].kind).toBe('ready')
  })

  it('hands the action to the mounted screen', () => {
    const ctx = context()
    const action = createActionRegistry(ctx)['wholesale.save']
    expect(action.kind).toBe('ready')
    if (action.kind === 'ready') void action.run()
    expect(ctx.dispatch).toHaveBeenCalledWith('wholesale.save')
  })

  it('still disables what belongs to an unbuilt module', () => {
    // Import from Stock and Scan Barcode sit on the Whole Sale screen but
    // belong to Stock Management, so they stay off and say so.
    for (const id of ['wholesale.import-from-stock', 'wholesale.scan-barcode'] as const) {
      const action = registry[id]
      expect(action.kind).toBe('not-built')
      if (action.kind === 'not-built') expect(action.module).toBe('stock')
    }
  })
})

describe('M0 controls are live, not disabled', () => {
  it.each(['rate.refresh', 'backup.run', 'backup.restore', 'app.exit'] as const)(
    '%s is ready',
    (id) => {
      expect(registry[id].kind).toBe('ready')
    },
  )

  it('actually calls through to the context', async () => {
    const ctx = context()
    const action = createActionRegistry(ctx)['backup.run']
    expect(action.kind).toBe('ready')
    if (action.kind === 'ready') await action.run()
    expect(ctx.runBackup).toHaveBeenCalledOnce()
  })
})
