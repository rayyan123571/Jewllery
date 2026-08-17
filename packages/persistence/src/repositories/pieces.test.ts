import {
  Katt,
  Money,
  Weight,
  computePieceFigures,
  fixedClock,
  toIsoTimestamp,
} from '@jewellery/domain'
import type { NewPiece, Repositories } from '@jewellery/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type SqliteDatabase } from '../Database.js'
import { createRepositories } from './index.js'

/**
 * Pieces against a real database.
 *
 * The two things only SQLite can prove: the batch is genuinely ATOMIC — a
 * duplicate tag anywhere in it leaves no piece, no event and no ledger row —
 * and the invariant holds by construction: the khalis of IN_STOCK pieces
 * equals the ledger's FINISHED balance, because the two are written by the
 * same transaction and nothing else writes either.
 */

const clock = fixedClock('2026-08-15T09:00:00.000Z')
const BRANCH = 'branch-1'
const OPENED = toIsoTimestamp(new Date('2026-08-01T00:00:00.000Z'))

let db: SqliteDatabase
let repos: Repositories
let userId = ''
let itemId = ''
let safeId = ''

function pieceOf(overrides: Partial<NewPiece> = {}): NewPiece {
  const gross = Weight.parse('5.425')
  const stone = Weight.parse('1.000')
  const katt = Katt.parse('19.59')
  const figures = computePieceFigures({ gross, stone, katt })
  return {
    branchId: BRANCH,
    tagNumber: null,
    itemId,
    gross,
    stone,
    stoneCount: 3,
    net: figures.net,
    katt,
    khalis: figures.khalis,
    locationId: safeId,
    sourceType: 'OPENING',
    sourceId: null,
    createdByUserId: userId,
    ...overrides,
  }
}

function ledgerFinished(): { grossMg: number; khalisMg: number } {
  const finished = repos.stockLedger.summary(BRANCH).find((b) => b.bucket === 'FINISHED')
  return {
    grossMg: finished?.gross.milligrams ?? 0,
    khalisMg: finished?.khalis.milligrams ?? 0,
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
  itemId = repos.items.create({
    branchId: BRANCH,
    code: 'R-114',
    name: '22K ladies ring',
    categoryId: null,
    purity: 'K22',
    defaultKatt: Katt.parse('9'),
    makingChargeBasis: 'per_tola',
    defaultMakingCharge: Money.ZERO,
    supplierId: null,
    designNo: null,
    notes: null,
    createdByUserId: userId,
  }).id
  safeId = repos.locations.create({ branchId: BRANCH, name: 'Safe' }).id
})

afterEach(() => db.close())

