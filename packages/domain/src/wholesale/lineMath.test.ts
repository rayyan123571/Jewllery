import { describe, expect, it } from 'vitest'
import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { Katt } from './Katt.js'
import { computeLine, khalisOf, totalsOf, type WholesaleLineInput } from './lineMath.js'

/**
 * The reference test for the whole wholesale module.
 *
 * Every figure here is read off the real printed slip in
 * docs/wholesale-receipt.jpg. If this file passes, the calculation agrees with
 * the system being replaced. If a future change breaks it, the change is wrong.
 */

const SLIP_RATE = Money.parse('358000') // Rs 358,000 per tola

const SLIP_LINES: WholesaleLineInput[] = [
  {
    itemName: 'SINGAPORI CHAIN 15',
    gross: Weight.parse('254.200'),
    katt: Katt.parse('13.000'),
    ratePerTola: SLIP_RATE,
    remarks: null,
  },
  {
    itemName: 'JEWELRY',
    gross: Weight.parse('10.280'),
    katt: Katt.parse('13.000'),
    ratePerTola: SLIP_RATE,
    remarks: null,
  },
  {
    itemName: 'OS JEWELARY',
    gross: Weight.parse('7.030'),
    katt: Katt.parse('11.500'),
    ratePerTola: SLIP_RATE,
    remarks: null,
  },
]

describe('the real slip, line by line', () => {
  const computed = SLIP_LINES.map(computeLine)

  it('SINGAPORI CHAIN 15: 254.200 at katt 13.000 gives 219.777', () => {
    expect(computed[0]?.khalis.format()).toBe('219.777')
  })

  it('JEWELRY: 10.280 at katt 13.000 gives 8.888', () => {
    expect(computed[1]?.khalis.format()).toBe('8.888')
  })

  it('OS JEWELARY: 7.030 at katt 11.500 gives 6.188', () => {
    expect(computed[2]?.khalis.format()).toBe('6.188')
  })

  it('reproduces the slip totals in the brackets', () => {
    const totals = totalsOf(computed)
    expect(totals.grossTotal.format()).toBe('271.510')
    expect(totals.khalisTotal.format()).toBe('234.853')
  })

  it('rounds each line half away from zero, not up', () => {
    // Row 1 is the one that discriminates. The exact value is 219.7770833…,
    // which CEILS to 219.778 but the slip prints 219.777 — so the reference
    // rounds ordinarily, and so do we.
    expect(computed[0]?.khalis.milligrams).toBe(219_777)
  })
})

describe('the katt formula', () => {
  it('is gross × (96 − katt) / 96', () => {
    // Stated once, and checked at a value chosen so the arithmetic is obvious:
    // katt 48 is exactly half the 96-ratti scale.
    expect(khalisOf(Weight.parse('100'), Katt.parse('48')).format()).toBe('50.000')
  })

  it('leaves the weight untouched at katt zero', () => {
    expect(khalisOf(Weight.parse('254.200'), Katt.ZERO).format()).toBe('254.200')
  })

  it('deducts everything at katt 96', () => {
    expect(khalisOf(Weight.parse('254.200'), Katt.parse('96')).isZero).toBe(true)
  })

  it('never treats katt as a weight', () => {
    // The mockup's model subtracted the cut as grams. At katt 13 on 254.200 g
    // that would leave 241.200, not 219.777. This asserts we are not doing it.
    const khalis = khalisOf(Weight.parse('254.200'), Katt.parse('13'))
    expect(khalis.format()).not.toBe('241.200')
    expect(khalis.format()).toBe('219.777')
  })

  it('scales with the weight, not with a fixed deduction', () => {
    // Doubling the gross doubles the khalis — which a weight-based cut would
    // not do, and is the clearest sign katt is a rate.
    const single = khalisOf(Weight.parse('10'), Katt.parse('13'))
    const double = khalisOf(Weight.parse('20'), Katt.parse('13'))
    expect(double.milligrams).toBe(single.milligrams * 2)
  })
})

describe('amount from khalis and a per-tola rate', () => {
  it('values each slip line', () => {
    const computed = SLIP_LINES.map(computeLine)
    // 219.777 g at Rs 358,000/tola
    expect(computed[0]?.amount.format()).toBe('6,745,556.07')
  })

  it('totals the amounts', () => {
    const totals = totalsOf(SLIP_LINES.map(computeLine))
    // The sum of the rounded line amounts, so the column adds up on paper.
    expect(totals.amountTotal.paisa).toBe(720_827_966)
  })

  it('agrees with valuing the khalis total in one go', () => {
    // Not guaranteed in general — summing rounded lines can differ from valuing
    // the summed weight by a paisa or two — but it holds on the real slip, and
    // asserting it here means a future change that introduces a drift shows up
    // as a failure rather than as a quietly different figure on the paper.
    const totals = totalsOf(SLIP_LINES.map(computeLine))
    const inOneGo = Money.valueOfAtTolaRate(totals.khalisTotal, SLIP_RATE)
    expect(totals.amountTotal.equals(inOneGo)).toBe(true)
  })

  it('computes the amount from the stored khalis, so the paper re-adds', () => {
    // The line prints 219.777 g; the amount printed beside it must be what
    // 219.777 g is worth, not what an unrounded 219.7770833 g would be worth.
    const line = computeLine(SLIP_LINES[0] as WholesaleLineInput)
    const fromPrintedWeight = Money.valueOfAtTolaRate(Weight.parse('219.777'), SLIP_RATE)
    expect(line.amount.equals(fromPrintedWeight)).toBe(true)
  })
})

describe('Katt as a value type', () => {
  it('parses the slip values exactly', () => {
    expect(Katt.parse('13.000').milliRatti).toBe(13_000)
    expect(Katt.parse('11.500').milliRatti).toBe(11_500)
  })

  it('pads a short fraction', () => {
    expect(Katt.parse('11.5').milliRatti).toBe(11_500)
  })

  it('formats to three decimals like the slip', () => {
    expect(Katt.parse('13').format()).toBe('13.000')
    expect(Katt.parse('11.5').format()).toBe('11.500')
  })

  it('rejects katt outside 0–96, which is arithmetically meaningless', () => {
    expect(() => Katt.parse('96.001')).toThrow(/between 0 and 96/)
    expect(() => Katt.fromMilliRatti(-1)).toThrow(/between 0 and 96/)
  })

  it('accepts the whole legal range', () => {
    expect(() => Katt.parse('0')).not.toThrow()
    expect(() => Katt.parse('96')).not.toThrow()
  })

  it('reports the purity a katt implies, for a sanity check on screen', () => {
    // Katt 13 is about 20.7 karat; katt 11.5 about 21.1.
    expect(Katt.parse('13').purityPercent()).toBe('86.46%')
    expect(Katt.parse('11.5').purityPercent()).toBe('88.02%')
  })

  it('rejects junk rather than guessing', () => {
    expect(() => Katt.parse('')).toThrow()
    expect(() => Katt.parse('abc')).toThrow()
    expect(() => Katt.parse('-5')).toThrow()
  })

  it('crosses IPC as a plain integer', () => {
    expect(JSON.parse(JSON.stringify({ k: Katt.parse('13') }))).toEqual({ k: 13_000 })
  })
})
