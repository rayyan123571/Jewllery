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
}

export const MODULES: readonly ModuleDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', builtIn: null, inTopBar: true, icon: 'home' },
  { id: 'sale-retail', label: 'Sale (Retail)', builtIn: 'M5', inTopBar: true, icon: 'cart' },
  { id: 'wholesale', label: 'Whole Sale', builtIn: 'M2', inTopBar: true, icon: 'wholesale' },
  { id: 'purchase', label: 'Purchase', builtIn: 'M6', inTopBar: true, icon: 'purchase' },
  { id: 'stock', label: 'Stock Management', builtIn: 'M4', inTopBar: true, icon: 'stock' },
  { id: 'customers', label: 'Customers', builtIn: 'M1', inTopBar: true, icon: 'user' },
  { id: 'suppliers', label: 'Suppliers', builtIn: 'M1', inTopBar: true, icon: 'suppliers' },
  { id: 'roznamcha', label: 'Roznamcha', builtIn: 'M7', inTopBar: true, icon: 'book' },
  { id: 'reports', label: 'Reports', builtIn: 'M8', inTopBar: true, icon: 'chart' },
  { id: 'gold-rate', label: 'Gold Rate', builtIn: null, inTopBar: true, icon: 'scale' },
  { id: 'backup-restore', label: 'Backup / Restore', builtIn: null, inTopBar: false, icon: 'shield' },
  { id: 'settings', label: 'Settings', builtIn: null, inTopBar: true, icon: 'gear' },
  { id: 'users', label: 'Users & Permissions', builtIn: null, inTopBar: false, icon: 'users' },
  { id: 'tools', label: 'Tools', builtIn: 'M9', inTopBar: false, icon: 'tools' },
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

/** The hover text on any control belonging to a module that is not built. */
export function notBuiltMessage(id: ModuleId): string {
  const module = moduleById(id)
  return `${module.label} — not built yet (${module.builtIn})`
}
