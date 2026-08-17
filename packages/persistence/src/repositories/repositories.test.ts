import { Money, Weight, toIsoDate } from '@jewellery/domain'
import type { Repositories } from '@jewellery/application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type SqliteDatabase } from '../Database.js'
import { createRepositories } from './index.js'

let db: SqliteDatabase
let repos: Repositories
const BRANCH = 'branch-1'

function seedBranchAndUser(): void {
  repos.branches.create({
    id: BRANCH,
    name: 'Main Branch',
    address: null,
    isDefault: true,
    isActive: true,
  })
  repos.users.create({
    branchId: BRANCH,
    name: 'Admin',
    username: 'admin',
    passwordHash: 'scrypt$16$1$1$c2FsdA==$aGFzaA==',
    role: 'ADMIN',
    mustChangePassword: false,
  })
}

function adminId(): string {
  return repos.users.findByUsername('admin')?.id ?? ''
}

beforeEach(() => {
  db = openInMemoryDatabase()
  repos = createRepositories(db)
})

afterEach(() => {
  db.close()
})

describe('shop profile', () => {
  it('is absent on a fresh install', () => {
    expect(repos.shop.get()).toBeNull()
  })

  it('saves and reads back', () => {
    const saved = repos.shop.save({
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: null,
      ownerName: 'Haji Abdul Rehman',
      secondOwnerName: null,
      phone1: '03001234567',
      phone2: null,
      phone3: null,
      address: 'Shop 12, Sona Bazaar, Lahore',
      logoPath: null,
    })
    expect(saved.name).toBe('AL-HARAM GOLD JEWELLERS')
    expect(repos.shop.get()?.ownerName).toBe('Haji Abdul Rehman')
  })

  it('updates in place rather than creating a second shop', () => {
    const base = {
      name: 'First',
      tagline: null,
      ownerName: 'Owner',
      secondOwnerName: null,
      phone1: '1',
      phone2: null,
      phone3: null,
      address: 'A',
      logoPath: null,
    }
    repos.shop.save(base)
    repos.shop.save({ ...base, name: 'Second' })
    expect(repos.shop.get()?.name).toBe('Second')
    const count = db.prepare('SELECT COUNT(*) AS n FROM shop_profile').get() as { n: number }
    expect(count.n).toBe(1)
  })
})

describe('branches', () => {
  it('finds the default branch', () => {
    seedBranchAndUser()
    expect(repos.branches.findDefault()?.name).toBe('Main Branch')
  })

  it('maps 0/1 to real booleans', () => {
    seedBranchAndUser()
    const branch = repos.branches.findDefault()
    expect(branch?.isDefault).toBe(true)
    expect(branch?.isActive).toBe(true)
  })

  it('excludes inactive branches from the active list', () => {
    seedBranchAndUser()
    repos.branches.create({
      id: 'branch-2',
      name: 'Closed',
      address: null,
      isDefault: false,
      isActive: false,
    })
    expect(repos.branches.listActive().map((b) => b.id)).toEqual([BRANCH])
  })
})

describe('users', () => {
  beforeEach(seedBranchAndUser)

  it('looks up case-insensitively, matching the unique index', () => {
    expect(repos.users.findByUsername('ADMIN')?.username).toBe('admin')
  })

  it('counts active admins', () => {
    expect(repos.users.countActiveAdmins()).toBe(1)
    repos.users.setActive(adminId(), false)
    expect(repos.users.countActiveAdmins()).toBe(0)
  })

  it('records a login timestamp', () => {
    expect(repos.users.findById(adminId())?.lastLoginAt).toBeNull()
    repos.users.recordLogin(adminId())
    expect(repos.users.findById(adminId())?.lastLoginAt).not.toBeNull()
  })

  it('refuses a duplicate username differing only in case', () => {
    expect(() =>
      repos.users.create({
        branchId: BRANCH,
        name: 'Impostor',
        username: 'Admin',
        passwordHash: 'x',
        role: 'ADMIN',
        mustChangePassword: false,
      }),
    ).toThrow()
  })
})

