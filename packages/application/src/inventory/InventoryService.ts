import type {
  Clock,
  Item,
  ItemCategory,
  PublicUser,
  StockLocation,
} from '@jewellery/domain'
import type {
  AuditRepository,
  ItemCategoryRepository,
  ItemRepository,
  ItemUpdate,
  LocationRepository,
  NewItem,
  PartyRepository,
} from '../abstractions/repositories.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * The item master, the category tree, and the locations.
 *
 * Definitions only — no weight, no quantity, no stock. What this service owns
 * is the validation the repositories deliberately do not: code uniqueness said
 * as a sentence rather than a constraint error, the two-level limit on the
 * tree, and the audit trail. Stock itself is the pieces (stage 2), which is
 * why nothing here ever touches the stock ledger.
 */

export interface InventoryDependencies {
  readonly items: ItemRepository
  readonly itemCategories: ItemCategoryRepository
  readonly locations: LocationRepository
  readonly parties: PartyRepository
  readonly audit: AuditRepository
  readonly clock: Clock
}

export interface CreateItemInput {
  readonly branchId: string
  readonly code: string
  readonly name: string
  readonly categoryId: string | null
  readonly purity: NewItem['purity']
  readonly defaultKatt: NewItem['defaultKatt']
  readonly makingChargeBasis: NewItem['makingChargeBasis']
  readonly defaultMakingCharge: NewItem['defaultMakingCharge']
  readonly supplierId: string | null
  readonly designNo: string | null
  readonly notes: string | null
}

/** A top-level category with its children, for the tree editor and dropdowns. */
export interface CategoryNode {
  readonly category: ItemCategory
  readonly children: readonly ItemCategory[]
}

export class InventoryService {
  constructor(private readonly deps: InventoryDependencies) {}

  /** The same rule party codes follow: trimmed, uppercased, compared NOCASE. */
  static normaliseCode(code: string): string {
    return code.trim().toUpperCase()
  }

  // ── items ─────────────────────────────────────────────────────────────────

  createItem(actor: PublicUser, input: CreateItemInput): Item {
    const code = InventoryService.normaliseCode(input.code)
    if (code.length === 0) throw new ValidationError('An item needs a code.')
    if (input.name.trim().length === 0) throw new ValidationError('An item needs a name.')

    const existing = this.deps.items.findByCode(input.branchId, code)
    if (existing) {
      throw new ValidationError(
        `Code ${code} is already "${existing.name}". Codes print on tags, so two ` +
          `items cannot share one.`,
      )
    }
    this.requireCategory(input.categoryId)
    this.requireSupplier(input.supplierId)

    const created = this.deps.items.create({
      branchId: input.branchId,
      code,
      name: input.name.trim(),
      categoryId: input.categoryId,
      purity: input.purity,
      defaultKatt: input.defaultKatt,
      makingChargeBasis: input.makingChargeBasis,
      defaultMakingCharge: input.defaultMakingCharge,
      supplierId: input.supplierId,
      designNo: emptyToNull(input.designNo),
      notes: emptyToNull(input.notes),
      createdByUserId: actor.id,
    })
    this.audit(actor, 'ITEM_CREATED', 'items', created.id, created.branchId, {
      code: created.code,
      name: created.name,
    })
    return created
  }

  updateItem(actor: PublicUser, id: string, changes: ItemUpdate): Item {
    if (changes.name.trim().length === 0) throw new ValidationError('An item needs a name.')
    this.requireItem(id)
    this.requireCategory(changes.categoryId)
    this.requireSupplier(changes.supplierId)

    const updated = this.deps.items.update(id, {
      ...changes,
      name: changes.name.trim(),
      designNo: emptyToNull(changes.designNo),
      notes: emptyToNull(changes.notes),
    })
    this.audit(actor, 'ITEM_UPDATED', 'items', id, updated.branchId, { name: updated.name })
    return updated
  }

  setItemActive(actor: PublicUser, id: string, isActive: boolean): Item {
    this.requireItem(id)
    const updated = this.deps.items.setActive(id, isActive)
    this.audit(actor, isActive ? 'ITEM_UPDATED' : 'ITEM_DEACTIVATED', 'items', id, updated.branchId, {
      isActive,
    })
    return updated
  }

  searchItems(branchId: string, query: string, includeInactive = false, limit = 50): Item[] {
    const term = query.trim()
    // Unlike the party selector, an EMPTY query answers with the list: the
    // items tab is a register to read, not only a box to type into.
    if (term.length === 0) return this.deps.items.list(branchId, includeInactive).slice(0, limit)
    return this.deps.items.search(branchId, term, includeInactive, limit)
  }

  findItemById(id: string): Item | null {
    return this.deps.items.findById(id)
  }

  // ── the category tree ─────────────────────────────────────────────────────

  categoryTree(branchId: string, includeInactive = false): CategoryNode[] {
    const all = this.deps.itemCategories.list(branchId, includeInactive)
    const byParent = new Map<string, ItemCategory[]>()
    for (const category of all) {
      if (category.parentId === null) continue
      const siblings = byParent.get(category.parentId) ?? []
      siblings.push(category)
      byParent.set(category.parentId, siblings)
    }
    return all
      .filter((category) => category.parentId === null)
      .map((category) => ({ category, children: byParent.get(category.id) ?? [] }))
  }

  listCategories(branchId: string, includeInactive = false): ItemCategory[] {
    return this.deps.itemCategories.list(branchId, includeInactive)
  }

