import { Money, Weight, fixedClock, toIsoDate, type PublicUser } from '@jewellery/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeAuditRepository, FakeGoldRateRepository } from '../testing/fakes.js'
import { PermissionError, ValidationError } from '../auth/AuthService.js'
import { NoRateError, RateService } from './RateService.js'

// No database, no window — the whole point of the layering.
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

const salesman: PublicUser = { ...admin, id: 'user-2', username: 'sales', role: 'SALESMAN' }

let rates: FakeGoldRateRepository
let audit: FakeAuditRepository
let service: RateService

beforeEach(() => {
  rates = new FakeGoldRateRepository(clock)
  audit = new FakeAuditRepository(clock)
  service = new RateService({ goldRates: rates, audit, clock })
})

describe('resolving the rate in force on a date', () => {
  beforeEach(() => {
    rates.seed(BRANCH, 'K22', 8900, '2026-07-01')
    rates.seed(BRANCH, 'K22', 8950, '2026-08-01')
    rates.seed(BRANCH, 'K22', 9100, '2026-09-01') // future-dated
  })

  it('uses the rate in force on the day, not the newest row', () => {
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-15'))
    expect(rate?.ratePerGram.format()).toBe('8,950.00')
  })

  it('does not apply a future-dated rate early', () => {
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-31'))
    expect(rate?.ratePerGram.format()).toBe('8,950.00')
  })

  it('applies a rate on its first effective day', () => {
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-01'))
    expect(rate?.ratePerGram.format()).toBe('8,950.00')
  })

  it('still returns last month rate for a transaction dated last month', () => {
    // This is the reason the service exists. Reprinting an old statement must
    // not reprice it at today's gold price.
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-07-15'))
    expect(rate?.ratePerGram.format()).toBe('8,900.00')
  })

  it('returns null before any rate existed, rather than zero', () => {
    expect(service.rateOn(BRANCH, 'K22', toIsoDate('2026-06-30'))).toBeNull()
  })

  it('keeps purities independent', () => {
    expect(service.rateOn(BRANCH, 'K24', toIsoDate('2026-08-15'))).toBeNull()
  })

  it('keeps branches independent', () => {
    expect(service.rateOn('branch-2', 'K22', toIsoDate('2026-08-15'))).toBeNull()
  })

  it('prefers a same-day correction recorded later', () => {
    rates.seed(BRANCH, 'K21', 8500, '2026-08-02')
    rates.seed(BRANCH, 'K21', 8550, '2026-08-02') // typo corrected
    expect(service.rateOn(BRANCH, 'K21', toIsoDate('2026-08-02'))?.ratePerGram.format()).toBe(
      '8,550.00',
    )
  })
})

describe('a missing rate is an error, not a zero', () => {
  it('throws with a message that says what to do', () => {
    expect(() => service.requireRateOn(BRANCH, 'K22', toIsoDate('2026-08-02'))).toThrow(
      NoRateError,
    )
    expect(() => service.requireRateOn(BRANCH, 'K22', toIsoDate('2026-08-02'))).toThrow(
      /a missing rate is not the same as a rate of zero/,
    )
  })

  it('refuses to value gold with no rate', () => {
    expect(() =>
      service.value(BRANCH, Weight.parse('10'), 'K22', toIsoDate('2026-08-02')),
    ).toThrow(NoRateError)
  })
})