describe('creating a batch', () => {
  it('writes piece, CREATED event and FINISHED ledger row together', () => {
    const [piece] = repos.pieces.createBatch([pieceOf()], {
      kind: 'OPENING',
      at: OPENED,
      note: 'Opening stock',
    })

    expect(piece?.status).toBe('IN_STOCK')
    expect(piece?.net.format()).toBe('4.425')
    expect(piece?.khalis.format()).toBe('3.522')

    const events = repos.pieces.events(piece?.id ?? '')
    expect(events.map((e) => e.kind)).toEqual(['CREATED'])
    expect(events[0]?.at).toBe(OPENED)

    const rows = repos.stockLedger.forRef('piece', piece?.id ?? '')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('OPENING')
    expect(rows[0]?.bucket).toBe('FINISHED')
    expect(rows[0]?.khalis.milligrams).toBe(piece?.khalis.milligrams)
    expect(rows[0]?.itemName).toBe('22K ladies ring · tag 1')
  })

  it('allocates tags from the book; a typed tag is kept', () => {
    const created = repos.pieces.createBatch(
      [pieceOf(), pieceOf({ tagNumber: 500 }), pieceOf()],
      { kind: 'OPENING', at: OPENED, note: null },
    )
    expect(created.map((piece) => piece.tagNumber)).toEqual([1, 500, 2])
    expect(repos.pieces.peekNextTag()).toBe(3)
  })

  it('is ATOMIC: a duplicate tag anywhere leaves no piece, no event, no ledger row', () => {
    repos.pieces.createBatch([pieceOf({ tagNumber: 7 })], {
      kind: 'OPENING',
      at: OPENED,
      note: null,
    })
    const before = ledgerFinished()

    expect(() =>
      repos.pieces.createBatch([pieceOf(), pieceOf({ tagNumber: 7 })], {
        kind: 'OPENING',
        at: OPENED,
        note: null,
      }),
    ).toThrow()

    // The batch died as a unit: the good first row did not survive alone.
    expect(repos.pieces.list({ branchId: BRANCH })).toHaveLength(1)
    expect(ledgerFinished()).toEqual(before)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM piece_events').get() as { n: number },
    ).toEqual({ n: 1 })
  })

  it('the database itself refuses a net that is not gross minus stone', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO pieces
             (id, branch_id, tag_number, item_id, gross_mg, stone_mg, stone_count,
              net_mg, katt_milli_ratti, khalis_mg, location_id, status,
              source_type, source_id, status_changed_at, created_by_user_id,
              created_at, updated_at)
           VALUES ('x', ?, 999, ?, 5425, 1000, 1, 5425, 0, 4425, NULL, 'IN_STOCK',
                   'OPENING', NULL, '2026', ?, '2026', '2026')`,
        )
        .run(BRANCH, itemId, userId),
    ).toThrow(/CHECK/)
  })
})

describe('the invariant, held by construction', () => {
  it('khalis of IN_STOCK pieces equals the FINISHED ledger balance', () => {
    repos.pieces.createBatch([pieceOf(), pieceOf(), pieceOf({ stone: Weight.ZERO, stoneCount: 0, net: Weight.parse('5.425'), khalis: computePieceFigures({ gross: Weight.parse('5.425'), stone: Weight.ZERO, katt: Katt.parse('19.59') }).khalis })], {
      kind: 'OPENING',
      at: OPENED,
      note: null,
    })

    const pieces = repos.pieces.inStockTotals(BRANCH)
    const ledger = ledgerFinished()
    expect(pieces.khalisMg).toBe(ledger.khalisMg)
    expect(pieces.grossMg).toBe(ledger.grossMg)
    expect(pieces.khalisMg).toBeGreaterThan(0)
  })

  it('SCRAP and BULLION stay untouched — FINISHED is pieces only', () => {
    repos.pieces.createBatch([pieceOf()], { kind: 'OPENING', at: OPENED, note: null })
    const buckets = repos.stockLedger.summary(BRANCH).map((b) => b.bucket)
    expect(buckets).toEqual(['FINISHED'])
  })
})

describe('summary groups and filters', () => {
  it('groups by category, purity, location and supplier with counts and sums', () => {
    repos.pieces.createBatch([pieceOf(), pieceOf()], {
      kind: 'OPENING',
      at: OPENED,
      note: null,
    })
    const groups = repos.pieces.summaryGroups(BRANCH)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      purity: 'K22',
      locationId: safeId,
      count: 2,
      grossMg: 10_850,
    })
  })

  it('drills with null meaning "none recorded", not "any"', () => {
    repos.pieces.createBatch([pieceOf(), pieceOf({ locationId: null })], {
      kind: 'OPENING',
      at: OPENED,
      note: null,
    })
    expect(repos.pieces.list({ branchId: BRANCH, locationId: null })).toHaveLength(1)
    expect(repos.pieces.list({ branchId: BRANCH, locationId: safeId })).toHaveLength(1)
    expect(repos.pieces.list({ branchId: BRANCH })).toHaveLength(2)
  })
})

describe('moving a piece', () => {
  it('re-shelves, records the MOVED event, and touches no ledger', () => {
    const [piece] = repos.pieces.createBatch([pieceOf()], {
      kind: 'OPENING',
      at: OPENED,
      note: null,
    })
    const counter = repos.locations.create({ branchId: BRANCH, name: 'Counter' })
    const before = ledgerFinished()

    const moved = repos.pieces.moveTo(piece?.id ?? '', counter.id, userId)
    expect(moved.locationId).toBe(counter.id)
    expect(ledgerFinished()).toEqual(before)

    const events = repos.pieces.events(piece?.id ?? '')
    expect(events.map((e) => e.kind)).toEqual(['CREATED', 'MOVED'])
    expect(events[1]?.fromLocationId).toBe(safeId)
    expect(events[1]?.toLocationId).toBe(counter.id)
  })
})
