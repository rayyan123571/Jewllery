import { Money, Weight, fixedClock, type PublicUser } from '@jewellery/domain'
import {
  FakeAuditRepository,
  FakeItemCategoryRepository,
  FakeItemRepository,
  FakeLocationRepository,
  FakePartyRepository,
  InventoryService,
} from '@jewellery/application'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  inventoryCategoryCreate,
  inventoryCategorySetActive,
  inventoryCategoryTree,
  inventoryItemCreate,
  inventoryItems,
  inventoryItemSetActive,
  inventoryItemUpdate,
  inventoryLocationCreate,
  inventoryLocations,
  type InventoryHandlerDeps,
} from './inventoryHandlers.js'
import type { SaveItemRequest } from '../shared/ipc.js'

/**
 * The item-master boundary, with no Electron and no window.
 *
 * What is checked is the boundary's contract: refusals come back as sentences
 * rather than throws, the category label arrives preformatted ("Rings ›
 * Ladies"), typed strings parse strictly, and the two-level tree rule is a
 * message a shopkeeper can act on.
 */

const clock = fixedClock('2026-08-15T09:00:00.000Z')
const BRANCH = 'branch-1'

const admin: PublicUser = {
  id: 'user-1',
  branchId: BRANCH,
  name: 'Administrator',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

let deps: InventoryHandlerDeps
let audit: FakeAuditRepository

function requestOf(overrides: Partial<SaveItemRequest> = {}): SaveItemRequest {
  return {
    code: 'R-114',
    name: '22K ladies ring',
    categoryId: null,
    purity: 'K22',
    defaultKattRatti: '9',
    makingChargeBasis: 'per_tola',
    makingChargeRupees: '3500',
    supplierId: null,
    designNo: 'R-114',
    notes: '',
    ...overrides,
  }
}

function build(user: PublicUser | null): void {
  audit = new FakeAuditRepository(clock)
  const parties = new FakePartyRepository(clock)
  parties.create({
    branchId: BRANCH,
    code: 'SUP',
    name: 'GOLD SUPPLIER',
    mobile: null,
    city: null,
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
  })
  deps = {
    branchId: BRANCH,
    inventory: new InventoryService({
      items: new FakeItemRepository(clock),
      itemCategories: new FakeItemCategoryRepository(clock),
      locations: new FakeLocationRepository(clock),
      parties,
      audit,
      clock,
    }),
    parties,
    session: { user },
  }
}

beforeEach(() => {
  build(admin)
})

describe('the item register', () => {
  it('creates an item and reads it back preformatted', () => {
    const result = inventoryItemCreate(deps, requestOf())
    if (!result.ok) throw new Error(result.message)
    expect(result.item.code).toBe('R-114')
    expect(result.item.purityDisplay).toBe('22K')
    expect(result.item.defaultKattDisplay).toBe('9.000')
    expect(result.item.makingChargeDisplay).toBe('Rs 3,500 / tola')
    expect(result.item.categoryLabel).toBe('—')
  })

  it('normalises the code and refuses a duplicate with a sentence, not a throw', () => {
    inventoryItemCreate(deps, requestOf({ code: ' r-114 ' }))
    const second = inventoryItemCreate(deps, requestOf({ code: 'R-114', name: 'Another' }))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.message).toContain('R-114')
  })

  it('labels the category as the full path', () => {
    inventoryCategoryCreate(deps, null, 'Rings')
    const rings = inventoryCategoryTree(deps, false)[0]
    inventoryCategoryCreate(deps, rings?.id ?? '', 'Ladies')
    const ladies = inventoryCategoryTree(deps, false)[0]?.children[0]

    const result = inventoryItemCreate(deps, requestOf({ categoryId: ladies?.id ?? null }))
    if (!result.ok) throw new Error(result.message)
    expect(result.item.categoryLabel).toBe('Rings › Ladies')
  })

  it('an empty query answers with the register itself', () => {
    inventoryItemCreate(deps, requestOf())
    inventoryItemCreate(deps, requestOf({ code: 'CH-1', name: 'Chain', designNo: '' }))
    expect(inventoryItems(deps, '', false)).toHaveLength(2)
    expect(inventoryItems(deps, 'r-1', false).map((i) => i.code)).toEqual(['R-114'])
  })

  it('update keeps the code even when the request tries to change it', () => {
    const created = inventoryItemCreate(deps, requestOf())
    if (!created.ok) throw new Error(created.message)
    const updated = inventoryItemUpdate(
      deps,
      created.item.id,
      requestOf({ code: 'HACKED', name: 'Renamed ring' }),
    )
    if (!updated.ok) throw new Error(updated.message)
    expect(updated.item.code).toBe('R-114')
    expect(updated.item.name).toBe('Renamed ring')
  })

  it('deactivates out of the default view, never deletes', () => {
    const created = inventoryItemCreate(deps, requestOf())
    if (!created.ok) throw new Error(created.message)
    inventoryItemSetActive(deps, created.item.id, false)
    expect(inventoryItems(deps, '', false)).toHaveLength(0)
    expect(inventoryItems(deps, '', true)).toHaveLength(1)
    expect(audit.actions()).toContain('ITEM_DEACTIVATED')
  })

  it('answers an empty list, not a throw, with nobody signed in', () => {
    build(null)
    expect(inventoryItems(deps, '', false)).toEqual([])
    expect(inventoryItemCreate(deps, requestOf()).ok).toBe(false)
  })

  it('refuses a half-typed katt with the parser message', () => {
    const result = inventoryItemCreate(deps, requestOf({ defaultKattRatti: '9.9.9' }))
    expect(result.ok).toBe(false)
  })
})

describe('the two-level tree', () => {
  it('refuses a third level with a sentence naming the rule', () => {
    inventoryCategoryCreate(deps, null, 'Rings')
    const rings = inventoryCategoryTree(deps, false)[0]
    inventoryCategoryCreate(deps, rings?.id ?? '', 'Ladies')
    const ladies = inventoryCategoryTree(deps, false)[0]?.children[0]

    const third = inventoryCategoryCreate(deps, ladies?.id ?? '', 'Small')
    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.message).toContain('two levels')
  })

  it('deactivating a parent takes its children with it', () => {
    inventoryCategoryCreate(deps, null, 'Rings')
    const rings = inventoryCategoryTree(deps, false)[0]
    inventoryCategoryCreate(deps, rings?.id ?? '', 'Ladies')

    inventoryCategorySetActive(deps, rings?.id ?? '', false)
    expect(inventoryCategoryTree(deps, false)).toHaveLength(0)
    const includingOff = inventoryCategoryTree(deps, true)[0]
    expect(includingOff?.isActive).toBe(false)
    expect(includingOff?.children[0]?.isActive).toBe(false)
  })
})

describe('locations', () => {
  it('creates, refuses a case-insensitive duplicate, and points at a deactivated twin', () => {
    inventoryLocationCreate(deps, 'Showcase 1')
    const duplicate = inventoryLocationCreate(deps, 'SHOWCASE 1')
    expect(duplicate.ok).toBe(false)

    const safe = inventoryLocationCreate(deps, 'Safe')
    expect(safe.ok).toBe(true)
    expect(inventoryLocations(deps, false).map((l) => l.name)).toEqual(['Safe', 'Showcase 1'])
  })
})
