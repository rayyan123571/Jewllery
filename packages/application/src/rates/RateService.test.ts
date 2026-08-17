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
    expect(rate?.ratePerTola.format()).toBe('8,950.00')
  })

  it('does not apply a future-dated rate early', () => {
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-31'))
    expect(rate?.ratePerTola.format()).toBe('8,950.00')
  })

  it('applies a rate on its first effective day', () => {
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-01'))
    expect(rate?.ratePerTola.format()).toBe('8,950.00')
  })

  it('still returns last month rate for a transaction dated last month', () => {
    // This is the reason the service exists. Reprinting an old statement must
    // not reprice it at today's gold price.
    const rate = service.rateOn(BRANCH, 'K22', toIsoDate('2026-07-15'))
    expect(rate?.ratePerTola.format()).toBe('8,900.00')
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
    expect(service.rateOn(BRANCH, 'K21', toIsoDate('2026-08-02'))?.ratePerTola.format()).toBe(
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

  it('values exactly one tola as exactly the rate', () => {
    const value = service.value(BRANCH, Weight.parse('11.664'), 'K22', toIsoDate('2026-08-02'))
    expect(value.format()).toBe('8,950.00')
  })

  it('values a fractional weight without losing it', () => {
    const value = service.value(BRANCH, Weight.parse('0.001'), 'K22', toIsoDate('2026-08-02'))
    expect(value.paisa).toBe(77)
  })

  it('preserves the sign convention into the cash ledger', () => {
    // The shop owes 0.500 g. Its value is money the shop owes.
    const value = service.value(BRANCH, Weight.parse('-0.500'), 'K22', toIsoDate('2026-08-02'))
    expect(value.isNegative).toBe(true)
    expect(value.absolute.paisa).toBe(38_366)
  })
})

describe('recording a rate', () => {
  it('records a new row rather than updating the old one', () => {
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerTola: Money.fromRupees(8950),
      effectiveFrom: toIsoDate('2026-08-01'),
      note: null,
    })
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerTola: Money.fromRupees(9000),
      effectiveFrom: toIsoDate('2026-08-02'),
      note: 'market up',
    })

    expect(rates.rows).toHaveLength(2)
    // Yesterday's valuation is untouched by today's change.
    expect(service.rateOn(BRANCH, 'K22', toIsoDate('2026-08-01'))?.ratePerTola.format()).toBe(
      '8,950.00',
    )
  })

  it('writes an audit entry including the previous rate', () => {
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerTola: Money.fromRupees(8950),
      effectiveFrom: toIsoDate('2026-08-01'),
      note: null,
    })
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerTola: Money.fromRupees(9000),
      effectiveFrom: toIsoDate('2026-08-02'),
      note: null,
    })

    const last = audit.entries.at(-1)
    expect(last?.action).toBe('GOLD_RATE_SET')
    expect(JSON.parse(last?.detail ?? '{}')).toMatchObject({
      ratePerTolaPaisa: 900_000,
      previousRatePerTolaPaisa: 895_000,
    })
  })

  it('refuses a rate of zero or less', () => {
    expect(() =>
      service.setRate(admin, {
        branchId: BRANCH,
        purity: 'K22',
        ratePerTola: Money.ZERO,
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
        ratePerTola: Money.fromRupees(8950),
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
        ratePerTola: Money.fromRupees(8950),
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
        ratePerTola: Money.fromRupees(8950),
        effectiveFrom: toIsoDate('2026-08-02'),
        note: null,
      }),
    ).toThrow(PermissionError)
    expect(rates.rows).toHaveLength(0)
  })
})

describe('a lower purity may never be worth more than a higher one', () => {
  // 22 karat is 916 parts pure of a thousand and 24 karat is 999, so a tola of
  // 22K contains strictly less gold and cannot fetch more for it. When the two
  // disagree the shop has a typo, and nothing downstream re-checks the figure —
  // every slip is priced off it until somebody notices.

  function set(purity: 'K24' | 'K22' | 'K21' | 'K18', rupees: number, on = '2026-08-02') {
    return () =>
      service.setRate(admin, {
        branchId: BRANCH,
        purity,
        ratePerTola: Money.fromRupees(rupees),
        effectiveFrom: toIsoDate(on),
        note: null,
      })
  }

  it('accepts a rate that keeps the ordering', () => {
    rates.seed(BRANCH, 'K24', 500_000, '2026-08-01')
    expect(set('K22', 458_000)).not.toThrow()
    expect(rates.rows).toHaveLength(2)
  })

  it('accepts a full monotonic ladder', () => {
    rates.seed(BRANCH, 'K24', 500_000, '2026-08-01')
    expect(set('K22', 458_000)).not.toThrow()
    expect(set('K21', 437_500)).not.toThrow()
    expect(set('K18', 375_000)).not.toThrow()
  })

  it('rejects a lower purity priced above a higher one', () => {
    rates.seed(BRANCH, 'K24', 432_000, '2026-08-01')
    expect(set('K22', 500_000)).toThrow(ValidationError)
    expect(set('K22', 500_000)).toThrow(/lower purity cannot be worth more/)
  })

  it('rejects a higher purity priced below a lower one', () => {
    // The same inversion approached from the other side: setting 24K too low
    // against an existing 22K is the identical mistake.
    rates.seed(BRANCH, 'K22', 458_000, '2026-08-01')
    expect(set('K24', 400_000)).toThrow(ValidationError)
  })

  it('names both purities and both figures, so the typo is findable', () => {
    rates.seed(BRANCH, 'K24', 432_000, '2026-08-01')
    expect(set('K22', 500_000)).toThrow(/22K at Rs 500,000 per tola/)
    expect(set('K22', 500_000)).toThrow(/24K at Rs 432,000/)
  })

  it('accepts two purities quoting the same figure', () => {
    // Unusual, not an inversion. Refusing it would block a legitimate flat quote.
    rates.seed(BRANCH, 'K24', 458_000, '2026-08-01')
    expect(set('K22', 458_000)).not.toThrow()
  })

  it('writes nothing when it refuses', () => {
    rates.seed(BRANCH, 'K24', 432_000, '2026-08-01')
    expect(set('K22', 500_000)).toThrow(ValidationError)
    expect(rates.rows).toHaveLength(1)
    expect(audit.entries).toHaveLength(0)
  })

  it('checks against the rate in force on the effective date, not the newest', () => {
    rates.seed(BRANCH, 'K24', 600_000, '2026-08-01')
    rates.seed(BRANCH, 'K24', 300_000, '2026-09-01') // takes over later
    // Effective 2026-08-15, 24K is still 600,000, so 458,000 for 22K is fine.
    expect(set('K22', 458_000, '2026-08-15')).not.toThrow()
  })

  it('leaves a purity with no rate on that date out of the comparison', () => {
    // Nothing to contradict. A fresh install must be able to record its first
    // rate whatever purity it happens to be.
    expect(set('K18', 375_000)).not.toThrow()
  })

  it('does not compare against a rate that is not yet effective', () => {
    rates.seed(BRANCH, 'K24', 432_000, '2026-09-01')
    // On 02-08 the 24K row has not taken effect, so it cannot constrain 22K.
    expect(set('K22', 500_000)).not.toThrow()
  })

  it('keeps branches independent', () => {
    rates.seed('branch-2', 'K24', 432_000, '2026-08-01')
    expect(set('K22', 500_000)).not.toThrow()
  })
})