  createCategory(
    actor: PublicUser,
    input: { branchId: string; parentId: string | null; name: string },
  ): ItemCategory {
    const name = input.name.trim()
    if (name.length === 0) throw new ValidationError('A category needs a name.')

    if (input.parentId !== null) {
      const parent = this.deps.itemCategories.findById(input.parentId)
      if (!parent) throw new ValidationError('That parent category no longer exists.')
      // Two levels, exactly. A sub-category cannot have children of its own —
      // deeper trees always end as one shop's private taxonomy nobody can read.
      if (parent.parentId !== null) {
        throw new ValidationError(
          `"${parent.name}" is already a sub-category. The tree is two levels: ` +
            `category, then sub-category, and no deeper.`,
        )
      }
    }

    const siblings = this.deps.itemCategories
      .list(input.branchId, true)
      .filter((category) => category.parentId === input.parentId)
    if (siblings.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
      throw new ValidationError(`There is already a category called "${name}" here.`)
    }

    const created = this.deps.itemCategories.create({
      branchId: input.branchId,
      parentId: input.parentId,
      name,
    })
    this.audit(actor, 'CATEGORY_CHANGED', 'item_categories', created.id, created.branchId, {
      created: name,
      parentId: input.parentId,
    })
    return created
  }

  renameCategory(actor: PublicUser, id: string, name: string): ItemCategory {
    const trimmed = name.trim()
    if (trimmed.length === 0) throw new ValidationError('A category needs a name.')
    const existing = this.deps.itemCategories.findById(id)
    if (!existing) throw new ValidationError('That category no longer exists.')

    const renamed = this.deps.itemCategories.rename(id, trimmed)
    this.audit(actor, 'CATEGORY_CHANGED', 'item_categories', id, renamed.branchId, {
      renamed: { from: existing.name, to: trimmed },
    })
    return renamed
  }

  /**
   * Deactivating a top-level category takes its sub-categories with it — a
   * child under a switched-off parent is unreachable in every dropdown anyway,
   * and leaving it "active" would only make the tree editor lie.
   */
  setCategoryActive(actor: PublicUser, id: string, isActive: boolean): ItemCategory {
    const existing = this.deps.itemCategories.findById(id)
    if (!existing) throw new ValidationError('That category no longer exists.')

    const updated = this.deps.itemCategories.setActive(id, isActive)
    const cascaded: string[] = []
    if (!isActive && existing.parentId === null) {
      for (const child of this.deps.itemCategories
        .list(existing.branchId, false)
        .filter((category) => category.parentId === id)) {
        this.deps.itemCategories.setActive(child.id, false)
        cascaded.push(child.name)
      }
    }
    this.audit(actor, 'CATEGORY_CHANGED', 'item_categories', id, updated.branchId, {
      isActive,
      alsoDeactivated: cascaded,
    })
    return updated
  }

  // ── locations ─────────────────────────────────────────────────────────────

  listLocations(branchId: string, includeInactive = false): StockLocation[] {
    return this.deps.locations.list(branchId, includeInactive)
  }

  createLocation(actor: PublicUser, branchId: string, name: string): StockLocation {
    const trimmed = name.trim()
    if (trimmed.length === 0) throw new ValidationError('A location needs a name.')
    const clash = this.deps.locations
      .list(branchId, true)
      .find((location) => location.name.toLowerCase() === trimmed.toLowerCase())
    if (clash) {
      throw new ValidationError(
        `There is already a location called "${clash.name}"` +
          (clash.isActive ? '.' : ' — it is deactivated; reactivate it instead.'),
      )
    }
    const created = this.deps.locations.create({ branchId, name: trimmed })
    this.audit(actor, 'LOCATION_CHANGED', 'locations', created.id, created.branchId, { created: trimmed })
    return created
  }

  renameLocation(actor: PublicUser, id: string, name: string): StockLocation {
    const trimmed = name.trim()
    if (trimmed.length === 0) throw new ValidationError('A location needs a name.')
    const existing = this.deps.locations.findById(id)
    if (!existing) throw new ValidationError('That location no longer exists.')
    const renamed = this.deps.locations.rename(id, trimmed)
    this.audit(actor, 'LOCATION_CHANGED', 'locations', id, renamed.branchId, {
      renamed: { from: existing.name, to: trimmed },
    })
    return renamed
  }

  setLocationActive(actor: PublicUser, id: string, isActive: boolean): StockLocation {
    const existing = this.deps.locations.findById(id)
    if (!existing) throw new ValidationError('That location no longer exists.')
    const updated = this.deps.locations.setActive(id, isActive)
    this.audit(actor, 'LOCATION_CHANGED', 'locations', id, updated.branchId, { isActive })
    return updated
  }

  // ── shared checks ─────────────────────────────────────────────────────────

  private requireItem(id: string): Item {
    const item = this.deps.items.findById(id)
    if (!item) throw new ValidationError('No such item.')
    return item
  }

  private requireCategory(categoryId: string | null): void {
    if (categoryId === null) return
    if (!this.deps.itemCategories.findById(categoryId)) {
      throw new ValidationError('That category no longer exists. Pick another.')
    }
  }

  private requireSupplier(supplierId: string | null): void {
    if (supplierId === null) return
    if (!this.deps.parties.findById(supplierId)) {
      throw new ValidationError('That supplier no longer exists. Pick another.')
    }
  }

  private audit(
    actor: PublicUser,
    action: 'ITEM_CREATED' | 'ITEM_UPDATED' | 'ITEM_DEACTIVATED' | 'CATEGORY_CHANGED' | 'LOCATION_CHANGED',
    entity: string,
    entityId: string,
    branchId: string,
    detail: Record<string, unknown>,
  ): void {
    this.deps.audit.append({
      branchId,
      userId: actor.id,
      action,
      entity,
      entityId,
      detail: JSON.stringify(detail),
    })
  }
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