describe('gold rates — the time-effective lookup', () => {
  beforeEach(() => {
    seedBranchAndUser()
    for (const [rupees, from] of [
      [8900, '2026-07-01'],
      [8950, '2026-08-01'],
      [9100, '2026-09-01'],
    ] as const) {
      repos.goldRates.record({
        branchId: BRANCH,
        purity: 'K22',
        ratePerTola: Money.fromRupees(rupees),
        effectiveFrom: toIsoDate(from),
        createdByUserId: adminId(),
        note: null,
      })
    }
  })

  it('returns the rate in force, not the newest row', () => {
    const rate = repos.goldRates.findEffective(BRANCH, 'K22', toIsoDate('2026-08-15'))
    expect(rate?.ratePerTola.format()).toBe('8,950.00')
  })

  it('does not apply a future-dated rate early', () => {
    const rate = repos.goldRates.findEffective(BRANCH, 'K22', toIsoDate('2026-08-31'))
    expect(rate?.ratePerTola.format()).toBe('8,950.00')
  })

  it('still returns last month rate for a back-dated transaction', () => {
    const rate = repos.goldRates.findEffective(BRANCH, 'K22', toIsoDate('2026-07-15'))
    expect(rate?.ratePerTola.format()).toBe('8,900.00')
  })

  it('returns null before any rate existed', () => {
    expect(repos.goldRates.findEffective(BRANCH, 'K22', toIsoDate('2026-06-30'))).toBeNull()
  })

  it('round-trips paisa exactly, with no float in the path', () => {
    repos.goldRates.record({
      branchId: BRANCH,
      purity: 'K21',
      ratePerTola: Money.parse('8555.55'),
      effectiveFrom: toIsoDate('2026-08-01'),
      createdByUserId: adminId(),
      note: null,
    })
    const rate = repos.goldRates.findEffective(BRANCH, 'K21', toIsoDate('2026-08-02'))
    expect(rate?.ratePerTola.paisa).toBe(855_555)
    expect(rate?.ratePerTola.format()).toBe('8,555.55')
  })

  it('stores the rate column as an integer, not a float', () => {
    const row = db
      .prepare("SELECT typeof(rate_per_tola) AS t FROM gold_rates LIMIT 1")
      .get() as { t: string }
    expect(row.t).toBe('integer')
  })

  it('prefers a same-day correction recorded later', () => {
    for (const rupees of [8500, 8550]) {
      repos.goldRates.record({
        branchId: BRANCH,
        purity: 'K18',
        ratePerTola: Money.fromRupees(rupees),
        effectiveFrom: toIsoDate('2026-08-02'),
        createdByUserId: adminId(),
        note: null,
      })
    }
    const rate = repos.goldRates.findEffective(BRANCH, 'K18', toIsoDate('2026-08-02'))
    expect(rate?.ratePerTola.format()).toBe('8,550.00')
  })

  it('reports the current rate per purity for the rate panel', () => {
    repos.goldRates.record({
      branchId: BRANCH,
      purity: 'K24',
      ratePerTola: Money.fromRupees(9400),
      effectiveFrom: toIsoDate('2026-08-01'),
      createdByUserId: adminId(),
      note: null,
    })
    const current = repos.goldRates.findAllEffective(BRANCH, toIsoDate('2026-08-15'))
    expect(current.K22?.ratePerTola.format()).toBe('8,950.00')
    expect(current.K24?.ratePerTola.format()).toBe('9,400.00')
    expect(current.K18).toBeUndefined()
  })

  it('keeps branches independent', () => {
    expect(repos.goldRates.findEffective('branch-2', 'K22', toIsoDate('2026-08-15'))).toBeNull()
  })

  it('returns history newest first', () => {
    const history = repos.goldRates.history(BRANCH, 'K22', 10)
    expect(history.map((r) => r.effectiveFrom)).toEqual([
      '2026-09-01',
      '2026-08-01',
      '2026-07-01',
    ])
  })

  it('has no update method — a rate is history, not a setting', () => {
    expect('update' in repos.goldRates).toBe(false)
  })
})

describe('audit log', () => {
  beforeEach(seedBranchAndUser)

  it('appends and reads back newest first', () => {
    repos.audit.append({
      branchId: BRANCH,
      userId: adminId(),
      action: 'LOGIN',
      entity: 'users',
      entityId: adminId(),
      detail: null,
    })
    repos.audit.append({
      branchId: BRANCH,
      userId: adminId(),
      action: 'GOLD_RATE_SET',
      entity: 'gold_rates',
      entityId: 'r1',
      detail: JSON.stringify({ x: 1 }),
    })
    expect(repos.audit.recent(10).map((e) => e.action)).toEqual(['GOLD_RATE_SET', 'LOGIN'])
  })

  it('allows a null user, for a failed login with no established user', () => {
    const entry = repos.audit.append({
      branchId: null,
      userId: null,
      action: 'LOGIN_FAILED',
      entity: 'users',
      entityId: null,
      detail: null,
    })
    expect(entry.userId).toBeNull()
  })

  it('filters by entity', () => {
    repos.audit.append({
      branchId: BRANCH,
      userId: adminId(),
      action: 'GOLD_RATE_SET',
      entity: 'gold_rates',
      entityId: 'r1',
      detail: null,
    })
    expect(repos.audit.forEntity('gold_rates', 'r1')).toHaveLength(1)
    expect(repos.audit.forEntity('gold_rates', 'r2')).toHaveLength(0)
  })
})

