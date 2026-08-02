import { describe, expect, it } from 'vitest'
import { Money } from './Money.js'
import { Weight } from './Weight.js'

describe('Money — parsing at the UI edge', () => {
  it('parses whole rupees', () => {
    expect(Money.parse('9400').paisa).toBe(940_000)
  })

  it('parses two decimal places exactly', () => {
    expect(Money.parse('9400.75').paisa).toBe(940_075)
  })

  it('pads a short fraction', () => {
    // "10.5" is ten rupees fifty paisa, not ten rupees five paisa.
    expect(Money.parse('10.5').paisa).toBe(1050)
  })

  it('accepts what people actually type', () => {
    expect(Money.parse('Rs 1,234.56').paisa).toBe(123_456)
    expect(Money.parse(' 1,234 ').paisa).toBe(123_400)
  })

  it('parses negatives, because the shop can owe money', () => {
    expect(Money.parse('-500').paisa).toBe(-50_000)
  })

  it('rejects sub-paisa precision rather than rounding silently', () => {
    expect(() => Money.parse('1.005')).toThrow(/more precision than a paisa/)
  })

  it('rejects junk', () => {
    expect(() => Money.parse('')).toThrow()
    expect(() => Money.parse('abc')).toThrow()
  })
})

describe('Money — arithmetic is exact', () => {
  it('adds without floating point drift', () => {
    expect(Money.parse('0.1').plus(Money.parse('0.2')).paisa).toBe(30)
  })

  it('survives ten thousand additions of one paisa', () => {
    let total = Money.ZERO
    for (let i = 0; i < 10_000; i++) total = total.plus(Money.fromPaisa(1))
    expect(total.paisa).toBe(10_000)
    expect(total.format()).toBe('100.00')
  })

  it('refuses a fractional paisa', () => {
    expect(() => Money.fromPaisa(0.5)).toThrow(/must be an integer/)
  })

  it('separates gross receivable from gross payable when summing', () => {
    const balances = [Money.parse('100'), Money.parse('-100')]
    expect(Money.sum(balances).isZero).toBe(true)
  })
})

describe('Money — valuation of gold', () => {
  it('values a round weight at a round rate', () => {
    // 10.000 g at Rs 9,400.00/g = Rs 94,000.00
    const value = Money.valueOf(Weight.parse('10'), Money.parse('9400'))
    expect(value.format()).toBe('94,000.00')
  })

  it('values a fractional weight exactly', () => {
    // 700.500 g at Rs 9,400.00/g = Rs 6,584,700.00
    const value = Money.valueOf(Weight.parse('700.500'), Money.parse('9400'))
    expect(value.format()).toBe('6,584,700.00')
  })

  it('multiplies before dividing so no precision is lost mid-calculation', () => {
    // 1 mg is 0.001 g; at Rs 9,400.00/g that is Rs 9.40, i.e. 940 paisa.
    // Dividing first would give 0 mg-worth and lose the amount entirely.
    const value = Money.valueOf(Weight.fromMilligrams(1), Money.parse('9400'))
    expect(value.paisa).toBe(940)
    expect(value.format()).toBe('9.40')
  })

  it('rounds a valuation half away from zero, symmetrically', () => {
    // 1 mg at Rs 5.00/g is 0.5 paisa -> 1 paisa, in both directions.
    expect(Money.valueOf(Weight.fromMilligrams(1), Money.parse('5')).paisa).toBe(1)
    expect(Money.valueOf(Weight.fromMilligrams(-1), Money.parse('5')).paisa).toBe(-1)
  })

  it('values a negative weight as a negative amount, preserving the sign convention', () => {
    // The shop owes 0.500 g; at Rs 9,400/g that is Rs 4,700 the shop owes.
    const value = Money.valueOf(Weight.parse('-0.500'), Money.parse('9400'))
    expect(value.isNegative).toBe(true)
    expect(value.absolute.format()).toBe('4,700.00')
  })

  it('throws rather than degrading when a valuation is implausibly large', () => {
    // Guards the assumption the integer-storage decision rests on.
    const absurdWeight = Weight.fromMilligrams(1e12)
    const absurdRate = Money.fromPaisa(1e6)
    expect(() => Money.valueOf(absurdWeight, absurdRate)).toThrow(/Intermediate overflow/)
  })

  it('handles a realistic shop total with room to spare', () => {
    // 100 kg of gold at Rs 30,000/g — far beyond any real shop's holdings.
    const value = Money.valueOf(Weight.parse('100000'), Money.parse('30000'))
    expect(value.format()).toBe('3,000,000,000.00')
  })
})

describe('Money — display', () => {
  it('always shows two decimal places with grouping', () => {
    expect(Money.parse('9151688').format()).toBe('9,151,688.00')
    expect(Money.parse('0.05').format()).toBe('0.05')
    expect(Money.ZERO.format()).toBe('0.00')
  })

  it('formats negatives exactly', () => {
    expect(Money.parse('-1234.5').format()).toBe('-1,234.50')
  })

  it('formats whole rupees for narrow printed slips', () => {
    expect(Money.parse('9151688.49').formatWhole()).toBe('9,151,688')
    expect(Money.parse('9151688.50').formatWhole()).toBe('9,151,689')
  })

  it('crosses IPC as a plain integer', () => {
    expect(JSON.parse(JSON.stringify({ m: Money.parse('12.34') }))).toEqual({ m: 1234 })
  })

  it('round-trips through the database representation', () => {
    const original = Money.parse('-9876.54')
    expect(Money.fromPaisa(original.paisa).equals(original)).toBe(true)
  })
})
