import { assertSafeInteger } from '../common/rounding.js'
import { MAX_KATT_MILLI_RATTI, MILLI_RATTI_PER_TOLA } from '../common/units.js'

/**
 * Katt — the deduction that turns gross weight into khalis (pure) weight.
 *
 * Quoted in **ratti per tola**, on the 96-ratti scale. The real slip
 * (docs/wholesale-receipt.jpg) prints it in the column headed CAAT, and the
 * three rows there use 13.000, 13.000 and 11.500.
 *
 * **Katt is how purity is expressed on a wholesale slip.** There is no separate
 * purity column, and there is no karat figure. The pure-gold fraction is
 * `(96 − katt) / 96`, so katt 13 is 86.46% pure (about 20.7 K) and katt 11.5 is
 * 88.02% (about 21.1 K). Do not confuse this with the `Purity` enum
 * (K24/K22/K21/K18), which belongs to the gold-rate table and to retail.
 *
 * Confirmed against the working reference engine, which computes the same thing
 * as `factor = 1 - totalRatti / 96` (GoldLab `src/logic/purity.js`).
 *
 * Stored as an integer count of **milli-ratti**, for the same reason weight is
 * stored in milligrams: the slip quotes three decimal places and an integer
 * keeps it exact. 13.000 ratti is 13000; 11.500 is 11500.
 */
export class Katt {
  /** Thousandths of a ratti, per tola. Always an exact, non-negative integer. */
  readonly milliRatti: number

  private constructor(milliRatti: number) {
    assertSafeInteger(milliRatti, 'Katt in milli-ratti')
    if (milliRatti < 0 || milliRatti > MAX_KATT_MILLI_RATTI) {
      throw new RangeError(
        `Katt must be between 0 and ${MILLI_RATTI_PER_TOLA / 1000} ratti per tola, ` +
          `received ${milliRatti / 1000}. Outside that range it is not a deduction ` +
          `at all — 96 ratti would deduct the entire weight.`,
      )
    }
    this.milliRatti = milliRatti
    Object.freeze(this)
  }

  /** No deduction: khalis equals gross. */
  static readonly ZERO = new Katt(0)

  static fromMilliRatti(milliRatti: number): Katt {
    return milliRatti === 0 ? Katt.ZERO : new Katt(milliRatti)
  }

  /**
   * Parses a typed value exactly, with no floating point in the path — the same
   * string-padding approach as `Weight.parse`, and for the same reason.
   */
  static parse(input: string): Katt {
    const trimmed = input.trim()
    if (trimmed === '') throw new TypeError('Katt cannot be parsed from an empty string')

    const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed)
    if (!match || (match[1] === '' && (match[2] ?? '') === '')) {
      throw new TypeError(
        `"${input}" is not a valid katt. Expected ratti per tola, for example "13.000".`,
      )
    }

    const whole = match[1] === '' ? '0' : (match[1] as string)
    const fraction = match[2] ?? ''
    if (fraction.length > 3) {
      throw new RangeError(
        `"${input}" has more precision than a thousandth of a ratti.`,
      )
    }

    return Katt.fromMilliRatti(Number(whole) * 1000 + Number(fraction.padEnd(3, '0')))
  }

  get isZero(): boolean {
    return this.milliRatti === 0
  }

  /** Ratti to three decimal places, as the slip prints it. */
  format(): string {
    const whole = Math.trunc(this.milliRatti / 1000)
    const fraction = (this.milliRatti % 1000).toString().padStart(3, '0')
    return `${whole}.${fraction}`
  }

  /**
   * The purity this katt implies, as a percentage to two decimals.
   *
   * Display only — never used in a calculation, because going through a
   * percentage would reintroduce the rounding that working in milli-ratti
   * avoids. Useful on screen so an operator can sanity-check a katt against the
   * karat they expect.
   */
  purityPercent(): string {
    const fraction = (MILLI_RATTI_PER_TOLA - this.milliRatti) / MILLI_RATTI_PER_TOLA
    return `${(fraction * 100).toFixed(2)}%`
  }

  toJSON(): number {
    return this.milliRatti
  }

  toString(): string {
    return this.format()
  }
}
