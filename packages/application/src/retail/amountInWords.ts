import type { Money } from '@jewellery/domain'

/**
 * An amount in words, in the Pakistani convention.
 *
 * Crore, lakh, thousand — NOT million and billion. The grouping is different,
 * not merely the vocabulary: 735,513 is "Seven Lakh Thirty Five Thousand Five
 * Hundred Thirteen", where the same number in the western convention is "Seven
 * Hundred Thirty-Five Thousand Five Hundred Thirteen". The digits group 2-2-3
 * from the right rather than 3-3-3, which is why this cannot be done by
 * borrowing an English number-to-words library and swapping the scale names.
 *
 * This exists because the amount in words is a legal fixture of an invoice: it
 * is what a dispute is settled on when the figures are smudged or altered. It
 * is rendered ONCE at post time and stored on the row, so the paper and the
 * screen can never drift apart afterwards.
 *
 * Paisa are deliberately dropped. Pakistani retail invoices are written in whole
 * rupees, and "Seventy Three Paisa Only" on a jewellery bill reads as an error.
 * The stored figure keeps its paisa; only the words round.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const

/** 0–99. The teens are irregular, so they are a lookup rather than a rule. */
function twoDigits(value: number): string {
  if (value < 20) return ONES[value] ?? ''
  const tens = TENS[Math.floor(value / 10)] ?? ''
  const ones = ONES[value % 10] ?? ''
  return ones ? `${tens} ${ones}` : tens
}

/** 0–999. */
function threeDigits(value: number): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest > 0) parts.push(twoDigits(rest))
  return parts.join(' ')
}

/**
 * The number itself, without the "Rupees … Only" wrapper.
 *
 * Groups 2-2-3 from the right: crore, lakh, thousand, then the last three
 * digits. Above 99 crore it keeps counting in crore — "One Hundred Crore" —
 * rather than inventing a larger unit, which is what the trade does.
 */
export function numberToWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Cannot put ${value} into words.`)
  }
  if (value === 0) return 'Zero'

  const crore = Math.floor(value / 10_000_000)
  const lakh = Math.floor((value % 10_000_000) / 100_000)
  const thousand = Math.floor((value % 100_000) / 1_000)
  const rest = value % 1_000

  const parts: string[] = []
  // Crore can exceed 99, so it recurses rather than using threeDigits.
  if (crore > 0) parts.push(`${numberToWords(crore)} Crore`)
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rest > 0) parts.push(threeDigits(rest))

  return parts.join(' ')
}

/**
 * The full invoice line: "Rupees Seven Lakh Thirty Five Thousand Five Hundred
 * Thirteen Only".
 *
 * A negative total is not a thing an invoice can say in words, so it is written
 * as what it actually is — money owed back — rather than with a minus sign that
 * a busy shopkeeper misreads (DECISIONS §4).
 */
export function amountInWords(amount: Money): string {
  const rupees = Math.trunc(Math.abs(amount.paisa) / 100)
  const words = numberToWords(rupees)
  return amount.paisa < 0
    ? `Rupees ${words} Only — refundable to the customer`
    : `Rupees ${words} Only`
}
