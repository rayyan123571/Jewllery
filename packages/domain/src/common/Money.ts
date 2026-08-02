import { assertSafeInteger, scaleDiv } from './rounding.js'
import type { Weight } from './Weight.js'

/**
 * An amount of money, stored as an exact integer number of **paisa**.
 *
 * The same reasoning as `Weight`: no floating point anywhere, decimals only at
 * the edges. Rupees exist when a number is typed and when one is shown.
 *
 * Money is **signed**, on the same convention as everything else in the system
 * (docs/DECISIONS.md §4): positive means the party owes the shop, negative
 * means the shop owes the party. The gold ledger and the cash ledger are
 * separate and are never netted against each other — a party can owe gold while
 * the shop owes them cash, and collapsing that into one number destroys
 * information the shopkeeper needs.
 *
 * Instances are immutable.
 */
export class Money {
  /** Paisa. Always an exact, safe integer. May be negative. */
  readonly paisa: number

  private constructor(paisa: number) {
    assertSafeInteger(paisa, 'Money in paisa')
    this.paisa = paisa
    Object.freeze(this)
  }

  static readonly ZERO = new Money(0)

  /** The canonical constructor. This is what comes out of the database. */
  static fromPaisa(paisa: number): Money {
    return paisa === 0 ? Money.ZERO : new Money(paisa)
  }

  /**
   * Parses a typed rupee string exactly, with no floating point in the path.
   * Thousands separators are accepted because people type them.
   */
  static parse(input: string): Money {
    const trimmed = input.trim().replace(/,/g, '').replace(/^Rs\.?\s*/i, '')
    if (trimmed === '') {
      throw new TypeError('Money cannot be parsed from an empty string')
    }

    const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed)
    if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
      throw new TypeError(
        `"${input}" is not a valid amount. Expected rupees, for example "9,400.00".`,
      )
    }

    const sign = match[1] === '-' ? -1 : 1
    const wholeRupees = match[2] === '' ? '0' : (match[2] as string)
    const fraction = match[3] ?? ''

    if (fraction.length > 2) {
      throw new RangeError(
        `"${input}" has more precision than a paisa. Money is recorded to two ` +
          `decimal places.`,
      )
    }

    const paisaDigits = fraction.padEnd(2, '0')
    const paisa = Number(wholeRupees) * 100 + Number(paisaDigits)
    return Money.fromPaisa(sign * paisa)
  }

  /**
   * Builds Money from a decimal-rupee JavaScript number. Prefer `parse` for
   * anything a user typed; use this for literals in tests and seed data.
   */
  static fromRupees(rupees: number): Money {
    if (!Number.isFinite(rupees)) {
      throw new TypeError(`Money in rupees must be finite, received ${String(rupees)}`)
    }
    return Money.fromPaisa(scaleDiv(Math.trunc(rupees * 1e6), 1, 10_000))
  }

  // ── arithmetic ─────────────────────────────────────────────────────────────

  plus(other: Money): Money {
    return Money.fromPaisa(this.paisa + other.paisa)
  }

  minus(other: Money): Money {
    return Money.fromPaisa(this.paisa - other.paisa)
  }

  negated(): Money {
    return Money.fromPaisa(-this.paisa)
  }

  timesInteger(factor: number): Money {
    assertSafeInteger(factor, 'Money multiplier')
    return Money.fromPaisa(this.paisa * factor)
  }

  /** Exact rational scaling, rounded half away from zero. */
  scaled(numerator: number, denominator: number): Money {
    return Money.fromPaisa(scaleDiv(this.paisa, numerator, denominator))
  }

  // ── comparison ─────────────────────────────────────────────────────────────

  get isZero(): boolean {
    return this.paisa === 0
  }

  get isNegative(): boolean {
    return this.paisa < 0
  }

  get isPositive(): boolean {
    return this.paisa > 0
  }

  get absolute(): Money {
    return this.isNegative ? this.negated() : this
  }

  equals(other: Money): boolean {
    return this.paisa === other.paisa
  }

  compare(other: Money): number {
    return this.paisa - other.paisa
  }

  isGreaterThan(other: Money): boolean {
    return this.paisa > other.paisa
  }

  isLessThan(other: Money): boolean {
    return this.paisa < other.paisa
  }

  static sum(amounts: readonly Money[]): Money {
    return amounts.reduce<Money>((total, m) => total.plus(m), Money.ZERO)
  }

  // ── valuation ──────────────────────────────────────────────────────────────

  /**
   * Values a weight of gold at a per-gram rate.
   *
   *   paisa = milligrams x ratePerGramInPaisa / 1000
   *
   * The multiplication happens before the division, so no precision is lost in
   * the middle, and the result is rounded half away from zero exactly once.
   * `scaleDiv` checks the intermediate product against the safe integer range,
   * so an implausibly large valuation throws rather than quietly degrading.
   */
  static valueOf(weight: Weight, ratePerGram: Money): Money {
    return Money.fromPaisa(scaleDiv(weight.milligrams, ratePerGram.paisa, 1000))
  }

  // ── the display edge ───────────────────────────────────────────────────────

  /** Decimal rupees as a number. **Display only** — never store, never compute. */
  toRupees(): number {
    return this.paisa / 100
  }

  /**
   * Rupees with thousands separators and exactly two decimal places, built by
   * string surgery so it is exact for negatives too.
   *
   * Prints a leading minus. User-facing balances should use `describeBalance`
   * in balance.ts instead, which pairs a magnitude with an explicit label.
   */
  format(): string {
    const sign = this.paisa < 0 ? '-' : ''
    const magnitude = Math.abs(this.paisa)
    const whole = Math.trunc(magnitude / 100)
    const fraction = (magnitude % 100).toString().padStart(2, '0')
    return `${sign}${whole.toLocaleString('en-US')}.${fraction}`
  }

  /**
   * Whole rupees, no decimal part, rounded half away from zero. Printed slips
   * are narrow and shops quote round figures; the stored value is untouched.
   */
  formatWhole(): string {
    const sign = this.paisa < 0 ? '-' : ''
    const rupees = Math.abs(scaleDiv(this.paisa, 1, 100))
    return `${sign}${rupees.toLocaleString('en-US')}`
  }

  formatWithSymbol(): string {
    return `Rs ${this.format()}`
  }

  toString(): string {
    return this.formatWithSymbol()
  }

  /** Money crosses the IPC boundary as a plain integer, never as an object. */
  toJSON(): number {
    return this.paisa
  }
}
