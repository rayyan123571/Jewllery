import { describe, expect, it } from 'vitest'
import { Katt } from '../wholesale/Katt.js'
import { Weight } from '../common/Weight.js'
import { khalisOf } from '../wholesale/lineMath.js'
import { computePieceFigures } from './pieceMath.js'

/**
 * Piece arithmetic: khalis comes from the NET, because a stone is not gold.
 */

describe('piece figures', () => {
  it('deducts the stone before the katt — a stone is weight, not metal', () => {
    const figures = computePieceFigures({
      gross: Weight.parse('5.425'),
      stone: Weight.parse('1.000'),
      katt: Katt.parse('19.59'),
    })
    expect(figures.net.format()).toBe('4.425')
    // 4425 × (96000 − 19590) / 96000 = 3521.90… → 3.522 g.
    expect(figures.khalis.format()).toBe('3.522')
  })

  it('with no stone, matches the purchase line formula exactly', () => {
    const gross = Weight.parse('5.425')
    const katt = Katt.parse('19.59')
    const figures = computePieceFigures({ gross, stone: Weight.ZERO, katt })
    expect(figures.net.milligrams).toBe(gross.milligrams)
    expect(figures.khalis.milligrams).toBe(khalisOf(gross, katt).milligrams)
    expect(figures.khalis.format()).toBe('4.318')
  })

  it('refuses a stone heavier than the gross — it was part of what was weighed', () => {
    expect(() =>
      computePieceFigures({
        gross: Weight.parse('1.000'),
        stone: Weight.parse('1.001'),
        katt: Katt.ZERO,
      }),
    ).toThrow(/cannot exceed the gross/)
  })

  it('refuses a negative stone', () => {
    expect(() =>
      computePieceFigures({
        gross: Weight.parse('1.000'),
        stone: Weight.parse('0.100').negated(),
        katt: Katt.ZERO,
      }),
    ).toThrow(/negative/)
  })
})
