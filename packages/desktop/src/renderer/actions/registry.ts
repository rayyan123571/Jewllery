import { notBuiltMessage, type ModuleId } from '../shell/modules.js'

/**
 * Every interactive control in the application.
 *
 * The rule this file exists to enforce: **a control is either fully working or
 * visibly disabled, never a third thing.** A button that looks live, is
 * clickable, and does nothing reads as a broken application, and it hides
 * unfinished work.
 *
 * The enforcement is structural rather than a matter of discipline:
 *
 *   - An action is a discriminated union. `{ kind: 'ready' }` carries a handler
 *     and nothing else can; `{ kind: 'not-built' }` carries a module and has no
 *     handler field at all. There is no shape with neither, and none with both —
 *     TypeScript rejects them at compile time.
 *   - The <Action> component is the only way to render a control, and it can
 *     only be given an id that exists in this registry.
 *   - registry.test.ts walks every entry and fails on anything malformed.
 *   - shell.test.tsx renders the real shell and fails if any <button> in the DOM
 *     lacks a data-action attribute resolving to an entry here.
 *
 * Together that makes a silent no-op unrepresentable, not merely discouraged.
 */

export type ActionId =
  // ── sidebar and top bar navigation ────────────────────────────────────────
  | 'nav.dashboard'
  | 'nav.sale-retail'
  | 'nav.wholesale'
  | 'nav.purchase'
  | 'nav.stock'
  | 'nav.customers'
  | 'nav.suppliers'
  | 'nav.roznamcha'
  | 'nav.reports'
  | 'nav.gold-rate'
  | 'nav.backup-restore'
  | 'nav.settings'
  | 'nav.users'
  | 'nav.tools'
  | 'app.exit'
  | 'app.user-menu'
  // ── the rate panel ────────────────────────────────────────────────────────
  | 'rate.refresh'
  // ── wholesale entry form (M2) ─────────────────────────────────────────────
  | 'wholesale.tab.new'
  | 'wholesale.tab.ledger'
  | 'wholesale.tab.return'
  | 'wholesale.tab.history'
  | 'wholesale.party.add'
  | 'wholesale.invoice.search'
  | 'wholesale.row.add'
  | 'wholesale.row.clear'
  | 'wholesale.row.delete'
  | 'wholesale.import-from-stock'
  | 'wholesale.scan-barcode'
  | 'wholesale.save'
  | 'wholesale.save-and-print'
  | 'wholesale.print'
  | 'wholesale.hold'
  | 'wholesale.cancel'
  | 'wholesale.ledger.view-full'
  | 'wholesale.ledger.view-entry'
  // ── quick actions panel ───────────────────────────────────────────────────
  | 'quick.wholesale-ledger'
  | 'quick.return-receive'
  | 'quick.print-last-invoice'
  | 'quick.party-balance'
  // ── settings and backup (M0, live) ────────────────────────────────────────
  | 'backup.run'
  | 'backup.restore'
  | 'settings.shop-profile.save'
  | 'users.add'
  | 'goldrate.set'

/** A control that works, end to end. */
export interface ReadyAction {
  readonly kind: 'ready'
  readonly label: string
  readonly run: () => void | Promise<void>
  readonly shortcut?: string
}

/**
 * A control whose module is not built. Rendered disabled, with hover text
 * naming the module. Deliberately has no `run` field for a handler to hide in.
 */
export interface NotBuiltAction {
  readonly kind: 'not-built'
  readonly label: string
  readonly module: ModuleId
  readonly shortcut?: string
}

export type Action = ReadyAction | NotBuiltAction

export type ActionRegistry = Readonly<Record<ActionId, Action>>

/** Everything a handler needs. Supplied by the shell, so the registry stays pure. */
export interface ActionContext {
  readonly navigate: (module: ModuleId) => void
  readonly exit: () => void
  readonly refreshRates: () => Promise<void>
  readonly runBackup: () => Promise<void>
  readonly restoreBackup: () => Promise<void>
  readonly toggleUserMenu: () => void
}

function notBuilt(label: string, module: ModuleId, shortcut?: string): NotBuiltAction {
  return shortcut === undefined
    ? { kind: 'not-built', label, module }
    : { kind: 'not-built', label, module, shortcut }
}

/**
 * Builds the registry against a live context.
 *
 * Navigation is always ready — moving to a module's screen works even when the
 * module itself is not built, because the screen then explains what is coming
 * and when. It is the controls *inside* an unbuilt module that are disabled.
 */
