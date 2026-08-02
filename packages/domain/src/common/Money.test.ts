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

describe('Money — valuation of gold at a per-tola rate', () => {
  // The rate on docs/wholesale-receipt.jpg: Rs 358,000.00 per tola.
  const SLIP_RATE = Money.parse('358000')

  it('values exactly one tola as exactly the rate', () => {
    // 11.664 g is one tola by definition, so the answer must be the rate itself
    // with nothing lost. If the divisor or the order were wrong this is the
    // first thing that would break.
    const value = Money.valueOfAtTolaRate(Weight.parse('11.664'), SLIP_RATE)
    expect(value.format()).toBe('358,000.00')
  })

  it('reproduces the real slip total', () => {
    // Khalis total from the slip: 234.853 g at Rs 358,000/tola.
    //   234853 mg x 35,800,000 paisa / 11,664 mg = 720,827,966 paisa
    const value = Money.valueOfAtTolaRate(Weight.parse('234.853'), SLIP_RATE)
    expect(value.paisa).toBe(720_827_966)
    expect(value.format()).toBe('7,208,279.66')
  })

  it('does not silently convert the rate to per gram', () => {
    // This is the bug this method exists to prevent. Rs 358,000 per tola is
    // 3,069,272.977... paisa per gram — NOT an integer. Storing that rounded
    // figure and multiplying by grams loses a little on every single line.
    const perGramRounded = Math.round(SLIP_RATE.paisa / 11.664) // 3,069,273
    const viaPerGram = Money.fromPaisa(Math.round((234_853 * perGramRounded) / 1000))
    const viaPerTola = Money.valueOfAtTolaRate(Weight.parse('234.853'), SLIP_RATE)

    // 6 paisa on this slip — smaller than a first estimate suggests, because
    // integer PAISA per gram is already fine-grained. The fix still matters:
    // the loss is silent, it compounds across every transaction, and at any
    // coarser storage it is far worse (whole RUPEES per gram would lose about
    // Rs 98 on this one slip). Storing the figure that was actually entered
    // costs nothing and removes the whole question.
    expect(viaPerGram.equals(viaPerTola)).toBe(false)
    expect(viaPerGram.minus(viaPerTola).paisa).toBe(6)
  })

  it('multiplies before dividing so nothing is lost in the middle', () => {
    // One milligram is worth 3,069.34 paisa at the slip rate. Dividing the
    // weight into tolas first would floor it to zero and lose the line entirely.
    const value = Money.valueOfAtTolaRate(Weight.fromMilligrams(1), SLIP_RATE)
    expect(value.paisa).toBe(3069)
  })

  it('rounds half away from zero, symmetrically', () => {
    // 1 mg at a rate of 11,664 paisa/tola is exactly 1 paisa; at 5,832 it is
    // exactly 0.5 paisa, which must round to 1 in both directions.
    expect(Money.valueOfAtTolaRate(Weight.fromMilligrams(1), Money.fromPaisa(5832)).paisa).toBe(1)
    expect(Money.valueOfAtTolaRate(Weight.fromMilligrams(-1), Money.fromPaisa(5832)).paisa).toBe(-1)
  })

  it('values a negative weight as a negative amount, preserving the sign convention', () => {
    // The shop owes 0.500 g. Its value is money the shop owes.
    const value = Money.valueOfAtTolaRate(Weight.parse('-0.500'), SLIP_RATE)
    expect(value.isNegative).toBe(true)
    expect(value.absolute.paisa).toBe(1_534_636)
  })

  it('handles a whole shop holding with room to spare', () => {
    // 5 kg at Rs 400,000/tola — comfortably beyond a counter's stock.
    const value = Money.valueOfAtTolaRate(Weight.parse('5000'), Money.parse('400000'))
    expect(value.format()).toBe('171,467,764.06')
  })

  it('throws rather than degrading when a valuation is implausibly large', () => {
    // Guards the assumption the integer-storage decision rests on.
    const absurdWeight = Weight.fromMilligrams(1e12)
    const absurdRate = Money.fromPaisa(1e6)
    expect(() => Money.valueOfAtTolaRate(absurdWeight, absurdRate)).toThrow(/Intermediate overflow/)
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
