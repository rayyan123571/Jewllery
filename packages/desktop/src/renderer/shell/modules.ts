/**
 * Every module in the application, in the order the mockup's sidebar shows them.
 *
 * All of them render from day one. The ones that are not built are visibly
 * disabled and say which module they belong to, so the whole shape of the app is
 * visible even while most of it is off — and so an unbuilt area can never be
 * mistaken for a broken one.
 *
 * `builtIn` is the milestone that delivers the module. When a module ships, its
 * entry changes here and its controls become live. Nothing else changes.
 */

export type ModuleId =
  | 'dashboard'
  | 'sale-retail'
  | 'wholesale'
  | 'purchase'
  | 'stock'
  | 'customers'
  | 'suppliers'
  | 'roznamcha'
  | 'reports'
  | 'gold-rate'
  | 'backup-restore'
  | 'settings'
  | 'users'
  | 'tools'

/**
 * The sidebar's section headings.
 *
 * Presentation only. Grouping does NOT reorder anything: the groups are
 * contiguous runs of the existing list, so the sidebar renders MODULES in the
 * order below exactly as it always has and simply emits a heading where the
 * group changes. Dashboard carries no group on purpose — it is an overview of
 * everything, not a member of one section — so it sits above the first heading.
 */
export type ModuleGroup = 'SALES' | 'INVENTORY' | 'PEOPLE' | 'SYSTEM'

export interface ModuleDefinition {
  readonly id: ModuleId
  /** Exactly as written in the mockup. */
  readonly label: string
  /** Milestone that delivers it, e.g. 'M2'. Null when already delivered. */
  readonly builtIn: string | null
  /** Whether it appears in the top module bar as well as the sidebar. */
  readonly inTopBar: boolean
  /** Lucide-style icon key, resolved by the Icon component. */
  readonly icon: string
  /** Sidebar section. Optional: an ungrouped module renders before the first. */
  readonly group?: ModuleGroup
}

export const MODULES: readonly ModuleDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', builtIn: null, inTopBar: true, icon: 'home' },
  { id: 'sale-retail', label: 'Sale (Retail)', builtIn: null, inTopBar: true, icon: 'cart', group: 'SALES' },
  { id: 'wholesale', label: 'Whole Sale', builtIn: 'M2', inTopBar: true, icon: 'wholesale', group: 'SALES' },
  { id: 'purchase', label: 'Purchase', builtIn: 'M6', inTopBar: true, icon: 'purchase', group: 'SALES' },
  { id: 'stock', label: 'Stock Management', builtIn: 'M4', inTopBar: true, icon: 'stock', group: 'INVENTORY' },
  { id: 'customers', label: 'Customers', builtIn: 'M1', inTopBar: true, icon: 'user', group: 'PEOPLE' },
  { id: 'suppliers', label: 'Suppliers', builtIn: 'M1', inTopBar: true, icon: 'suppliers', group: 'PEOPLE' },
  { id: 'roznamcha', label: 'Roznamcha', builtIn: 'M7', inTopBar: true, icon: 'book', group: 'SYSTEM' },
  { id: 'reports', label: 'Reports', builtIn: 'M8', inTopBar: true, icon: 'chart', group: 'SYSTEM' },
  { id: 'gold-rate', label: 'Gold Rate', builtIn: null, inTopBar: true, icon: 'scale', group: 'SYSTEM' },
  { id: 'backup-restore', label: 'Backup / Restore', builtIn: null, inTopBar: false, icon: 'shield', group: 'SYSTEM' },
  { id: 'settings', label: 'Settings', builtIn: null, inTopBar: true, icon: 'gear', group: 'SYSTEM' },
  { id: 'users', label: 'Users & Permissions', builtIn: null, inTopBar: false, icon: 'users', group: 'SYSTEM' },
  { id: 'tools', label: 'Tools', builtIn: 'M9', inTopBar: false, icon: 'tools', group: 'SYSTEM' },
]

const BY_ID = new Map(MODULES.map((m) => [m.id, m]))

export function moduleById(id: ModuleId): ModuleDefinition {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown module: ${id}`)
  return found
}

export function isModuleBuilt(id: ModuleId): boolean {
  return moduleById(id).builtIn === null
}

/**
 * The hover text on any control belonging to a module that is not built.
 *
 * Two cases, because they are two different situations and the operator can act
 * on the difference. A module that has not shipped names its milestone. A module
 * whose feature IS built but whose screen has not been drawn cannot name one —
 * it used to interpolate `builtIn` regardless and put the literal text
 * "(null)" in front of the user.
 */
export function notBuiltMessage(id: ModuleId): string {
  const module = moduleById(id)
  return module.builtIn === null
    ? `${module.label} — screen not built yet`
    : `${module.label} — not built yet (${module.builtIn})`
}
