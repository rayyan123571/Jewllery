import { Money, Weight, fixedClock, type PublicUser } from '@jewellery/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeAuditRepository, FakePartyRepository } from '../testing/fakes.js'
import { ValidationError } from '../auth/AuthService.js'
import { PartyService, type CreatePartyInput } from './PartyService.js'

// No database, no window.
const clock = fixedClock('2026-08-02T09:00:00.000Z')
const BRANCH = 'branch-1'

const admin: PublicUser = {
  id: 'user-1',
  branchId: BRANCH,
  name: 'Admin',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

let parties: FakePartyRepository
let audit: FakeAuditRepository
let service: PartyService

function input(overrides: Partial<CreatePartyInput> = {}): CreatePartyInput {
  return {
    branchId: BRANCH,
    code: 'CHJ',
    name: 'CHAUDHARY JEWELLER',
    mobile: '03067380000',
    city: 'Lahore',
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
    ...overrides,
  }
}

beforeEach(() => {
  parties = new FakePartyRepository(clock)
  audit = new FakeAuditRepository(clock)
  service = new PartyService({ parties, audit, clock })
})

describe('creating a party', () => {
  it('stores the party from the real slip', () => {
    const party = service.create(admin, input())
    expect(party.code).toBe('CHJ')
    expect(party.name).toBe('CHAUDHARY JEWELLER')
    expect(party.mobile).toBe('03067380000')
    expect(party.isActive).toBe(true)
  })

  it('normalises the code to upper case', () => {
    expect(service.create(admin, input({ code: '  chj  ' })).code).toBe('CHJ')
  })

  it('trims the name', () => {
    expect(service.create(admin, input({ name: '  Party  ' })).name).toBe('Party')
  })

  it('turns blank optional fields into null rather than empty strings', () => {
    const party = service.create(admin, input({ mobile: '   ', city: '', notes: '' }))
    expect(party.mobile).toBeNull()
    expect(party.city).toBeNull()
    expect(party.notes).toBeNull()
  })

  it('refuses a duplicate code, in any case', () => {
    service.create(admin, input())
    expect(() => service.create(admin, input({ code: 'chj', name: 'Other' }))).toThrow(
      ValidationError,
    )
    expect(() => service.create(admin, input({ code: 'chj' }))).toThrow(
      /already used by another party/,
    )
  })

  it('refuses an empty code or name', () => {
    expect(() => service.create(admin, input({ code: '   ' }))).toThrow(/code is required/)
    expect(() => service.create(admin, input({ name: '   ' }))).toThrow(/name is required/)
  })

  it('records opening balances exactly, in both ledgers', () => {
    const party = service.create(
      admin,
      input({ openingGold: Weight.parse('227.550'), openingCash: Money.parse('50000') }),
    )
    expect(party.openingGold.milligrams).toBe(227_550)
    expect(party.openingCash.paisa).toBe(5_000_000)
  })

  it('accepts a negative opening balance, because the shop can owe the party', () => {
    const party = service.create(admin, input({ openingGold: Weight.parse('-7.310') }))
    expect(party.openingGold.milligrams).toBe(-7310)
    expect(party.openingGold.isNegative).toBe(true)
  })

  it('writes the opening balances to the audit trail', () => {
    // They are the one balance nobody can derive from a transaction, so this is
    // the only record of what was entered and by whom.
    service.create(admin, input({ openingGold: Weight.parse('227.550') }))
    const entry = audit.entries.at(-1)
    expect(entry?.action).toBe('PARTY_CREATED')
    expect(JSON.parse(entry?.detail ?? '{}')).toMatchObject({
      code: 'CHJ',
      openingGoldMg: 227_550,
    })
  })
})

describe('the type-ahead selector', () => {
  beforeEach(() => {
    service.create(admin, input({ code: 'CHJ', name: 'CHAUDHARY JEWELLER' }))
    service.create(admin, input({ code: 'ALC', name: 'AL-CHISHTI GOLD' }))
    service.create(admin, input({ code: 'ASF', name: 'ASIF SALEEM' }))
  })

  it('returns nothing for an empty query rather than everything', () => {
    // A selector that dumps the whole book on focus is unusable at a counter.
    expect(service.search(BRANCH, '')).toEqual([])
    expect(service.search(BRANCH, '   ')).toEqual([])
  })

  it('matches on code', () => {
    expect(service.search(BRANCH, 'CHJ').map((p) => p.code)).toEqual(['CHJ'])
  })

  it('matches on name', () => {
    expect(service.search(BRANCH, 'SALEEM').map((p) => p.code)).toEqual(['ASF'])
  })

  it('ranks a prefix match above a contains match', () => {
    // Typing "CH" must offer CHAUDHARY before AL-CHISHTI, so the first
    // suggestion is the one a fast typist would accept blind.
    expect(service.search(BRANCH, 'CH').map((p) => p.code)).toEqual(['CHJ', 'ALC'])
  })

  it('is case-insensitive', () => {
    expect(service.search(BRANCH, 'chaudhary').map((p) => p.code)).toEqual(['CHJ'])
  })

  it('excludes deactivated parties from the selector', () => {
    const chj = service.findByCode(BRANCH, 'CHJ')
    service.setActive(admin, chj?.id ?? '', false)
    expect(service.search(BRANCH, 'CH').map((p) => p.code)).toEqual(['ALC'])
  })

  it('keeps branches separate', () => {
    expect(service.search('branch-2', 'CH')).toEqual([])
  })

  it('respects the limit', () => {
    expect(service.search(BRANCH, 'A', 1)).toHaveLength(1)
  })
})

describe('editing a party', () => {
  it('updates the contact details', () => {
    const party = service.create(admin, input())
    const updated = service.update(admin, party.id, {
      name: 'CHAUDHARY JEWELLERS',
      mobile: '03001234567',
      city: 'Multan',
      notes: 'moved',
    })
    expect(updated.name).toBe('CHAUDHARY JEWELLERS')
    expect(updated.city).toBe('Multan')
  })

  it('cannot change the code, which appears on printed slips', () => {
    const party = service.create(admin, input())
    service.update(admin, party.id, {
      name: 'Renamed',
      mobile: null,
      city: null,
      notes: null,
    })
    expect(service.findById(party.id)?.code).toBe('CHJ')
  })

  it('cannot change the opening balances', () => {
    // Correcting one is an adjusting entry in the ledger, not an edit here —
    // otherwise a slip already printed would silently mean something else.
    const party = service.create(admin, input({ openingGold: Weight.parse('227.550') }))
    service.update(admin, party.id, { name: 'X', mobile: null, city: null, notes: null })
    expect(service.findById(party.id)?.openingGold.milligrams).toBe(227_550)
  })

  it('refuses a blank name', () => {
    const party = service.create(admin, input())
    expect(() =>
      service.update(admin, party.id, { name: '  ', mobile: null, city: null, notes: null }),
    ).toThrow(/name is required/)
  })
})

describe('deactivating rather than deleting', () => {
  it('offers no delete at all', () => {
    // A party with history cannot be removed without removing the transactions
    // that reference them, which would put the books out of balance.
    expect('delete' in service).toBe(false)
    expect('remove' in parties).toBe(false)
  })

  it('keeps a deactivated party readable by id', () => {
    const party = service.create(admin, input())
    service.setActive(admin, party.id, false)
    expect(service.findById(party.id)?.name).toBe('CHAUDHARY JEWELLER')
  })

  it('can be reactivated', () => {
    const party = service.create(admin, input())
    service.setActive(admin, party.id, false)
    service.setActive(admin, party.id, true)
    expect(service.search(BRANCH, 'CHJ')).toHaveLength(1)
  })

  it('audits the change', () => {
    const party = service.create(admin, input())
    service.setActive(admin, party.id, false)
    expect(audit.actions()).toContain('PARTY_DEACTIVATED')
  })
})
