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
  | 'app.sidebar-toggle'
  | 'message.dismiss'
  // ── who is working ────────────────────────────────────────────────────────
  | 'user.pick'
  // ── frameless window chrome ───────────────────────────────────────────────
  | 'window.minimize'
  | 'window.maximize'
  | 'window.close'
  // ── the rate panel ────────────────────────────────────────────────────────
  | 'rate.refresh'
  | 'rate.edit'
  // ── the date field ────────────────────────────────────────────────────────
  // Rendered once per date field and once per day cell, each supplying its own
  // onActivate — the registry holds the control, the field holds which day it is.
  | 'date.pick'
  | 'date.day'
  | 'date.prev-month'
  | 'date.next-month'
  // ── wholesale entry form (M2) ─────────────────────────────────────────────
  | 'wholesale.tab.new'
  | 'wholesale.tab.ledger'
  | 'wholesale.tab.return'
  | 'wholesale.tab.history'
  | 'wholesale.party.add'
  | 'wholesale.party.pick'
  | 'wholesale.party.save'
  | 'wholesale.party.cancel'
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
  // ── settling a gold debt ──────────────────────────────────────────────────
  | 'wholesale.settle'
  | 'wholesale.settle.confirm'
  | 'wholesale.settle.back'
  // ── retail sale (M5) ──────────────────────────────────────────────────────
  | 'retail.customer.add'
  | 'retail.customer.pick'
  | 'retail.customer.save'
  | 'retail.customer.cancel'
  | 'retail.rate.refresh'
  | 'retail.unit.toggle'
  | 'retail.item.add'
  | 'retail.item.clear'
  | 'retail.labour.mode'
  | 'retail.item.edit'
  | 'retail.item.delete'
  | 'retail.item.print'
  // The bill's own print, which sends the invoice to the printer.
  | 'retail.bill.print'
  // ── the bill in progress ──────────────────────────────────────────────────
  | 'retail.draft.resume'
  | 'retail.draft.discard'
  | 'retail.save'
  | 'retail.save-and-print'
  | 'retail.print'
  | 'retail.hold'
  | 'retail.new'
  | 'retail.cancel'
  | 'retail.wastage.confirm'
  | 'retail.wastage.back'
  // ── quick actions panel ───────────────────────────────────────────────────
  | 'quick.wholesale-ledger'
  | 'quick.return-receive'
  | 'quick.print-last-invoice'
  | 'quick.party-balance'
  | 'quick.retail-whatsapp'
  // ── settings and backup (M0, live) ────────────────────────────────────────
  | 'backup.run'
  | 'backup.restore'
  | 'settings.shop-profile.save'
  | 'users.add'
  | 'users.switch'
  | 'users.sign-out'
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
  readonly minimizeWindow: () => void
  readonly toggleFullscreenWindow: () => void
  readonly closeWindow: () => void
  readonly toggleSidebar: () => void
  /** Puts the "Who is working?" card back up. */
  readonly switchUser: () => void
  /**
   * Hands an action to whichever screen is mounted.
   *
   * The alternative — threading every screen's state up into the registry —
   * would make the registry depend on the screens instead of the other way
   * round, and every new module would have to widen this interface. The screen
   * that owns the state listens; the registry stays a flat list of controls.
   */
  readonly dispatch: (id: ActionId) => void
}

/**
 * A control the mounted screen handles.
 *
 * Ready by definition — it has a handler. What it does depends on which screen
 * is listening, which is exactly the point: the registry lists controls, the
 * screens own behaviour.
 */
