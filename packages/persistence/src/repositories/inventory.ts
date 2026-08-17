import { randomUUID } from 'node:crypto'
import {
  Katt,
  Money,
  toIsoTimestamp,
  type Clock,
  type Item,
  type ItemCategory,
  type MakingChargeBasis,
  type Purity,
  type StockLocation,
} from '@jewellery/domain'
import type {
  ItemCategoryRepository,
  ItemRepository,
  ItemUpdate,
  LocationRepository,
  NewItem,
  NewItemCategory,
  NewLocation,
} from '@jewellery/application'
import type { DatabaseProvider } from '../Database.js'

/**
 * The item master, categories and locations against SQLite.
 *
 * Definitions, not stock: nothing in this file reads or writes a weight that
 * belongs to the shop's holdings. Note what is absent, deliberately — no
 * delete methods anywhere (a category on an old piece must stay readable
 * forever), and no way to change an item's code (it prints on tags).
 */

interface ItemRow {
  id: string
  branch_id: string
  code: string
  name: string
  category_id: string | null
  purity: string
  default_katt_milli_ratti: number
  making_charge_basis: string
  default_making_charge_paisa: number
  supplier_id: string | null
  design_no: string | null
  notes: string | null
  is_active: number
  created_by_user_id: string
  created_at: string
  updated_at: string
}

interface CategoryRow {
  id: string
  branch_id: string
  parent_id: string | null
  name: string
  is_active: number
  created_at: string
  updated_at: string
}

