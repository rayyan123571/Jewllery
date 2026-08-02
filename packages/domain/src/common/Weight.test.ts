import { describe, expect, it } from 'vitest'
import { Weight } from './Weight.js'

describe('Weight — parsing at the UI edge', () => {
  it('parses whole grams', () => {
    expect(Weight.parse('700').milligrams).toBe(700_000)
  })

  it('parses three decimal places exactly', () => {
    expect(Weight.parse('700.001').milligrams).toBe(700_001)
    expect(Weight.parse('250.500').milligrams).toBe(250_500)
  })

  it('pads short fractions rather than misreading them', () => {
    // "700.5" is 700.500 g, not 700.005 g.
    expect(Weight.parse('700.5').milligrams).toBe(700_500)
    expect(Weight.parse('700.05').milligrams).toBe(700_050)
  })

  it('parses without floating point error', () => {
    // The bug this class exists to prevent. The naive conversion is
    // `grams * 1000`, and for 1.005 g that evaluates to 1004.9999999999999 —
    // which truncates to 1004, silently losing a milligram at the point of
    // entry, before any calculation has even happened.
    expect(1.005 * 1000).toBe(1004.9999999999999)
    expect(Math.trunc(1.005 * 1000)).toBe(1004)

    // Parsing the string never multiplies, so it cannot drift.
    expect(Weight.parse('1.005').milligrams).toBe(1005)
  })

  it('parses negative weights, because balances are signed', () => {
    expect(Weight.parse('-0.500').milligrams).toBe(-500)
  })

  it('accepts thousands separators and whitespace as typed', () => {
    expect(Weight.parse(' 1,234.567 ').milligrams).toBe(1_234_567)
  })

  it('accepts a bare decimal', () => {
    expect(Weight.parse('.5').milligrams).toBe(500)
  })

  it('rejects more precision than a milligram rather than rounding silently', () => {
    expect(() => Weight.parse('1.0005')).toThrow(/more precision than a milligram/)
  })

  it('rejects junk rather than guessing', () => {
    expect(() => Weight.parse('')).toThrow()
    expect(() => Weight.parse('abc')).toThrow()
    expect(() => Weight.parse('1.2.3')).toThrow()
    expect(() => Weight.parse('--5')).toThrow()
  })
})

describe('Weight — construction guards', () => {
  it('refuses a fractional milligram, which means a decimal leaked past the edge', () => {
    expect(() => Weight.fromMilligrams(0.5)).toThrow(/must be an integer/)
  })

  it('refuses NaN and Infinity', () => {
    expect(() => Weight.fromMilligrams(Number.NaN)).toThrow()
    expect(() => Weight.fromMilligrams(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('refuses values beyond exact integer arithmetic', () => {
    expect(() => Weight.fromMilligrams(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /safe integer range/,
    )
  })

  it('is immutable', () => {
    const w = Weight.parse('100')
    expect(Object.isFrozen(w)).toBe(true)
  })
})

describe('Weight — arithmetic is exact', () => {
  it('adds and subtracts without drift', () => {
    const a = Weight.parse('0.1')
    const b = Weight.parse('0.2')
    // 0.1 + 0.2 !== 0.3 in floating point. In milligrams it is exact.
    expect(a.plus(b).milligrams).toBe(300)
    expect(a.plus(b).equals(Weight.parse('0.3'))).toBe(true)
  })

  it('survives a thousand additions with no accumulated error', () => {
    let total = Weight.ZERO
    for (let i = 0; i < 1000; i++) total = total.plus(Weight.parse('0.001'))
    expect(total.milligrams).toBe(1000)
    expect(total.format()).toBe('1.000')
  })

  it('scales by a rational rather than a decimal multiplier', () => {
    // A cut of 8.5% of 700.000 g is 59.500 g.
    expect(Weight.parse('700').scaled(85, 1000).format()).toBe('59.500')
  })

  it('rounds a scaled result half away from zero, symmetrically', () => {
    // 1 mg at 50% is 0.5 mg, which rounds to 1 mg in both directions.
    expect(Weight.fromMilligrams(1).scaled(1, 2).milligrams).toBe(1)
    expect(Weight.fromMilligrams(-1).scaled(1, 2).milligrams).toBe(-1)
  })

  it('sums a list', () => {
    const list = ['1.5', '2.25', '3.125'].map(Weight.parse)
    expect(Weight.sum(list).format()).toBe('6.875')
  })

  it('sums an empty list to zero', () => {
    expect(Weight.sum([]).isZero).toBe(true)
  })
})

describe('Weight — the mockup scenario', () => {
  // Given 700.000, Returned 450.000, Cut 250.500 -> Remaining -0.500 g.
  // The negative is the point: it must come out exactly, not as -0.4999999.
  const given = Weight.parse('700.000')
  const returned = Weight.parse('450.000')
  const cut = Weight.parse('250.500')
  const remaining = given.minus(returned).minus(cut)

  it('produces exactly -500 mg', () => {
    expect(remaining.milligrams).toBe(-500)
  })

  it('formats as -0.500, not -0.4999999', () => {
    expect(remaining.format()).toBe('-0.500')
  })

  it('reports the balance as negative', () => {
    expect(remaining.isNegative).toBe(true)
  })

  it('self-heals on the next issue', () => {
    // Opening -0.500 g, then 100.000 g issued, leaves 99.500 g owed.
    const afterNextIssue = remaining.plus(Weight.parse('100.000'))
    expect(afterNextIssue.format()).toBe('99.500')
    expect(afterNextIssue.isPositive).toBe(true)
  })
})

describe('Weight — display', () => {
  it('always shows three decimal places', () => {
    expect(Weight.parse('700').format()).toBe('700.000')
    expect(Weight.parse('0.5').format()).toBe('0.500')
    expect(Weight.ZERO.format()).toBe('0.000')
  })

  it('groups thousands', () => {
    expect(Weight.parse('1234567.891').format()).toBe('1,234,567.891')
  })

  it('formats negatives exactly', () => {
    expect(Weight.parse('-0.001').format()).toBe('-0.001')
  })

  it('appends the unit', () => {
    expect(Weight.parse('12.5').formatWithUnit()).toBe('12.500 g')
  })

  it('crosses IPC as a plain integer, not an object', () => {
    expect(JSON.parse(JSON.stringify({ w: Weight.parse('1.5') }))).toEqual({ w: 1500 })
  })

  it('round-trips through the database representation', () => {
    const original = Weight.parse('-1234.567')
    expect(Weight.fromMilligrams(original.milligrams).equals(original)).toBe(true)
  })
})

describe('Weight — comparison', () => {
  it('orders correctly across zero', () => {
    const negative = Weight.parse('-0.500')
    const zero = Weight.ZERO
    const positive = Weight.parse('0.500')
    expect(negative.isLessThan(zero)).toBe(true)
    expect(positive.isGreaterThan(zero)).toBe(true)
    expect(negative.compare(positive)).toBeLessThan(0)
  })

  it('reports magnitude without losing the original', () => {
    const w = Weight.parse('-0.500')
    expect(w.absolute.format()).toBe('0.500')
    expect(w.format()).toBe('-0.500')
  })
})
