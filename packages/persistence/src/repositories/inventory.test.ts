import { Katt, Money, fixedClock } from '@jewellery/domain'
import type { NewItem, Repositories } from '@jewellery/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type SqliteDatabase } from '../Database.js'
import { createRepositories } from './index.js'

/**
 * The item master against a real database.
 *
 * What matters at this layer is what only SQLite can prove: the case-
 * insensitive unique index on the code, the two partial indexes that stop the
 * category tree accepting two top-level "Rings" (NULLs are distinct in a plain
 * unique index — the exact hole the partial pair closes), and that an item
 * round-trips its integer columns with no float in the path.
 */

const clock = fixedClock('2026-08-15T09:00:00.000Z')
const BRANCH = 'branch-1'

let db: SqliteDatabase
let repos: Repositories
let userId = ''

function itemOf(overrides: Partial<NewItem> = {}): NewItem {
  return {
    branchId: BRANCH,
    code: 'R-114',
    name: '22K ladies ring',
    categoryId: null,
    purity: 'K22',
    defaultKatt: Katt.parse('9'),
    makingChargeBasis: 'per_tola',
    defaultMakingCharge: Money.parse('3500'),
    supplierId: null,
    designNo: 'R-114',
    notes: null,
    createdByUserId: userId,
    ...overrides,
  }
}

beforeEach(() => {
  db = openInMemoryDatabase()
  repos = createRepositories(db, clock)
  repos.branches.create({
    id: BRANCH,
    name: 'Main Branch',
    address: null,
    isDefault: true,
    isActive: true,
  })
  userId = repos.users.create({
    branchId: BRANCH,
    name: 'Admin',
    username: 'admin',
    passwordHash: 'scrypt$16$1$1$c2FsdA==$aGFzaA==',
    role: 'ADMIN',
    mustChangePassword: false,
  }).id
})

afterEach(() => db.close())

describe('the item master', () => {
  it('round-trips every field, integers all the way down', () => {
    const created = repos.items.create(itemOf())
    const read = repos.items.findById(created.id)
    expect(read?.code).toBe('R-114')
    expect(read?.purity).toBe('K22')
    expect(read?.defaultKatt.format()).toBe('9.000')
    expect(read?.defaultMakingCharge.paisa).toBe(350_000)
    expect(read?.makingChargeBasis).toBe('per_tola')

    const types = db
      .prepare(
        `SELECT typeof(default_katt_milli_ratti) AS k,
                typeof(default_making_charge_paisa) AS m
           FROM items LIMIT 1`,
      )
      .get() as Record<string, string>
    expect(Object.values(types)).toEqual(['integer', 'integer'])
  })

  it('refuses a second code differing only in case — the index, not the app', () => {
    repos.items.create(itemOf({ code: 'R-114' }))
    expect(() => repos.items.create(itemOf({ code: 'r-114' }))).toThrow()
  })

  it('finds by code case-insensitively, matching the index it is unique under', () => {
    const created = repos.items.create(itemOf({ code: 'R-114' }))
    expect(repos.items.findByCode(BRANCH, 'r-114')?.id).toBe(created.id)
  })

  it('searches code, name and design, prefix matches first', () => {
    repos.items.create(itemOf({ code: 'CH-1', name: 'Singapori chain', designNo: 'SC-9' }))
    repos.items.create(itemOf({ code: 'R-114', name: 'Ring, chandi set', designNo: null }))
    const found = repos.items.search(BRANCH, 'CH', false, 10)
    expect(found.map((i) => i.code)).toEqual(['CH-1', 'R-114'])
  })

  it('has no update path for the code — a code prints on tags', () => {
    const created = repos.items.create(itemOf())
    repos.items.update(created.id, {
      name: 'Renamed',
      categoryId: null,
      purity: 'K21',
      defaultKatt: Katt.parse('11'),
      makingChargeBasis: 'fixed',
      defaultMakingCharge: Money.parse('500'),
      supplierId: null,
      designNo: null,
      notes: null,
    })
    const read = repos.items.findById(created.id)
    expect(read?.code).toBe('R-114')
    expect(read?.name).toBe('Renamed')
  })

  it('deactivates rather than deletes, and the list can still show it', () => {
    const created = repos.items.create(itemOf())
    repos.items.setActive(created.id, false)
    expect(repos.items.list(BRANCH, false)).toHaveLength(0)
    expect(repos.items.list(BRANCH, true)).toHaveLength(1)
  })
})

describe('the category tree', () => {
  it('refuses two top-level categories differing only in case', () => {
    repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
    // NULL parent_id would slip through a plain unique index — NULLs are
    // distinct in SQLite — which is exactly what the partial index closes.
    expect(() =>
      repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'RINGS' }),
    ).toThrow()
  })

  it('allows the same sub-category name under two different parents', () => {
    const rings = repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
    const tops = repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'Tops' })
    repos.itemCategories.create({ branchId: BRANCH, parentId: rings.id, name: 'Ladies' })
    repos.itemCategories.create({ branchId: BRANCH, parentId: tops.id, name: 'Ladies' })
    expect(repos.itemCategories.list(BRANCH, false)).toHaveLength(4)
  })

  it('refuses the same sub-category name twice under one parent', () => {
    const rings = repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
    repos.itemCategories.create({ branchId: BRANCH, parentId: rings.id, name: 'Ladies' })
    expect(() =>
      repos.itemCategories.create({ branchId: BRANCH, parentId: rings.id, name: 'ladies' }),
    ).toThrow()
  })

  it('deactivates rather than deletes — an old item keeps its label readable', () => {
    const rings = repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
    repos.items.create(itemOf({ categoryId: rings.id }))
    repos.itemCategories.setActive(rings.id, false)
    expect(repos.itemCategories.findById(rings.id)?.isActive).toBe(false)
    // The item still resolves its category by id.
    const item = repos.items.list(BRANCH, false)[0]
    expect(item?.categoryId).toBe(rings.id)
  })
})

describe('locations', () => {
  it('are unique per branch, case-insensitively', () => {
    repos.locations.create({ branchId: BRANCH, name: 'Showcase 1' })
    expect(() => repos.locations.create({ branchId: BRANCH, name: 'SHOWCASE 1' })).toThrow()
  })

  it('rename and deactivate, never delete', () => {
    const safe = repos.locations.create({ branchId: BRANCH, name: 'Safe' })
    repos.locations.rename(safe.id, 'Main Safe')
    repos.locations.setActive(safe.id, false)
    expect(repos.locations.list(BRANCH, true).map((l) => l.name)).toEqual(['Main Safe'])
    expect(repos.locations.list(BRANCH, false)).toHaveLength(0)
  })
})

describe('nothing here touches stock', () => {
  it('creating items, categories and locations writes no stock_ledger row', () => {
    const rings = repos.itemCategories.create({ branchId: BRANCH, parentId: null, name: 'Rings' })
    repos.locations.create({ branchId: BRANCH, name: 'Safe' })
    repos.items.create(itemOf({ categoryId: rings.id }))
    expect(repos.stockLedger.list({ branchId: BRANCH })).toHaveLength(0)
  })
})