describe('setting 24K derives the other three', () => {
  // The shop quotes one figure — pure gold. 22K is 916/999 of it, 21K is
  // 875/999, 18K is 750/999. Typing them separately is three chances at the
  // typo the purity-ordering check exists to catch.

  function set24(rupees: number) {
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K24',
      ratePerTola: Money.fromRupees(rupees),
      effectiveFrom: toIsoDate('2026-08-02'),
      note: null,
    })
  }

  it('writes four rows for one 24K entry, each a real row with a source note', () => {
    set24(402_000)
    expect(rates.rows).toHaveLength(4)
    expect(rates.rows.map((row) => row.purity)).toEqual(['K24', 'K22', 'K21', 'K18'])
    expect(rates.rows[1]?.note).toContain('Calculated from 24K')
  })

  it('derives by fineness with integer arithmetic, rounded once', () => {
    set24(402_000)
    const on = toIsoDate('2026-08-02')
    // 40 200 000 paisa × 916/999 = 36 860 060.06… → 36 860 060.
    expect(service.rateOn(BRANCH, 'K22', on)?.ratePerTola.paisa).toBe(36_860_060)
    // × 875/999 = 35 210 210.2… → 35 210 210.
    expect(service.rateOn(BRANCH, 'K21', on)?.ratePerTola.paisa).toBe(35_210_210)
    // × 750/999 = 30 180 180.1… → 30 180 180.
    expect(service.rateOn(BRANCH, 'K18', on)?.ratePerTola.paisa).toBe(30_180_180)
  })

  it('the derived ladder is monotonic, so the ordering check can never trip on it', () => {
    set24(402_000)
    const on = toIsoDate('2026-08-02')
    const [k24, k22, k21, k18] = (['K24', 'K22', 'K21', 'K18'] as const).map(
      (purity) => service.rateOn(BRANCH, purity, on)?.ratePerTola.paisa ?? 0,
    )
    expect(k24).toBeGreaterThan(k22 ?? 0)
    expect(k22).toBeGreaterThan(k21 ?? 0)
    expect(k21).toBeGreaterThan(k18 ?? 0)
  })

  it('a second 24K entry re-derives — the newest row wins for every purity', () => {
    set24(402_000)
    set24(410_000)
    const on = toIsoDate('2026-08-02')
    // 41 000 000 × 916/999 = 37 593 593.6 → 37 593 594.
    expect(service.rateOn(BRANCH, 'K22', on)?.ratePerTola.paisa).toBe(37_593_594)
    expect(rates.rows).toHaveLength(8)
  })

  it('audits every derived row with where it came from', () => {
    set24(402_000)
    const details = audit.entries.map((entry) => JSON.parse(entry.detail ?? '{}'))
    expect(details).toHaveLength(4)
    expect(details[1]).toMatchObject({ purity: 'K22', derivedFromK24Paisa: 40_200_000 })
  })

  it('setting a NON-24K rate derives nothing — it is a manual correction', () => {
    rates.seed(BRANCH, 'K24', 500_000, '2026-08-01')
    service.setRate(admin, {
      branchId: BRANCH,
      purity: 'K22',
      ratePerTola: Money.fromRupees(458_000),
      effectiveFrom: toIsoDate('2026-08-02'),
      note: null,
    })
    expect(rates.rows).toHaveLength(2)
  })
})

describe('the rate panel', () => {
  it('reports the current rate for every purity that has one', () => {
    rates.seed(BRANCH, 'K24', 9400, '2026-08-01')
    rates.seed(BRANCH, 'K22', 8950, '2026-08-01')
    const current = service.currentRates(BRANCH)
    expect(current.K24?.ratePerTola.format()).toBe('9,400.00')
    expect(current.K22?.ratePerTola.format()).toBe('8,950.00')
    expect(current.K18).toBeUndefined()
  })

  it('is empty on a fresh install', () => {
    expect(service.currentRates(BRANCH)).toEqual({})
  })
})