function screenAction(
  label: string,
  id: ActionId,
  dispatch: (id: ActionId) => void,
  shortcut?: string,
): ReadyAction {
  const base = { kind: 'ready' as const, label, run: () => dispatch(id) }
  return shortcut === undefined ? base : { ...base, shortcut }
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

  const screen = (label: string, id: ActionId, shortcut?: string): ReadyAction =>
    screenAction(label, id, context.dispatch, shortcut)

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


    // The window buttons go through the registry like everything else, so the
    // rendered-DOM test covers them too — chrome is not an exception.
    'window.minimize': {
      kind: 'ready',
      label: 'Minimise',
      run: () => context.minimizeWindow(),
    },
    // The id stays `window.maximize` on purpose. It is the middle window
    // button, it is asserted by id in the rendered-DOM test, and renaming it
    // would change a test-asserted id to record that its BEHAVIOUR changed —
    // which is what the label and the aria-label are for.
    'window.maximize': {
      kind: 'ready',
      label: 'Fullscreen',
      run: () => context.toggleFullscreenWindow(),
      shortcut: 'F11',
    },
    'window.close': { kind: 'ready', label: 'Close', run: () => context.closeWindow() },
    'app.user-menu': {
      kind: 'ready',
      label: 'Account menu',
      run: () => context.toggleUserMenu(),
    },
    'app.sidebar-toggle': {
      kind: 'ready',
      label: 'Collapse or expand the menu',
      run: () => context.toggleSidebar(),
      shortcut: 'Ctrl+B',
    },
    // One entry for the whole "Who is working?" card; each user's tile supplies
    // its own onActivate, the same way a rate row or a party match does.
    'user.pick': screen('Continue as this user', 'user.pick'),
    // Rendered once per message, each supplying its own onActivate.
    'message.dismiss': screen('Dismiss', 'message.dismiss'),

    // M0 — live.
    'rate.refresh': {
      kind: 'ready',
      label: 'Refresh gold rate',
      run: () => context.refreshRates(),
    },
    // Rendered once per rate row, each supplying its own onActivate — the
    // registry holds the control, the row holds which purity it is.
    'rate.edit': screen('Edit rate', 'rate.edit'),

    // The date field and its calendar. Like rate.edit, each instance supplies
    // its own onActivate because the registry is a flat list of controls, not a
    // list of the days in a month.
    'date.pick': screen('Choose a date', 'date.pick'),
    'date.day': screen('Choose this day', 'date.day'),
    'date.prev-month': screen('Previous month', 'date.prev-month'),
    'date.next-month': screen('Next month', 'date.next-month'),
    'backup.run': { kind: 'ready', label: 'Back Up Now', run: () => context.runBackup() },
    'backup.restore': {
      kind: 'ready',
      label: 'Restore From Backup',
      run: () => context.restoreBackup(),
    },

    // The Gold Rate screen is built and its form posts, so this is live.
    'goldrate.set': screen('Set Rate', 'goldrate.set'),

    // Still-undrawn M0 screens. The feature works; the form does not exist yet.
    'settings.shop-profile.save': notBuilt('Save Shop Profile', 'settings'),
    'users.add': notBuilt('Add User', 'users'),
    // Switching who is working does NOT need the Users & Permissions screen —
    // it needs the "Who is working?" card, which exists. Sign out still belongs
    // to that module, so it stays visibly off and says so.
    'users.switch': { kind: 'ready', label: 'Switch user', run: () => context.switchUser() },
    'users.sign-out': notBuilt('Sign out', 'users'),

    // M2 — Whole Sale. Built, so these are live. Each hands off to the screen
    // that owns the state (see ActionContext.dispatch).
    'wholesale.tab.new': screen('New Whole Sale', 'wholesale.tab.new'),
    'wholesale.tab.ledger': screen('Whole Sale Ledger', 'wholesale.tab.ledger'),
    'wholesale.tab.return': screen('Return / Receive', 'wholesale.tab.return'),
    'wholesale.tab.history': screen('History', 'wholesale.tab.history'),
    'wholesale.party.add': screen('Add Party', 'wholesale.party.add'),
    // One entry for the whole match list; each row supplies its own onActivate.
    'wholesale.party.pick': screen('Select Party', 'wholesale.party.pick'),
    'wholesale.party.save': screen('Save Party', 'wholesale.party.save'),
    'wholesale.party.cancel': screen('Cancel', 'wholesale.party.cancel'),
    'wholesale.invoice.search': screen('Find Invoice', 'wholesale.invoice.search'),
    'wholesale.row.add': screen('Add Row', 'wholesale.row.add'),
    'wholesale.row.clear': screen('Clear Row', 'wholesale.row.clear'),
    'wholesale.row.delete': screen('Delete Row', 'wholesale.row.delete'),
    'wholesale.save': screen('SAVE', 'wholesale.save', 'F5'),
    'wholesale.save-and-print': screen('SAVE & PRINT', 'wholesale.save-and-print', 'F6'),
    'wholesale.print': screen('PRINT', 'wholesale.print', 'F7'),
    'wholesale.hold': screen('HOLD', 'wholesale.hold', 'F8'),
    'wholesale.cancel': screen('CANCEL', 'wholesale.cancel'),
    'wholesale.ledger.view-full': screen('View Full Ledger', 'wholesale.ledger.view-full'),
    'wholesale.ledger.view-entry': screen('View Entry', 'wholesale.ledger.view-entry'),

    // Settling. The over-return path is a question with a Continue button, so
    // both answers are real controls rather than one button and a dismiss.
    'wholesale.settle': screen('Post settlement', 'wholesale.settle'),
    'wholesale.settle.confirm': screen('Post this settlement anyway', 'wholesale.settle.confirm'),
    'wholesale.settle.back': screen('Go back and change the amounts', 'wholesale.settle.back'),

    // Belong to other modules even though they appear on the wholesale screen.
    // Labelling them by their real owner is the point: "Import from Stock" is
    // blocked by Stock Management, not by Whole Sale, and the hover text says so.
    'wholesale.import-from-stock': notBuilt('Import from Stock', 'stock'),
    'wholesale.scan-barcode': notBuilt('Scan Barcode', 'stock'),

    // M5 — Sale (Retail). Built, so these are live. Each hands off to the
    // screen that owns the state, exactly as the wholesale ones do.
    'retail.customer.add': screen('Add Customer', 'retail.customer.add'),
    // One entry for the whole match list; each row supplies its own onActivate.
    'retail.customer.pick': screen('Select Customer', 'retail.customer.pick'),
    'retail.customer.save': screen('Save Customer', 'retail.customer.save'),
    'retail.customer.cancel': screen('Cancel', 'retail.customer.cancel'),
    'retail.rate.refresh': screen('Use the recorded rate', 'retail.rate.refresh'),
    'retail.unit.toggle': screen('Show weights in grams or tola', 'retail.unit.toggle'),
    // Rendered once per row for edit and delete, each supplying its own
    // onActivate — the registry holds the control, the row holds which line.
    'retail.item.add': screen('ADD ITEM', 'retail.item.add', 'F2'),
    'retail.item.clear': screen('CLEAR ENTRY', 'retail.item.clear'),
    'retail.labour.mode': screen('Charge labour as a fixed amount or per tola', 'retail.labour.mode'),
    'retail.item.edit': screen('Edit this line', 'retail.item.edit'),
    'retail.item.delete': screen('Remove this line', 'retail.item.delete'),
    'retail.item.print': screen('Print this item', 'retail.item.print'),
    'retail.bill.print': screen('Print every slip in this bill', 'retail.bill.print'),
    'retail.draft.resume': screen('Carry on with this bill', 'retail.draft.resume'),
    'retail.draft.discard': screen('Throw this draft away', 'retail.draft.discard'),
    'retail.save': screen('SAVE', 'retail.save', 'F5'),
    'retail.save-and-print': screen('SAVE & PRINT', 'retail.save-and-print', 'F6'),
    'retail.print': screen('PRINT', 'retail.print', 'F7'),
    'retail.hold': screen('HOLD', 'retail.hold', 'F8'),
    'retail.new': screen('NEW SALE', 'retail.new', 'F9'),
    'retail.cancel': screen('CANCEL', 'retail.cancel'),
    // High wastage is a question with a Continue button, so both answers are
    // real controls rather than one button and a dismiss.
    'retail.wastage.confirm': screen('Save this sale anyway', 'retail.wastage.confirm'),
    'retail.wastage.back': screen('Go back and check the wastage', 'retail.wastage.back'),

    'quick.wholesale-ledger': screen('Whole Sale Ledger', 'wholesale.tab.ledger'),
    'quick.return-receive': screen('Return / Receive', 'wholesale.tab.return'),
    'quick.print-last-invoice': screen('Print Last Invoice', 'wholesale.print'),
    // Party Balance belongs to Customers (M1's own screen), not to Whole Sale.
    'quick.party-balance': notBuilt('Party Balance', 'customers'),
    // Leaves the application. Marked as such on the button itself, because a
    // control that hands the shop's PC to another program should say so before
    // it is pressed rather than after.
    'quick.retail-whatsapp': screen(
      'Send on WhatsApp — opens outside this application',
      'quick.retail-whatsapp',
    ),
  }
}

/** Hover text for a control. Ready actions show their shortcut, if any. */
export function actionTitle(action: Action): string {
  if (action.kind === 'not-built') {
    return notBuiltMessage(action.module)
  }
  return action.shortcut ? `${action.label} (${action.shortcut})` : action.label
}