describe('settings', () => {
  it('returns null for an unset key rather than an empty string', () => {
    expect(repos.settings.get('nothing')).toBeNull()
  })

  it('upserts', () => {
    repos.settings.set('overReturnToleranceMg', '50')
    repos.settings.set('overReturnToleranceMg', '100')
    expect(repos.settings.get('overReturnToleranceMg')).toBe('100')
    expect(Object.keys(repos.settings.all())).toEqual(['overReturnToleranceMg'])
  })
})

/**
 * One directory, two doors.
 *
 * `parties` and `customers` are two views of ONE table now (migration 015), and
 * these are the assertions that say so. The failure they exist to prevent is
 * the one the shop actually hits: a jeweller typed in at the retail counter on
 * Monday, not found on the wholesale screen on Friday, typed in again — and now
 * one person has two rows, two codes and two balances that disagree.
 */
describe('customers and parties are one directory', () => {
  beforeEach(() => {
    seedBranchAndUser()
  })

  it('finds a name added at the retail counter on the wholesale screen', () => {
    repos.customers.create(
      {
        code: 'C-0001',
        name: 'CHAUDHARY JEWELLER',
        mobile: '03067380000',
        address: null,
        city: 'Lahore',
        cnic: null,
        isWalkIn: false,
        openingGold: Weight.ZERO,
        openingCash: Money.ZERO,
      },
      'user-1',
    )

    const found = repos.parties.search(BRANCH, 'CHAUD', 10)
    expect(found.map((p) => p.name)).toEqual(['CHAUDHARY JEWELLER'])
  })

  it('finds a party added on the wholesale screen at the retail counter', () => {
    repos.parties.create(
      {
        branchId: BRANCH,
        code: 'CHJ',
        name: 'CHAUDHARY JEWELLER',
        mobile: '03067380000',
        city: 'Lahore',
        openingGold: Weight.ZERO,
        openingCash: Money.ZERO,
        notes: null,
      },
      'user-1',
    )

    expect(repos.customers.search('CHAUD', 10).map((c) => c.name)).toEqual([
      'CHAUDHARY JEWELLER',
    ])
    // The same row, reachable by either door — so one balance, not two.
    expect(repos.customers.findByCode('CHJ')?.name).toBe('CHAUDHARY JEWELLER')
  })

  /**
   * The one name that does NOT cross.
   *
   * A walk-in is somebody with no account at all, so there is no ledger for a
   * wholesale balance to sit on. Offering one as a party would let a slip be
   * posted against an account that does not exist.
   */
  it('keeps a walk-in out of the party list, and only a walk-in', () => {
    repos.customers.create(
      {
        code: 'W-0001',
        name: 'WALK IN AHMED',
        mobile: null,
        address: null,
        city: null,
        cnic: null,
        isWalkIn: true,
        openingGold: Weight.ZERO,
        openingCash: Money.ZERO,
      },
      'user-1',
    )

    expect(repos.customers.search('WALK', 10)).toHaveLength(1)
    expect(repos.parties.search(BRANCH, 'WALK', 10)).toEqual([])
  })

  it('refuses one code to two people, whatever case it was typed in', () => {
    repos.parties.create(
      {
        branchId: BRANCH,
        code: 'CHJ',
        name: 'CHAUDHARY JEWELLER',
        mobile: null,
        city: null,
        openingGold: Weight.ZERO,
        openingCash: Money.ZERO,
        notes: null,
      },
      'user-1',
    )

    expect(() =>
      repos.customers.create(
        {
          code: 'chj',
          name: 'SOMEBODY ELSE',
          mobile: null,
          address: null,
          city: null,
          cnic: null,
          isWalkIn: false,
          openingGold: Weight.ZERO,
          openingCash: Money.ZERO,
        },
        'user-1',
      ),
    ).toThrow()
  })
})

describe('the repository seam', () => {
  it('exposes exactly the repositories the application layer declares', () => {
    expect(Object.keys(repos).sort()).toEqual([
      'audit',
      'backupLog',
      'branches',
      'customers',
      'goldRates',
      'itemCategories',
      'items',
      'locations',
      'parties',
      'pieces',
      'purchases',
      'retailBills',
      'retailDrafts',
      'retailSales',
      'salesmen',
      'settings',
      'shop',
      'stockLedger',
      'users',
      'wholesale',
    ])
  })
})