interface LocationRow {
  id: string
  branch_id: string
  name: string
  is_active: number
  created_at: string
  updated_at: string
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    categoryId: row.category_id,
    purity: row.purity as Purity,
    defaultKatt: Katt.fromMilliRatti(row.default_katt_milli_ratti),
    makingChargeBasis: row.making_charge_basis as MakingChargeBasis,
    defaultMakingCharge: Money.fromPaisa(row.default_making_charge_paisa),
    supplierId: row.supplier_id,
    designNo: row.design_no,
    notes: row.notes,
    isActive: row.is_active === 1,
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

function toCategory(row: CategoryRow): ItemCategory {
  return {
    id: row.id,
    branchId: row.branch_id,
    parentId: row.parent_id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

function toLocation(row: LocationRow): StockLocation {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

export class SqliteItemRepository implements ItemRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  findById(id: string): Item | null {
    const row = this.conn.get().prepare('SELECT * FROM items WHERE id = ?').get(id) as
      | ItemRow
      | undefined
    return row ? toItem(row) : null
  }

  findByCode(branchId: string, code: string): Item | null {
    // COLLATE NOCASE matches the unique index, so lookup and uniqueness agree.
    const row = this.conn
      .get()
      .prepare('SELECT * FROM items WHERE branch_id = ? AND code = ? COLLATE NOCASE')
      .get(branchId, code) as ItemRow | undefined
    return row ? toItem(row) : null
  }

  /** Prefix matches first, exactly the ranking the party selector earned. */
  search(branchId: string, query: string, includeInactive: boolean, limit: number): Item[] {
    const like = `%${query}%`
    const prefix = `${query}%`
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM items
          WHERE branch_id = ?${includeInactive ? '' : ' AND is_active = 1'}
            AND (code LIKE ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE
                 OR design_no LIKE ? COLLATE NOCASE)
          ORDER BY
            CASE WHEN code LIKE ? COLLATE NOCASE THEN 0
                 WHEN name LIKE ? COLLATE NOCASE THEN 1
                 ELSE 2 END,
            name COLLATE NOCASE
          LIMIT ?`,
      )
      .all(branchId, like, like, like, prefix, prefix, limit) as ItemRow[]
    return rows.map(toItem)
  }

  list(branchId: string, includeInactive: boolean): Item[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM items
          WHERE branch_id = ?${includeInactive ? '' : ' AND is_active = 1'}
          ORDER BY name COLLATE NOCASE`,
      )
      .all(branchId) as ItemRow[]
    return rows.map(toItem)
  }

  create(item: NewItem): Item {
    const id = randomUUID()
    const stamp = toIsoTimestamp(this.clock.now())
    this.conn
      .get()
      .prepare(
        `INSERT INTO items
           (id, branch_id, code, name, category_id, purity,
            default_katt_milli_ratti, making_charge_basis, default_making_charge_paisa,
            supplier_id, design_no, notes, is_active, created_by_user_id,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      )
      .run(
        id,
        item.branchId,
        item.code,
        item.name,
        item.categoryId,
        item.purity,
        item.defaultKatt.milliRatti,
        item.makingChargeBasis,
        item.defaultMakingCharge.paisa,
        item.supplierId,
        item.designNo,
        item.notes,
        item.createdByUserId,
        stamp,
        stamp,
      )
    return this.require(id)
  }

  update(id: string, changes: ItemUpdate): Item {
    // No `code` in this statement, on purpose: the code prints on tags, and
    // changing it would orphan every tag already tied on.
    this.conn
      .get()
      .prepare(
        `UPDATE items
            SET name = ?, category_id = ?, purity = ?, default_katt_milli_ratti = ?,
                making_charge_basis = ?, default_making_charge_paisa = ?,
                supplier_id = ?, design_no = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        changes.name,
        changes.categoryId,
        changes.purity,
        changes.defaultKatt.milliRatti,
        changes.makingChargeBasis,
        changes.defaultMakingCharge.paisa,
        changes.supplierId,
        changes.designNo,
        changes.notes,
        toIsoTimestamp(this.clock.now()),
        id,
      )
    return this.require(id)
  }

  setActive(id: string, isActive: boolean): Item {
    this.conn
      .get()
      .prepare('UPDATE items SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(isActive ? 1 : 0, toIsoTimestamp(this.clock.now()), id)
    return this.require(id)
  }

  private require(id: string): Item {
    const item = this.findById(id)
    if (!item) throw new Error(`No such item: ${id}`)
    return item
  }
}

export class SqliteItemCategoryRepository implements ItemCategoryRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  findById(id: string): ItemCategory | null {
    const row = this.conn.get().prepare('SELECT * FROM item_categories WHERE id = ?').get(id) as
      | CategoryRow
      | undefined
    return row ? toCategory(row) : null
  }

  list(branchId: string, includeInactive: boolean): ItemCategory[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM item_categories
          WHERE branch_id = ?${includeInactive ? '' : ' AND is_active = 1'}
          ORDER BY parent_id IS NOT NULL, name COLLATE NOCASE`,
      )
      .all(branchId) as CategoryRow[]
    return rows.map(toCategory)
  }

  create(category: NewItemCategory): ItemCategory {
    const id = randomUUID()
    const stamp = toIsoTimestamp(this.clock.now())
    this.conn
      .get()
      .prepare(
        `INSERT INTO item_categories
           (id, branch_id, parent_id, name, is_active, created_at, updated_at)
         VALUES (?,?,?,?,1,?,?)`,
      )
      .run(id, category.branchId, category.parentId, category.name, stamp, stamp)
    return this.require(id)
  }

  rename(id: string, name: string): ItemCategory {
    this.conn
      .get()
      .prepare('UPDATE item_categories SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, toIsoTimestamp(this.clock.now()), id)
    return this.require(id)
  }

  setActive(id: string, isActive: boolean): ItemCategory {
    this.conn
      .get()
      .prepare('UPDATE item_categories SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(isActive ? 1 : 0, toIsoTimestamp(this.clock.now()), id)
    return this.require(id)
  }

  private require(id: string): ItemCategory {
    const category = this.findById(id)
    if (!category) throw new Error(`No such category: ${id}`)
    return category
  }
}

export class SqliteLocationRepository implements LocationRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  findById(id: string): StockLocation | null {
    const row = this.conn.get().prepare('SELECT * FROM locations WHERE id = ?').get(id) as
      | LocationRow
      | undefined
    return row ? toLocation(row) : null
  }

  list(branchId: string, includeInactive: boolean): StockLocation[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM locations
          WHERE branch_id = ?${includeInactive ? '' : ' AND is_active = 1'}
          ORDER BY name COLLATE NOCASE`,
      )
      .all(branchId) as LocationRow[]
    return rows.map(toLocation)
  }

  create(location: NewLocation): StockLocation {
    const id = randomUUID()
    const stamp = toIsoTimestamp(this.clock.now())
    this.conn
      .get()
      .prepare(
        `INSERT INTO locations (id, branch_id, name, is_active, created_at, updated_at)
         VALUES (?,?,?,1,?,?)`,
      )
      .run(id, location.branchId, location.name, stamp, stamp)
    return this.require(id)
  }

  rename(id: string, name: string): StockLocation {
    this.conn
      .get()
      .prepare('UPDATE locations SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, toIsoTimestamp(this.clock.now()), id)
    return this.require(id)
  }

  setActive(id: string, isActive: boolean): StockLocation {
    this.conn
      .get()
      .prepare('UPDATE locations SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(isActive ? 1 : 0, toIsoTimestamp(this.clock.now()), id)
    return this.require(id)
  }

  private require(id: string): StockLocation {
    const location = this.findById(id)
    if (!location) throw new Error(`No such location: ${id}`)
    return location
  }
}
