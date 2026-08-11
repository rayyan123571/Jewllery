/**
 * The single rounding rule for the whole system.
 *
 * Division cannot always land on an integer — a percentage of a weight, or a
 * weight valued at a per-gram rate. When it does not, the result rounds
 * **half away from zero**: 0.5 becomes 1, and -0.5 becomes -1.
 *
 * Two reasons this rule and not another:
 *
 *   1. It is the arithmetic a shopkeeper expects at the counter. Banker's
 *      rounding (half-to-even) surprises people, and its bias-reduction
 *      property is irrelevant at a jewellery shop's volumes.
 *   2. It is symmetric about zero. Balances in this system are signed —
 *      positive means the party owes the shop, negative means the shop owes
 *      the party (see docs/DECISIONS.md §4). An asymmetric rule such as
 *      Math.round, which rounds -0.5 to -0 and 0.5 to 1, would round a debt
 *      and a credit of identical size to different magnitudes. Over a year of
 *      entries that is a slow, untraceable leak in one direction.
 *
 * Nothing else in the codebase may call Math.round on a money or weight
 * quantity. Route it through here.
 */

/** Rounds a non-integer to an integer, half away from zero. */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round a non-finite value: ${value}`)
  }
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Exact integer scaling: `(value * numerator) / denominator`, rounded half away
 * from zero.
 *
 * Used for percentages (a cut of 8.5% is `scaleDiv(mg, 85, 1000)`) and for
 * valuation (milligrams at a per-gram rate is `scaleDiv(mg, rate, 1000)`). The
 * multiplication happens before the division so no precision is lost in an
 * intermediate step.
 *
 * The intermediate product is checked against the safe-integer range rather
 * than assumed. For any realistic shop it has three orders of magnitude of
 * headroom (see docs/DECISIONS.md §2), but "realistic" is an assumption and
 * assumptions in a ledger should announce themselves rather than degrade
 * quietly into floating point.
 */
export function scaleDiv(value: number, numerator: number, denominator: number): number {
  assertSafeInteger(value, 'scaleDiv value')
  assertSafeInteger(numerator, 'scaleDiv numerator')
  assertSafeInteger(denominator, 'scaleDiv denominator')
  if (denominator === 0) {
    throw new RangeError('scaleDiv denominator must not be zero')
  }

  const product = value * numerator
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(
      `Intermediate overflow in scaleDiv(${value}, ${numerator}, ${denominator}): ` +
        `the product ${product} exceeds the safe integer range, so the result ` +
        `would silently lose precision.`,
    )
  }

  return roundHalfAwayFromZero(product / denominator)
}

/**
 * Rounds an amount in paisa to the nearest whole `stepRupees` rupees.
 *
 * The one place a total is allowed to leave the paisa. Every other figure in the
 * system — every line, every subtotal, every weight — stays exact, and this is
 * applied ONCE, to the invoice total, at the last step before anything is shown
 * or stored. Rounding earlier and summing afterwards would put the printed
 * column and the printed total a few rupees apart, which is the one arithmetic
 * error a customer checking a slip will always find.
 *
 * **A step of 1 is a no-op, not "round to the nearest rupee".** That is
 * deliberate and it is what the default means: the shop has not chosen a
 * rounding rule, so the total stands exactly as computed, to the paisa. A shop
 * that wants its slips to land on round hundreds sets 100; one that wants round
 * thousands sets 1000. Nothing is invented on their behalf.
 */
export function roundToNearestRupees(paisa: number, stepRupees: number): number {
  assertSafeInteger(paisa, 'roundToNearestRupees paisa')
  if (!Number.isSafeInteger(stepRupees) || stepRupees <= 1) return paisa
  const step = stepRupees * 100
  return roundHalfAwayFromZero(paisa / step) * step
}

/**
 * Guards the assumption the whole integer-storage decision rests on. Called on
 * every construction and every arithmetic result in Weight and Money, so a
 * violation throws at the point it happens rather than surfacing months later
 * as a ledger that does not balance.
 */
export function assertSafeInteger(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${what} must be a finite number, received ${String(value)}`)
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `${what} must be an integer, received ${value}. Money is stored in paisa ` +
        `and weight in milligrams — a fractional value here means a decimal ` +
        `leaked past the UI edge. See docs/DECISIONS.md §2.`,
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${what} (${value}) is outside the safe integer range, so arithmetic on ` +
        `it would silently lose precision.`,
    )
  }
}
