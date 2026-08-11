import { Weight } from './Weight.js'
import { scaleDiv } from './rounding.js'
import { MG_PER_TOLA } from './units.js'

/**
 * Converting between the unit the trade quotes in and the unit we store in.
 *
 * `MG_PER_TOLA` already exists in units.ts and is 11,664 — an exact integer,
 * which is the whole reason weight is stored in milligrams. Nothing here
 * redefines it; this file only adds the conversions that were missing, and
 * every one of them goes through integer arithmetic.
 *
 * The bug this file exists to prevent is the one units.ts already warns about:
 * a per-tola rate multiplied by a gram weight gives a figure 11.664× too large.
 * Keeping the conversions in one place is what stops it coming back.
 *
 * Display is a separate concern from calculation. `formatTola` renders three
 * decimals for the screen; the arithmetic that produced the value stayed in
 * whole milligrams throughout.
 */

/** Exactly one tola, as milligrams. Re-exported so callers need one import. */
export const TOLA_IN_MG = MG_PER_TOLA

/**
 * A weight as a decimal-tola NUMBER, for display only.
 *
 * Deliberately not used in any calculation: the moment a tola figure becomes a
 * float it stops being exact, which is why `Money.valueOfAtTolaRate` takes a
 * Weight in milligrams and divides by 11,664 at the last step instead.
 */
export function toTolaNumber(weight: Weight): number {
  return weight.milligrams / TOLA_IN_MG
}

/** Three decimal places of a tola, the precision the trade quotes. */
export function formatTola(weight: Weight): string {
  const sign = weight.milligrams < 0 ? '-' : ''
  const magnitude = Math.abs(weight.milligrams)
  // Integer arithmetic: scale to milli-tola, then place the point by hand.
  const milliTola = scaleDiv(magnitude, 1000, TOLA_IN_MG)
  const whole = Math.trunc(milliTola / 1000)
  const fraction = (milliTola % 1000).toString().padStart(3, '0')
  return `${sign}${whole.toLocaleString('en-US')}.${fraction}`
}

/**
 * Parses a typed decimal-tola string into exact milligrams.
 *
 * Rounds half away from zero at the milligram, because a tola does not divide
 * into a whole number of milligrams at three decimal places — 0.001 tola is
 * 11.664 mg. The rounding happens once, here, at the UI edge.
 */
export function parseTola(input: string): Weight {
  const trimmed = input.trim().replace(/,/g, '')
  if (trimmed === '') {
    throw new TypeError('Weight cannot be parsed from an empty string')
  }
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new TypeError(`"${input}" is not a valid weight in tola.`)
  }
  if ((match[3] ?? '').length > 3) {
    throw new RangeError(
      `"${input}" has more precision than the trade quotes. Tola is recorded to ` +
        `three decimal places.`,
    )
  }
  const sign = match[1] === '-' ? -1 : 1
  const whole = match[2] === '' ? 0 : Number(match[2])
  const fraction = Number((match[3] ?? '').padEnd(3, '0'))
  const milliTola = whole * 1000 + fraction
  return Weight.fromMilligrams(sign * scaleDiv(milliTola, TOLA_IN_MG, 1000))
}

/** Grams to milligrams as a Weight, for the gram side of the unit toggle. */
export function parseGram(input: string): Weight {
  return Weight.parse(input)
}

/** Three decimal places of a gram. */
export function formatGram(weight: Weight): string {
  return weight.format()
}
