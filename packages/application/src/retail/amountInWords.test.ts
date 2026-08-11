import { Money } from '@jewellery/domain'
import { describe, expect, it } from 'vitest'
import { amountInWords, numberToWords } from './amountInWords.js'

/**
 * The amount in words is a legal fixture of an invoice — it is what a dispute
 * is settled on when the figures are smudged. The boundaries below are where a
 * western-convention library gets it wrong, which is why this is written here
 * rather than borrowed.
 */

describe('single digits and the irregular teens', () => {
  it.each([
    [0, 'Zero'],
    [1, 'One'],
    [9, 'Nine'],
    [10, 'Ten'],
    [11, 'Eleven'],
    [13, 'Thirteen'],
    [19, 'Nineteen'],
    [20, 'Twenty'],
    [21, 'Twenty One'],
    [99, 'Ninety Nine'],
  ])('%i is "%s"', (value, expected) => {
    expect(numberToWords(value)).toBe(expected)
  })
})

describe('hundreds', () => {
  it.each([
    [100, 'One Hundred'],
    [101, 'One Hundred One'],
    [110, 'One Hundred Ten'],
    [513, 'Five Hundred Thirteen'],
    [999, 'Nine Hundred Ninety Nine'],
  ])('%i is "%s"', (value, expected) => {
    expect(numberToWords(value)).toBe(expected)
  })
})

describe('the thousand boundary', () => {
  it.each([
    [1_000, 'One Thousand'],
    [1_001, 'One Thousand One'],
    [10_000, 'Ten Thousand'],
    [35_513, 'Thirty Five Thousand Five Hundred Thirteen'],
    [99_999, 'Ninety Nine Thousand Nine Hundred Ninety Nine'],
  ])('%i is "%s"', (value, expected) => {
    expect(numberToWords(value)).toBe(expected)
  })
})

describe('the lakh boundary — 1,00,000', () => {
  // This is the first place the western convention diverges. 100,000 is "One
  // Lakh", not "One Hundred Thousand", and 735,513 groups as 7|35|513.
  it.each([
    [100_000, 'One Lakh'],
    [100_001, 'One Lakh One'],
    [101_000, 'One Lakh One Thousand'],
    [735_513, 'Seven Lakh Thirty Five Thousand Five Hundred Thirteen'],
    [999_999, 'Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
    [9_999_999, 'Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
  ])('%i is "%s"', (value, expected) => {
    expect(numberToWords(value)).toBe(expected)
  })

  it('matches the example from the brief exactly', () => {
    expect(amountInWords(Money.fromRupees(735_513))).toBe(
      'Rupees Seven Lakh Thirty Five Thousand Five Hundred Thirteen Only',
    )
  })
})

describe('the crore boundary — 1,00,00,000', () => {
  it.each([
    [10_000_000, 'One Crore'],
    [10_000_001, 'One Crore One'],
    [10_100_000, 'One Crore One Lakh'],
    [12_345_678, 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight'],
    [99_99_99_999, 'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
  ])('%i is "%s"', (value, expected) => {
    expect(numberToWords(value)).toBe(expected)
  })

  it('keeps counting in crore above ninety-nine, as the trade does', () => {
    // Not "one arab" and not "one billion" — the shop says a hundred crore.
    expect(numberToWords(1_000_000_000)).toBe('One Hundred Crore')
  })
})

describe('the invoice line', () => {
  it('wraps the number in Rupees … Only', () => {
    expect(amountInWords(Money.fromRupees(1_500))).toBe('Rupees One Thousand Five Hundred Only')
  })

  it('says Zero rather than nothing at all', () => {
    expect(amountInWords(Money.ZERO)).toBe('Rupees Zero Only')
  })

  it('drops paisa, because a jewellery invoice is written in whole rupees', () => {
    expect(amountInWords(Money.parse('1500.73'))).toBe('Rupees One Thousand Five Hundred Only')
  })

  it('never prints a bare minus for money owed back', () => {
    // DECISIONS §4: a busy shopkeeper misreads a minus sign, so a negative is
    // written as what it actually means.
    const words = amountInWords(Money.fromRupees(-2_000))
    expect(words).not.toMatch(/-/)
    expect(words).toBe('Rupees Two Thousand Only — refundable to the customer')
  })

  it('refuses a value it cannot express rather than guessing', () => {
    expect(() => numberToWords(-1)).toThrow(/into words/)
    expect(() => numberToWords(1.5)).toThrow(/into words/)
  })
})
