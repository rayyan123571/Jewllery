import { describe, expect, it } from 'vitest'
import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { describeBalance } from '../common/balance.js'
import {
  MissingRateForSettlementError,
  cashToClear,
  computeSettlement,
} from './settlementMath.js'

/**
 * The settlement model from docs/DECISIONS.md §10, which is the shop's, not the
 * GoldLab reference's. All three ways of settling reduce the GOLD debt.
 */

const RATE = Money.parse('358000') // Rs 358,000 per tola, from the real slip
const OWED = Weight.parse('234.853') // the slip's Current Issued

describe('a. settling in khalis gold', () => {
  it('reduces the gold debt by the weight given', () => {
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.ZERO,
      ratePerTola: RATE,
    })
    expect(result.newGoldBalance.format()).toBe('134.853')
  })

  it('clears the debt exactly when the full weight is given', () => {
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: OWED,
      cashGiven: Money.ZERO,
      ratePerTola: RATE,
    })
    expect(result.newGoldBalance.isZero).toBe(true)
  })

  it('needs no rate at all', () => {
    expect(() =>
      computeSettlement({
        previousGoldBalance: OWED,
        goldGiven: Weight.parse('10'),
        cashGiven: Money.ZERO,
        ratePerTola: null,
      }),
    ).not.toThrow()
  })
})

describe('b. settling in cash', () => {
  it('reduces the GOLD debt by the gold that cash buys', () => {
    // Rs 1,000,000 at Rs 358,000/tola buys 32.581 g.
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      ratePerTola: RATE,
    })
    expect(result.goldFromCash.format()).toBe('32.581')
    expect(result.newGoldBalance.format()).toBe('202.272')
  })

  it('leaves the gold balance at ZERO after a full cash settlement', () => {
    // The heart of the shop's model: not "gold still owed, cash in credit".
    const fullPayment = cashToClear(OWED, RATE)
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.ZERO,
      cashGiven: fullPayment,
      ratePerTola: RATE,
    })
    expect(result.newGoldBalance.isZero).toBe(true)
    expect(describeBalance(result.newGoldBalance).direction).toBe('settled')
  })

  it('refuses when no rate exists for the date, rather than defaulting', () => {
    expect(() =>
      computeSettlement({
        previousGoldBalance: OWED,
        goldGiven: Weight.ZERO,
        cashGiven: Money.parse('1000000'),
        ratePerTola: null,
      }),
    ).toThrow(MissingRateForSettlementError)
  })

  it('says what to do about a missing rate', () => {
    expect(() =>
      computeSettlement({
        previousGoldBalance: OWED,
        goldGiven: Weight.ZERO,
        cashGiven: Money.parse('1000'),
        ratePerTola: null,
      }),
    ).toThrow(/Record the rate that applied that day/)
  })

  it('refuses a zero rate as well as a missing one', () => {
    expect(() =>
      computeSettlement({
        previousGoldBalance: OWED,
        goldGiven: Weight.ZERO,
        cashGiven: Money.parse('1000'),
        ratePerTola: Money.ZERO,
      }),
    ).toThrow(MissingRateForSettlementError)
  })

  it('uses the rate it is handed, never re-derives one', () => {
    // History must not move when the rate changes. Settling the same debt at a
    // different stored rate buys a different weight — which is correct, and is
    // why the rate belongs on the row.
    const atSlipRate = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      ratePerTola: RATE,
    })
    const atHigherRate = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      ratePerTola: Money.parse('400000'),
    })
    expect(atSlipRate.goldFromCash.equals(atHigherRate.goldFromCash)).toBe(false)
  })
})

describe('c. settling part gold, part cash', () => {
  it('reduces the gold debt by both portions', () => {
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.parse('1000000'),
      ratePerTola: RATE,
    })
    expect(result.goldFromCash.format()).toBe('32.581')
    expect(result.totalGoldSettled.format()).toBe('132.581')
    expect(result.newGoldBalance.format()).toBe('102.272')
  })

  it('is one calculation, not two independent ones', () => {
    // The mixed case must agree with doing each half separately, or the slip
    // and the ledger would disagree about what a mixed settlement meant.
    const mixed = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.parse('1000000'),
      ratePerTola: RATE,
    })
    const goldPart = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.ZERO,
      ratePerTola: RATE,
    })
    const cashPart = computeSettlement({
      previousGoldBalance: goldPart.newGoldBalance,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      ratePerTola: RATE,
    })
    expect(mixed.newGoldBalance.equals(cashPart.newGoldBalance)).toBe(true)
  })

  it('clears the debt when the two portions together cover it', () => {
    const goldPortion = Weight.parse('100')
    const remaining = OWED.minus(goldPortion)
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: goldPortion,
      cashGiven: cashToClear(remaining, RATE),
      ratePerTola: RATE,
    })
    expect(result.newGoldBalance.isZero).toBe(true)
  })
})

describe('overpayment', () => {
  it('is allowed and goes negative', () => {
    const result = computeSettlement({
      previousGoldBalance: Weight.parse('10'),
      goldGiven: Weight.parse('15'),
      cashGiven: Money.ZERO,
      ratePerTola: RATE,
    })
    expect(result.newGoldBalance.milligrams).toBe(-5000)
    expect(result.isOverpayment).toBe(true)
  })

  it('is never clamped to zero', () => {
    const result = computeSettlement({
      previousGoldBalance: Weight.ZERO,
      goldGiven: Weight.parse('5'),
      cashGiven: Money.ZERO,
      ratePerTola: null,
    })
    expect(result.newGoldBalance.isNegative).toBe(true)
  })

  it('displays as "we owe", never as a bare minus', () => {
    const result = computeSettlement({
      previousGoldBalance: Weight.parse('10'),
      goldGiven: Weight.parse('15'),
      cashGiven: Money.ZERO,
      ratePerTola: null,
    })
    const shown = describeBalance(result.newGoldBalance)
    expect(shown.text).toBe('5.000 g (we owe)')
    expect(shown.text).not.toContain('-')
  })

  it('carries a negative opening forward into the next settlement', () => {
    const overpaid = computeSettlement({
      previousGoldBalance: Weight.parse('10'),
      goldGiven: Weight.parse('15'),
      cashGiven: Money.ZERO,
      ratePerTola: null,
    })
    // Next slip issues 20 g against a -5 g opening, leaving 15 g owed.
    const next = computeSettlement({
      previousGoldBalance: overpaid.newGoldBalance.plus(Weight.parse('20')),
      goldGiven: Weight.ZERO,
      cashGiven: Money.ZERO,
      ratePerTola: null,
    })
    expect(next.newGoldBalance.format()).toBe('15.000')
  })
})

describe('cashToClear, for the "pay this much" figure on screen', () => {
  it('is the inverse of the settlement conversion', () => {
    const cash = cashToClear(OWED, RATE)
    const result = computeSettlement({
      previousGoldBalance: OWED,
      goldGiven: Weight.ZERO,
      cashGiven: cash,
      ratePerTola: RATE,
    })
    expect(result.newGoldBalance.isZero).toBe(true)
  })

  it('values the slip debt at the slip rate', () => {
    expect(cashToClear(OWED, RATE).format()).toBe('7,208,279.66')
  })
})
