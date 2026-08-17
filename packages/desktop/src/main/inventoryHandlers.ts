import {
  Katt,
  Money,
  formatPurity,
  isMakingChargeBasis,
  parsePurity,
  type Item,
  type ItemCategory,
  type PublicUser,
} from '@jewellery/domain'
import type { InventoryService, ItemUpdate, PartyRepository } from '@jewellery/application'
import type {
  CategoryNodeDto,
  InventorySetupResult,
  ItemDto,
  LocationDto,
  SaveItemRequest,
  SaveItemResult,
} from '../shared/ipc.js'
import type { Session } from './session.js'

/**
 * The item master boundary, with no Electron anywhere in the file.
 *
 * The same rules as every handler file: nothing throws across the boundary
 * (a read that cannot answer returns an empty list; a write that cannot
 * proceed returns `{ ok: false, message }`), and every label the renderer
 * shows — the category path, the making-charge wording, the purity — is
 * preformatted here.
 */

export interface InventoryHandlerDeps {
  readonly branchId: string
  readonly inventory: InventoryService
  readonly parties: PartyRepository
  readonly session: Session
}

function requireUser(deps: InventoryHandlerDeps): PublicUser {
  const user = deps.session.user
  if (!user) throw new Error('No user is signed in.')
  return user
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** "Rings › Ladies", "Rings", or "—". The renderer never walks the tree. */
function categoryLabelOf(
  categoryId: string | null,
  byId: Map<string, ItemCategory>,
): string {
  if (!categoryId) return '—'
  const category = byId.get(categoryId)
  if (!category) return '—'
  if (!category.parentId) return category.name
  const parent = byId.get(category.parentId)
  return parent ? `${parent.name} › ${category.name}` : category.name
}

function itemDto(deps: InventoryHandlerDeps, item: Item, byId: Map<string, ItemCategory>): ItemDto {
  const supplier = item.supplierId ? deps.parties.findById(item.supplierId) : null
  const charge = item.defaultMakingCharge
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    categoryId: item.categoryId,
    categoryLabel: categoryLabelOf(item.categoryId, byId),
    purity: item.purity,
    purityDisplay: formatPurity(item.purity),
    defaultKattDisplay: item.defaultKatt.format(),
    makingChargeBasis: item.makingChargeBasis,
    makingChargeDisplay: charge.isZero
      ? '—'
      : `Rs ${charge.formatWhole()}${item.makingChargeBasis === 'per_tola' ? ' / tola' : ''}`,
    makingChargeRupees: charge.isZero ? '' : charge.format(),
    supplierId: item.supplierId,
    supplierName: supplier?.name ?? '',
    designNo: item.designNo,
    notes: item.notes,
    isActive: item.isActive,
  }
}

function categoriesById(deps: InventoryHandlerDeps): Map<string, ItemCategory> {
  return new Map(
    deps.inventory.listCategories(deps.branchId, true).map((category) => [category.id, category]),
  )
}

/** The request's typed strings, parsed strictly. Throws ValidationError-shaped messages. */
function parsedItemFields(request: SaveItemRequest): Omit<ItemUpdate, 'name' | 'categoryId' | 'supplierId'> & {
  name: string
  categoryId: string | null
  supplierId: string | null
} {
  if (!isMakingChargeBasis(request.makingChargeBasis)) {
    throw new Error('Choose how the making charge is quoted: fixed, or per tola.')
  }
  return {
    name: request.name,
    categoryId: request.categoryId,
    purity: parsePurity(request.purity),
    defaultKatt: Katt.parse(request.defaultKattRatti.trim() || '0'),
    makingChargeBasis: request.makingChargeBasis,
    defaultMakingCharge: request.makingChargeRupees.trim()
      ? Money.parse(request.makingChargeRupees)
      : Money.ZERO,
    supplierId: request.supplierId,
    designNo: request.designNo,
    notes: request.notes,
  }
}

export function inventoryItems(
  deps: InventoryHandlerDeps,
  query: string,
  includeInactive: boolean,
): ItemDto[] {
  try {
    requireUser(deps)
    const byId = categoriesById(deps)
    return deps.inventory
      .searchItems(deps.branchId, query, includeInactive === true)
      .map((item) => itemDto(deps, item, byId))
  } catch {
    return []
  }
}

export function inventoryItemCreate(
  deps: InventoryHandlerDeps,
  request: SaveItemRequest,
): SaveItemResult {
  try {
    const actor = requireUser(deps)
    const fields = parsedItemFields(request)
    const created = deps.inventory.createItem(actor, {
      branchId: deps.branchId,
      code: request.code,
      ...fields,
    })
    return { ok: true, item: itemDto(deps, created, categoriesById(deps)) }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryItemUpdate(
  deps: InventoryHandlerDeps,
  itemId: string,
  request: SaveItemRequest,
): SaveItemResult {
  try {
    const actor = requireUser(deps)
    const updated = deps.inventory.updateItem(actor, itemId, parsedItemFields(request))
    return { ok: true, item: itemDto(deps, updated, categoriesById(deps)) }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryItemSetActive(
  deps: InventoryHandlerDeps,
  itemId: string,
  isActive: boolean,
): InventorySetupResult {
  try {
    deps.inventory.setItemActive(requireUser(deps), itemId, isActive === true)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryCategoryTree(
  deps: InventoryHandlerDeps,
  includeInactive: boolean,
): CategoryNodeDto[] {
  try {
    requireUser(deps)
    return deps.inventory
      .categoryTree(deps.branchId, includeInactive === true)
      .map((node) => ({
        id: node.category.id,
        name: node.category.name,
        isActive: node.category.isActive,
        children: node.children.map((child) => ({
          id: child.id,
          name: child.name,
          isActive: child.isActive,
        })),
      }))
  } catch {
    return []
  }
}

export function inventoryCategoryCreate(
  deps: InventoryHandlerDeps,
  parentId: string | null,
  name: string,
): InventorySetupResult {
  try {
    deps.inventory.createCategory(requireUser(deps), {
      branchId: deps.branchId,
      parentId,
      name,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryCategoryRename(
  deps: InventoryHandlerDeps,
  categoryId: string,
  name: string,
): InventorySetupResult {
  try {
    deps.inventory.renameCategory(requireUser(deps), categoryId, name)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryCategorySetActive(
  deps: InventoryHandlerDeps,
  categoryId: string,
  isActive: boolean,
): InventorySetupResult {
  try {
    deps.inventory.setCategoryActive(requireUser(deps), categoryId, isActive === true)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryLocations(
  deps: InventoryHandlerDeps,
  includeInactive: boolean,
): LocationDto[] {
  try {
    requireUser(deps)
    return deps.inventory
      .listLocations(deps.branchId, includeInactive === true)
      .map((location) => ({
        id: location.id,
        name: location.name,
        isActive: location.isActive,
      }))
  } catch {
    return []
  }
}

export function inventoryLocationCreate(
  deps: InventoryHandlerDeps,
  name: string,
): InventorySetupResult {
  try {
    deps.inventory.createLocation(requireUser(deps), deps.branchId, name)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryLocationRename(
  deps: InventoryHandlerDeps,
  locationId: string,
  name: string,
): InventorySetupResult {
  try {
    deps.inventory.renameLocation(requireUser(deps), locationId, name)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function inventoryLocationSetActive(
  deps: InventoryHandlerDeps,
  locationId: string,
  isActive: boolean,
): InventorySetupResult {
  try {
    deps.inventory.setLocationActive(requireUser(deps), locationId, isActive === true)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}
