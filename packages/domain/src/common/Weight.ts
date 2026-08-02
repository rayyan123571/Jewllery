import { assertSafeInteger, scaleDiv } from './rounding.js'

/**
 * A weight of gold, stored as an exact integer number of **milligrams**.
 *
 * There is no floating point anywhere in this class. `0.1 + 0.2 !== 0.3` in
 * binary floating point, and a ledger that is a fraction of a gram out at the
 * end of the year is a ledger nobody trusts — the worse part being that the
 * error never happened in any one place, so it cannot be found.
 *
 * Decimal grams exist only at the two edges of the system: `parse` when a
 * number is typed in, and `format`/`toGrams` when one is shown or printed.
 * Between those two points every value is an integer.
 *
 * Weight is **signed**. A negative weight is a real business state: by the sign
 * convention in docs/DECISIONS.md §4, a negative party balance means the shop
 * owes the party gold. Negatives are never clamped and never absolute-valued.
 *
 * Instances are immutable; every operation returns a new Weight.
 */
export class Weight {
  /** Milligrams. Always an exact, safe integer. May be negative. */
  readonly milligrams: number

  private constructor(milligrams: number) {
    assertSafeInteger(milligrams, 'Weight in milligrams')
    this.milligrams = milligrams
    Object.freeze(this)
  }

  static readonly ZERO = new Weight(0)

  /** The canonical constructor. This is what comes out of the database. */
  static fromMilligrams(milligrams: number): Weight {
    return milligrams === 0 ? Weight.ZERO : new Weight(milligrams)
  }

  /**
   * Parses a typed decimal-gram string exactly, with no floating point in the
   * path at all. `"700.001"` becomes 700001 mg — not 700000.9999999999, which
   * is what `700.001 * 1000` actually evaluates to.
   *
   * This is the correct entry point for anything a user types. Accepts an
   * optional sign, an optional decimal part of up to three places, and
   * surrounding whitespace. Rejects everything else rather than guessing.
   */
  static parse(input: string): Weight {
    const trimmed = input.trim().replace(/,/g, '')
    if (trimmed === '') {
      throw new TypeError('Weight cannot be parsed from an empty string')
    }

    const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed)
    if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
      throw new TypeError(
        `"${input}" is not a valid weight. Expected grams, for example "700.500".`,
      )
    }

    const sign = match[1] === '-' ? -1 : 1
    const wholeGrams = match[2] === '' ? '0' : (match[2] as string)
    const fraction = match[3] ?? ''

    if (fraction.length > 3) {
      throw new RangeError(
        `"${input}" has more precision than a milligram. Weight is recorded to ` +
          `three decimal places of a gram.`,
      )
    }

    // String padding, not multiplication — this is what keeps it exact.
    const milligramDigits = fraction.padEnd(3, '0')
    const milligrams = Number(wholeGrams) * 1000 + Number(milligramDigits)
    return Weight.fromMilligrams(sign * milligrams)
  }

  /**
   * Builds a Weight from a decimal-gram JavaScript number.
   *
   * Prefer `parse` for anything a user typed: by the time a decimal is a
   * `number` it may already have lost precision, and this method can only round
   * what it is given. Use this for literals in tests and seed data, where the
   * value is known to be representable.
   */
  static fromGrams(grams: number): Weight {
    if (!Number.isFinite(grams)) {
      throw new TypeError(`Weight in grams must be finite, received ${String(grams)}`)
    }
    return Weight.fromMilligrams(scaleDiv(Math.trunc(grams * 1e6), 1, 1000))
  }

  // ── arithmetic ─────────────────────────────────────────────────────────────

  plus(other: Weight): Weight {
    return Weight.fromMilligrams(this.milligrams + other.milligrams)
  }

  minus(other: Weight): Weight {
    return Weight.fromMilligrams(this.milligrams - other.milligrams)
  }

  negated(): Weight {
    return Weight.fromMilligrams(-this.milligrams)
  }

  /** Exact whole-number multiplication, e.g. the same item counted five times. */
  timesInteger(factor: number): Weight {
    assertSafeInteger(factor, 'Weight multiplier')
    return Weight.fromMilligrams(this.milligrams * factor)
  }

  /**
   * Exact rational scaling, rounded half away from zero.
   *
   * Percentages go through here rather than through a decimal multiplier, so
   * that a cut of 8.5% is `scaled(85, 1000)` and not `times(0.085)` — the
   * latter reintroduces the floating point this class exists to avoid.
   */
  scaled(numerator: number, denominator: number): Weight {
    return Weight.fromMilligrams(scaleDiv(this.milligrams, numerator, denominator))
  }

  // ── comparison ─────────────────────────────────────────────────────────────

  get isZero(): boolean {
    return this.milligrams === 0
  }

  get isNegative(): boolean {
    return this.milligrams < 0
  }

  get isPositive(): boolean {
    return this.milligrams > 0
  }

  /** Magnitude, for display alongside an explicit "we owe" / "they owe" label. */
  get absolute(): Weight {
    return this.isNegative ? this.negated() : this
  }

  equals(other: Weight): boolean {
    return this.milligrams === other.milligrams
  }

  /** Negative if this is lighter, zero if equal, positive if heavier. */
  compare(other: Weight): number {
    return this.milligrams - other.milligrams
  }

  isGreaterThan(other: Weight): boolean {
    return this.milligrams > other.milligrams
  }

  isLessThan(other: Weight): boolean {
    return this.milligrams < other.milligrams
  }

  static sum(weights: readonly Weight[]): Weight {
    return weights.reduce<Weight>((total, w) => total.plus(w), Weight.ZERO)
  }

  // ── the display edge ───────────────────────────────────────────────────────

  /**
   * Decimal grams as a JavaScript number. **Display and printing only.** Never
   * store this, never do arithmetic on it, and never send it back into a
   * calculation — that is precisely the round trip that loses a milligram.
   */
  toGrams(): number {
    return this.milligrams / 1000
  }

  /**
   * Grams to exactly three decimal places, built by string surgery rather than
   * `toFixed`, so it is exact for every value including negatives.
   *
   * Note this prints a leading minus for negative weights. User-facing balances
   * should not use a bare minus sign — see `describeBalance` in balance.ts,
   * which pairs a magnitude with an explicit "we owe" / "they owe" label.
   */
  format(): string {
    const sign = this.milligrams < 0 ? '-' : ''
    const magnitude = Math.abs(this.milligrams)
    const whole = Math.trunc(magnitude / 1000)
    const fraction = (magnitude % 1000).toString().padStart(3, '0')
    return `${sign}${whole.toLocaleString('en-US')}.${fraction}`
  }

  /** Grams with a unit, for labels and printed slips. */
  formatWithUnit(): string {
    return `${this.format()} g`
  }

  toString(): string {
    return this.formatWithUnit()
  }

  /** Weight crosses the IPC boundary as a plain integer, never as an object. */
  toJSON(): number {
    return this.milligrams
  }
}