describe('valuation', () => {
  beforeEach(() => {
    rates.seed(BRANCH, 'K22', 8950, '2026-08-01')
  })

  it('values a weight at the rate in force', () => {
    const value = service.value(BRANCH, Weight.parse('10'), 'K22', toIsoDate('2026-08-02'))
    expect(value.format()).toBe('89,500.00')
  })

  it('values a fractional weight exactly', () => {
    const value = service.value(BRANCH, Weight.parse('0.001'), 'K22', toIsoDate('2026-08-02'))
    expect(value.paisa).toBe(895)
  })

  it('preserves the sign convention into the cash ledger', () => {
    // The shop owes 0.500 g. Its value is money the shop owes.
    const value = service.value(BRANCH, Weight.parse('-0.500'), 'K22', toIsoDate('2026-08-02'))
    expect(value.isNegative).toBe(true)
    expect(value.absolute.format()).toBe('4,475.00')
  })

  it('values the mockup remaining weight without losing the sign', () => {
    const remaining = Weight.parse('700').minus(Weight.parse('450')).minus(Weight.parse('250.500'))
    const value = service.value(BRANCH, remaining, 'K22', toIsoDate('2026-08-02'))
    expect(remaining.milligrams).toBe(-500)
    expect(value.paisa).toBe(-447_500)
  })
})

describe('recording a rate', () => {
  it('records a new row rather than updating the old one', () => {
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerGram: Money.fromRupees(8950),
      effectiveFrom: toIsoDate('2026-08-01'),
      note: null,
    })
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerGram: Money.fromRupees(9000),
      effectiveFrom: toIsoDate('2026-08-02'),
      note: 'market up',
    })

    expect(rates.rows).toHaveLength(2)
    // Yesterday's valuation is untouched by today's change.
    expect(service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-01'))?.ratePerGram.format()).toBe(
      '8,950.00',
    )
  })

  it('writes an audit entry including the previous rate', () => {
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerGram: Money.fromRupees(8950),
      effectiveFrom: toIsoDate('2026-08-01'),
      note: null,
    })
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerGram: Money.fromRupees(9000),
      effectiveFrom: toIsoDate('2026-08-02'),
      note: null,
    })

    const last = audit.entries.at(-1)
    expect(last?.action).toBe('GOLD_RATE_SET')
    expect(JSON.parse(last?.detail ?? '{}')).toMatchObject({
      ratePerGramPaisa: 900_000,
      previousRatePerGramPaisa: 895_000,
    })
  })

  it('refuses a rate of zero or less', () => {
    expect(() =>
      service.setRate(admin, {
        branchId: BRANCH,
        purity: 'K22',
        ratePerGram: Money.ZERO,
        effectiveFrom: toIsoDate('2026-08-02'),
        note: null,
      }),
    ).toThrow(ValidationError)
  })

  it('allows tomorrow, because a shop may set the evening before', () => {
    expect(() =>
      service.setRate(admin, {
        branchId: BRANCH,
        purity: 'K22',
        ratePerGram: Money.fromRupees(8950),
        effectiveFrom: toIsoDate('2026-08-03'),
        note: null,
      }),
    ).not.toThrow()
  })

  it('rejects a date more than a year out, which is a mistyped year', () => {
    expect(() =>
      service.setRate(admin, {
        branchId: BRANCH,
        purity: 'K22',
        ratePerGram: Money.fromRupees(8950),
        effectiveFrom: toIsoDate('2062-08-02'),
        note: null,
      }),
    ).toThrow(/Check the year/)
  })

  it('does not let a salesman change the rate', () => {
    expect(() =>
      service.setRate(salesman, {
        branchId: BRANCH,
        purity: 'K22',
        ratePerGram: Money.fromRupees(8950),
        effectiveFrom: toIsoDate('2026-08-02'),
        note: null,
      }),
    ).toThrow(PermissionError)
    expect(rates.rows).toHaveLength(0)
  })
})

describe('the rate panel', () => {
  it('reports the current rate for every purity that has one', () => {
    rates.seed(BRANCH, 'K24', 9400, '2026-08-01')
    rates.seed(BRANCH, 'K22', 8950, '2026-08-01')
    const current = service.currentRates(BRANCH)
    expect(current.K24?.ratePerGram.format()).toBe('9,400.00')
    expect(current.K22?.ratePerGram.format()).toBe('8,950.00')
    expect(current.K18).toBeUndefined()
  })

  it('is empty on a fresh install', () => {
    expect(service.currentRates(BRANCH)).toEqual({})
  })
})
