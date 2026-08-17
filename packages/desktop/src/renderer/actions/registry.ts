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
  // ── the toolbar: walking the slip book, and finding one slip fast ─────────
  // The retail toolbar's four controls, over the wholesale ISSUE book. Same
  // rule about the ends: FIRST and LAST are dead only when the book is empty,
  // PREV and NEXT go dead at the edges, and none of them is ever hidden.
  | 'wholesale.nav.first'
  | 'wholesale.nav.prev'
  | 'wholesale.nav.next'
  | 'wholesale.nav.last'
  | 'wholesale.invoice.jump'
  | 'wholesale.new'
  /** Unlocks a posted slip for a correction, which saves as a NEW slip. */
  | 'wholesale.edit'
  | 'wholesale.reversed.toggle'
  // The unsaved-changes guard: three real answers, never two and a dismiss.
  | 'wholesale.guard.save'
  | 'wholesale.guard.discard'
  | 'wholesale.guard.cancel'
  // ── settling a gold debt ──────────────────────────────────────────────────
  | 'wholesale.settle'
  | 'wholesale.settle.confirm'
  | 'wholesale.settle.back'
  // ── purchase (M6) ─────────────────────────────────────────────────────────
  // The wholesale toolbar and grid vocabulary, over the purchase book. Same
  // shapes on purpose: it is one pair of hands moving between the screens.
  | 'purchase.invoice.search'
  | 'purchase.invoice.jump'
  | 'purchase.row.add'
  | 'purchase.row.clear'
  | 'purchase.row.delete'
  | 'purchase.import-from-stock'
  | 'purchase.scan-barcode'
  | 'purchase.save'
  | 'purchase.save-and-print'
  | 'purchase.print'
  | 'purchase.hold'
  | 'purchase.cancel'
  | 'purchase.new'
  | 'purchase.nav.first'
  | 'purchase.nav.prev'
  | 'purchase.nav.next'
  | 'purchase.nav.last'
  /** Cancels a POSTED purchase: reversing stock rows, status flip, reason kept. */
  | 'purchase.void'
  | 'purchase.void.confirm'
  | 'purchase.void.back'
  | 'purchase.cancelled.toggle'
  | 'purchase.guard.save'
  | 'purchase.guard.discard'
  | 'purchase.guard.cancel'
  // ── stock (M4) ────────────────────────────────────────────────────────────
  | 'stock.tab.summary'
  | 'stock.tab.ledger'
  | 'stock.tab.adjust'
  | 'stock.tab.items'
  | 'stock.tab.setup'
  | 'stock.tab.inventory'
  | 'stock.tab.opening'
  | 'stock.refresh'
  // ── the piece register (M4 stage 2) ───────────────────────────────────────
  /** The three groupings; each instance supplies its own onActivate. */
  | 'inventory.regroup'
  /** Rendered once per summary row / piece row; each supplies onActivate. */
  | 'inventory.drill'
  | 'inventory.back'
  | 'piece.open'
  | 'piece.move.save'
  | 'piece.close'
  | 'opening.row.add'
  | 'opening.row.clear'
  | 'opening.row.delete'
  | 'opening.save'
  | 'stock.adjust.save'
  /** Rendered once per ledger row with a reference; each supplies onActivate. */
  | 'stock.ledger.open-ref'
  // ── the item master (M4 stage 1) ──────────────────────────────────────────
  | 'item.add'
  | 'item.save'
  | 'item.cancel'
  /** Rendered once per row; each supplies its own onActivate. */
  | 'item.edit'
  | 'item.active.toggle'
  | 'item.inactive.show'
  | 'category.add'
  | 'category.rename'
  | 'category.active.toggle'
  | 'location.add'
  | 'location.rename'
  | 'location.active.toggle'
  /** The one rename dialog categories and locations share. */
  | 'setup.rename.save'
  | 'setup.rename.cancel'
  // ── retail sale (M5) ──────────────────────────────────────────────────────
  | 'retail.customer.add'
  | 'retail.customer.pick'
  | 'retail.customer.save'
  | 'retail.customer.cancel'
  | 'retail.rate.refresh'
  | 'retail.unit.toggle'
  | 'retail.item.add'
  | 'retail.items.scroll-left'
  | 'retail.items.scroll-right'
  | 'retail.labour.mode'
  | 'retail.item.delete'
  | 'retail.item.print'
  // The bill's own print, which sends the invoice to the printer.
  | 'retail.bill.print'
  // ── the bill in progress ──────────────────────────────────────────────────
  // ── the toolbar: walking the book, and finding one bill fast ──────────────
  | 'retail.nav.first'
  | 'retail.nav.prev'
  | 'retail.nav.next'
  | 'retail.nav.last'
  | 'retail.invoice.jump'
  | 'retail.voided.toggle'
  /** Unlocks a posted invoice for correction, if the role allows it. */
  | 'retail.edit'
  // ── the unsaved-changes guard ─────────────────────────────────────────────
  // Three real answers, never two and a dismiss. "Cancel" has to be a control
  // the operator can press on purpose, or the safe answer becomes the one you
  // get by pressing Escape and hoping.
  | 'retail.guard.save'
  | 'retail.guard.discard'
  | 'retail.guard.cancel'
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
  | 'settings.section'
  | 'settings.shop-profile.save'
  | 'settings.print.save'
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
    // One entry for the whole section list; each button supplies its own
    // onActivate, the same way a rate row or a party match does.
    'settings.section': screen('Show this section', 'settings.section'),
    // Both live now: the shop's own details and everything that comes out of
    // the printer are edited on the Settings screen and written to the database.
    'settings.shop-profile.save': screen('Save Shop Details', 'settings.shop-profile.save'),
    'settings.print.save': screen('Save Print Settings', 'settings.print.save'),
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

    // The four navigation controls, and the number box beside them. Same
    // shortcuts as retail's, because it is the same movement through the same
    // kind of book — an operator who learns it on one screen has learned it on
    // both.
    'wholesale.nav.first': screen('First slip', 'wholesale.nav.first', 'Ctrl+Home'),
    'wholesale.nav.prev': screen('Previous slip', 'wholesale.nav.prev', 'Ctrl+←'),
    'wholesale.nav.next': screen('Next slip', 'wholesale.nav.next', 'Ctrl+→'),
    'wholesale.nav.last': screen('Last slip', 'wholesale.nav.last', 'Ctrl+End'),
    'wholesale.invoice.jump': screen('Go to this slip number', 'wholesale.invoice.jump'),
    'wholesale.new': screen('NEW SLIP', 'wholesale.new', 'F9'),
    'wholesale.edit': screen('Correct this posted slip', 'wholesale.edit'),
    'wholesale.reversed.toggle': screen('Show reversed slips too', 'wholesale.reversed.toggle'),
    'wholesale.guard.save': screen('Save this slip, then go', 'wholesale.guard.save'),
    'wholesale.guard.discard': screen('Throw these changes away and go', 'wholesale.guard.discard'),
    'wholesale.guard.cancel': screen('Stay on this slip', 'wholesale.guard.cancel'),

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

    // M6 — Purchase. Built, so these are live. Each hands off to the screen
    // that owns the state, exactly as the wholesale ones do.
    'purchase.invoice.search': screen('Find Purchase', 'purchase.invoice.search'),
    'purchase.invoice.jump': screen('Go to this purchase number', 'purchase.invoice.jump'),
    'purchase.row.add': screen('Add Row', 'purchase.row.add'),
    'purchase.row.clear': screen('Clear Row', 'purchase.row.clear'),
    'purchase.row.delete': screen('Delete Row', 'purchase.row.delete'),
    'purchase.save': screen('SAVE', 'purchase.save', 'F5'),
    'purchase.save-and-print': screen('SAVE & PRINT', 'purchase.save-and-print', 'F6'),
    'purchase.print': screen('PRINT', 'purchase.print', 'F7'),
    'purchase.hold': screen('HOLD', 'purchase.hold', 'F8'),
    'purchase.cancel': screen('CANCEL', 'purchase.cancel'),
    'purchase.new': screen('NEW PURCHASE', 'purchase.new', 'F9'),
    'purchase.nav.first': screen('First purchase', 'purchase.nav.first', 'Ctrl+Home'),
    'purchase.nav.prev': screen('Previous purchase', 'purchase.nav.prev', 'Ctrl+←'),
    'purchase.nav.next': screen('Next purchase', 'purchase.nav.next', 'Ctrl+→'),
    'purchase.nav.last': screen('Last purchase', 'purchase.nav.last', 'Ctrl+End'),
    'purchase.void': screen('Cancel this posted purchase', 'purchase.void'),
    'purchase.void.confirm': screen('Cancel it — write the reversing rows', 'purchase.void.confirm'),
    'purchase.void.back': screen('Keep the purchase as it is', 'purchase.void.back'),
    'purchase.cancelled.toggle': screen('Show cancelled purchases too', 'purchase.cancelled.toggle'),
    'purchase.guard.save': screen('Save this purchase, then go', 'purchase.guard.save'),
    'purchase.guard.discard': screen('Throw these changes away and go', 'purchase.guard.discard'),
    'purchase.guard.cancel': screen('Stay on this purchase', 'purchase.guard.cancel'),
    // Same rule as the wholesale pair below: the import/scan features are not
    // built, and the hover text says so rather than the buttons pretending.
    'purchase.import-from-stock': notBuilt('Import from Stock', 'stock'),
    'purchase.scan-barcode': notBuilt('Scan Barcode', 'stock'),

    // M4 — Stock Management. Built, so these are live.
    'stock.tab.summary': screen('Summary', 'stock.tab.summary'),
    'stock.tab.ledger': screen('Ledger', 'stock.tab.ledger'),
    'stock.tab.adjust': screen('Adjustment', 'stock.tab.adjust'),
    'stock.tab.items': screen('Items', 'stock.tab.items'),
    'stock.tab.setup': screen('Categories & Locations', 'stock.tab.setup'),
    'stock.tab.inventory': screen('Inventory', 'stock.tab.inventory'),
    'stock.tab.opening': screen('Opening Stock', 'stock.tab.opening'),
    'stock.refresh': screen('Refresh stock figures', 'stock.refresh'),

    // M4 stage 2 — the piece register.
    'inventory.regroup': screen('Group the summary differently', 'inventory.regroup'),
    'inventory.drill': screen('Show the pieces behind this row', 'inventory.drill'),
    'inventory.back': screen('Back to the summary', 'inventory.back'),
    'piece.open': screen('Open this piece', 'piece.open'),
    'piece.move.save': screen('Move this piece', 'piece.move.save'),
    'piece.close': screen('Close', 'piece.close'),
    'opening.row.add': screen('Add Row', 'opening.row.add'),
    'opening.row.clear': screen('Clear Row', 'opening.row.clear'),
    'opening.row.delete': screen('Delete Row', 'opening.row.delete'),
    'opening.save': screen('Post Opening Stock', 'opening.save', 'F5'),
    'stock.adjust.save': screen('Record Adjustment', 'stock.adjust.save'),
    'stock.ledger.open-ref': screen('Open the source document', 'stock.ledger.open-ref'),

    // M4 stage 1 — the item master, categories and locations.
    'item.add': screen('Add Item', 'item.add'),
    'item.save': screen('Save Item', 'item.save'),
    'item.cancel': screen('Cancel', 'item.cancel'),
    'item.edit': screen('Edit this item', 'item.edit'),
    'item.active.toggle': screen('Activate or deactivate this item', 'item.active.toggle'),
    'item.inactive.show': screen('Show deactivated items too', 'item.inactive.show'),
    'category.add': screen('Add Category', 'category.add'),
    'category.rename': screen('Rename this category', 'category.rename'),
    'category.active.toggle': screen(
      'Activate or deactivate this category',
      'category.active.toggle',
    ),
    'location.add': screen('Add Location', 'location.add'),
    'location.rename': screen('Rename this location', 'location.rename'),
    'location.active.toggle': screen(
      'Activate or deactivate this location',
      'location.active.toggle',
    ),
    'setup.rename.save': screen('Save the new name', 'setup.rename.save'),
    'setup.rename.cancel': screen('Keep the old name', 'setup.rename.cancel'),

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
    'retail.items.scroll-left': screen('Scroll items left', 'retail.items.scroll-left'),
    'retail.items.scroll-right': screen('Scroll items right', 'retail.items.scroll-right'),
    'retail.labour.mode': screen('Charge labour as a fixed amount or per tola', 'retail.labour.mode'),
    'retail.item.delete': screen('Remove this line', 'retail.item.delete'),
    'retail.item.print': screen('Print this item', 'retail.item.print'),
    'retail.bill.print': screen('Print every slip in this bill', 'retail.bill.print'),
    'retail.draft.resume': screen('Carry on with this bill', 'retail.draft.resume'),
    'retail.draft.discard': screen('Throw this draft away', 'retail.draft.discard'),
    // The four navigation controls. FIRST and LAST are never disabled by
    // position — only by an empty book; PREV and NEXT go dead at the ends,
    // which is what tells the operator they are on the first or last bill.
    'retail.nav.first': screen('First invoice', 'retail.nav.first', 'Ctrl+Home'),
    'retail.nav.prev': screen('Previous invoice', 'retail.nav.prev', 'Ctrl+←'),
    'retail.nav.next': screen('Next invoice', 'retail.nav.next', 'Ctrl+→'),
    'retail.nav.last': screen('Last invoice', 'retail.nav.last', 'Ctrl+End'),
    'retail.invoice.jump': screen('Go to this invoice number', 'retail.invoice.jump'),
    'retail.voided.toggle': screen('Show voided invoices too', 'retail.voided.toggle'),
    'retail.edit': screen('Edit this posted invoice', 'retail.edit'),
    'retail.guard.save': screen('Save this invoice, then go', 'retail.guard.save'),
    'retail.guard.discard': screen('Throw these changes away and go', 'retail.guard.discard'),
    'retail.guard.cancel': screen('Stay on this invoice', 'retail.guard.cancel'),
    'retail.save': screen('SAVE', 'retail.save', 'Ctrl+S'),
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