export function createActionRegistry(context: ActionContext): ActionRegistry {
  const navigateTo = (module: ModuleId, label: string): ReadyAction => ({
    kind: 'ready',
    label,
    run: () => context.navigate(module),
  })

  return {
    // Navigation — always live.
    'nav.dashboard': navigateTo('dashboard', 'Dashboard'),
    'nav.sale-retail': navigateTo('sale-retail', 'Sale (Retail)'),
    'nav.wholesale': navigateTo('wholesale', 'Whole Sale'),
    'nav.purchase': navigateTo('purchase', 'Purchase'),
    'nav.stock': navigateTo('stock', 'Stock Management'),
    'nav.customers': navigateTo('customers', 'Customers'),
    'nav.suppliers': navigateTo('suppliers', 'Suppliers'),
    'nav.roznamcha': navigateTo('roznamcha', 'Roznamcha'),
    'nav.reports': navigateTo('reports', 'Reports'),
    'nav.gold-rate': navigateTo('gold-rate', 'Gold Rate'),
    'nav.backup-restore': navigateTo('backup-restore', 'Backup / Restore'),
    'nav.settings': navigateTo('settings', 'Settings'),
    'nav.users': navigateTo('users', 'Users & Permissions'),
    'nav.tools': navigateTo('tools', 'Tools'),

    'app.exit': { kind: 'ready', label: 'EXIT', run: () => context.exit() },
    'app.user-menu': {
      kind: 'ready',
      label: 'Account menu',
      run: () => context.toggleUserMenu(),
    },

    // M0 — live.
    'rate.refresh': {
      kind: 'ready',
      label: 'Refresh gold rate',
      run: () => context.refreshRates(),
    },
    'backup.run': { kind: 'ready', label: 'Back Up Now', run: () => context.runBackup() },
    'backup.restore': {
      kind: 'ready',
      label: 'Restore From Backup',
      run: () => context.restoreBackup(),
    },

    // M0 screens not yet wired to forms — the module is built, the form is not,
    // so these name the milestone that finishes them rather than pretending.
    'settings.shop-profile.save': notBuilt('Save Shop Profile', 'settings'),
    'users.add': notBuilt('Add User', 'users'),
    'goldrate.set': notBuilt('Set Rate', 'gold-rate'),

    // M2 — Whole Sale. The module in the mockup, and the one that matters most.
    'wholesale.tab.new': notBuilt('New Whole Sale', 'wholesale'),
    'wholesale.tab.ledger': notBuilt('Whole Sale Ledger', 'wholesale'),
    'wholesale.tab.return': notBuilt('Return / Receive', 'wholesale'),
    'wholesale.tab.history': notBuilt('History', 'wholesale'),
    'wholesale.party.add': notBuilt('Add Party', 'wholesale'),
    'wholesale.invoice.search': notBuilt('Find Invoice', 'wholesale'),
    'wholesale.row.add': notBuilt('Add Row', 'wholesale'),
    'wholesale.row.clear': notBuilt('Clear Row', 'wholesale'),
    'wholesale.row.delete': notBuilt('Delete Row', 'wholesale'),
    'wholesale.save': notBuilt('SAVE', 'wholesale', 'F5'),
    'wholesale.save-and-print': notBuilt('SAVE & PRINT', 'wholesale', 'F6'),
    'wholesale.print': notBuilt('PRINT', 'wholesale', 'F7'),
    'wholesale.hold': notBuilt('HOLD', 'wholesale', 'F8'),
    'wholesale.cancel': notBuilt('CANCEL', 'wholesale'),
    'wholesale.ledger.view-full': notBuilt('View Full Ledger', 'wholesale'),
    'wholesale.ledger.view-entry': notBuilt('View Entry', 'wholesale'),

    // Belong to other modules even though they appear on the wholesale screen.
    // Labelling them by their real owner is the point: "Import from Stock" is
    // blocked by Stock Management, not by Whole Sale, and the hover text says so.
    'wholesale.import-from-stock': notBuilt('Import from Stock', 'stock'),
    'wholesale.scan-barcode': notBuilt('Scan Barcode', 'stock'),

    'quick.wholesale-ledger': notBuilt('Whole Sale Ledger', 'wholesale'),
    'quick.return-receive': notBuilt('Return / Receive', 'wholesale'),
    'quick.print-last-invoice': notBuilt('Print Last Invoice', 'wholesale'),
    'quick.party-balance': notBuilt('Party Balance', 'customers'),
  }
}

/** Hover text for a control. Ready actions show their shortcut, if any. */
export function actionTitle(action: Action): string {
  if (action.kind === 'not-built') {
    return notBuiltMessage(action.module)
  }
  return action.shortcut ? `${action.label} (${action.shortcut})` : action.label
}
