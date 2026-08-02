import { describe, expect, it } from 'vitest'
import { describeBalance, totalMoney, totalWeights } from './balance.js'
import { Money } from './Money.js'
import { Weight } from './Weight.js'

describe('the sign convention', () => {
  it('reads a positive balance as the party owing the shop', () => {
    const d = describeBalance(Weight.parse('99.500'))
    expect(d.direction).toBe('party-owes-shop')
    expect(d.label).toBe('they owe')
    expect(d.isOwedByShop).toBe(false)
  })

  it('reads a negative balance as the shop owing the party', () => {
    const d = describeBalance(Weight.parse('-0.500'))
    expect(d.direction).toBe('shop-owes-party')
    expect(d.label).toBe('we owe')
    expect(d.isOwedByShop).toBe(true)
  })

  it('reads zero as settled', () => {
    expect(describeBalance(Weight.ZERO).direction).toBe('settled')
    expect(describeBalance(Money.ZERO).direction).toBe('settled')
  })

  it('applies identically to the cash ledger', () => {
    expect(describeBalance(Money.parse('-1200')).label).toBe('we owe')
    expect(describeBalance(Money.parse('1200')).label).toBe('they owe')
  })
})

describe('balance display never shows a bare minus sign', () => {
  it('pairs a magnitude with plain words for a weight the shop owes', () => {
    const d = describeBalance(Weight.parse('-0.500'))
    expect(d.magnitude).toBe('0.500 g')
    expect(d.text).toBe('0.500 g (we owe)')
    expect(d.text).not.toContain('-')
  })

  it('pairs a magnitude with plain words for money the shop owes', () => {
    const d = describeBalance(Money.parse('-1200'))
    expect(d.text).toBe('Rs 1,200.00 (we owe)')
    expect(d.text).not.toContain('-')
  })

  it('shows a settled balance without a confusing label', () => {
    expect(describeBalance(Weight.ZERO).text).toBe('0.000 g')
  })

  it('never emits a minus sign for any signed input', () => {
    for (const mg of [-1, -500, -1_000_000, 0, 1, 500, 1_000_000]) {
      expect(describeBalance(Weight.fromMilligrams(mg)).text).not.toContain('-')
    }
  })
})

describe('totals keep receivable and payable visible separately', () => {
  // Ten parties owing and ten owed nets to zero. That is a true number and a
  // useless one — the shop's actual exposure is 2000 g in both directions.
  const balances = [
    ...Array.from({ length: 10 }, () => Weight.parse('200')),
    ...Array.from({ length: 10 }, () => Weight.parse('-200')),
  ]

  it('nets to zero, which alone would hide the exposure', () => {
    expect(totalWeights(balances).net.isZero).toBe(true)
  })

  it('reports gross receivable and gross payable separately', () => {
    const t = totalWeights(balances)
    expect(t.grossReceivable.format()).toBe('2,000.000')
    expect(t.grossPayable.format()).toBe('2,000.000')
  })

  it('reports gross payable as a positive magnitude, not a negative', () => {
    expect(totalWeights(balances).grossPayable.isNegative).toBe(false)
  })

  it('counts the parties the shop owes, for the dashboard badge', () => {
    expect(totalWeights(balances).payableCount).toBe(10)
  })

  it('does the same for the cash ledger', () => {
    const t = totalMoney([Money.parse('500'), Money.parse('-300'), Money.parse('-200')])
    expect(t.net.isZero).toBe(true)
    expect(t.grossReceivable.format()).toBe('500.00')
    expect(t.grossPayable.format()).toBe('500.00')
    expect(t.payableCount).toBe(2)
  })

  it('handles an empty book', () => {
    const t = totalWeights([])
    expect(t.net.isZero).toBe(true)
    expect(t.payableCount).toBe(0)
  })
})

describe('negative balances are first class', () => {
  it('is never clamped to zero', () => {
    const b = Weight.parse('-0.500')
    expect(b.milligrams).toBe(-500)
    expect(describeBalance(b).direction).toBe('shop-owes-party')
  })

  it('keeps the sign through valuation into the cash ledger', () => {
    const owed = Weight.parse('-0.500')
    const value = Money.valueOfAtTolaRate(owed, Money.parse('358000'))
    expect(describeBalance(value).label).toBe('we owe')
  })

  it('keeps gold and cash separate rather than netting them', () => {
    // A party owing gold while the shop owes them cash is a normal state.
    const gold = describeBalance(Weight.parse('50'))
    const cash = describeBalance(Money.parse('-20000'))
    expect(gold.label).toBe('they owe')
    expect(cash.label).toBe('we owe')
  })
})
