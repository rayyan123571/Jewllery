import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { MILLI_RATTI_PER_TOLA } from '../common/units.js'
import type { Katt } from './Katt.js'

/**
 * The two calculations a wholesale line performs, and the only two.
 *
 * Both are taken from the real slip (docs/wholesale-receipt.jpg) and confirmed
 * against the working reference engine, not from the original mockup — which
 * modelled the cut as a *weight* subtracted from the gross, and was wrong.
 *
 *     khalis_mg    = gross_mg × (96000 − katt_milliRatti) / 96000
 *     amount_paisa = khalis_mg × rate_paisa_per_tola / 11664
 *
 * Each goes through `scaleDiv`, so each multiplies before dividing and rounds
 * half away from zero **exactly once**. There are two rounding points because
 * there are two quantities — a weight and an amount — and each is hit once.
 *
 * The amount is computed from the **stored, rounded** khalis rather than from an
 * unrounded intermediate. That is deliberate: the milligram figure is what the
 * ledger carries and what the slip prints, so the amount must correspond to it,
 * and a shopkeeper holding the paper can re-add it with a calculator. The cost
 * is at most half a milligram of valuation per line; the benefit is that the
 * printed figures agree with each other. See DECISIONS §2.
 */

/** Khalis (pure) weight from gross weight and katt. */
export function khalisOf(gross: Weight, katt: Katt): Weight {
  return gross.scaled(MILLI_RATTI_PER_TOLA - katt.milliRatti, MILLI_RATTI_PER_TOLA)
}

/** The amount a khalis weight is worth at a per-tola rate. */
export function amountOf(khalis: Weight, ratePerTola: Money): Money {
  return Money.valueOfAtTolaRate(khalis, ratePerTola)
}

/**
 * One line of a wholesale entry, as the grid shows it.
 *
 * Note what is NOT here: the purity. A karat is a way of CHOOSING a rate, and
 * by the time a line reaches this file that choice has been made and resolved
 * to `ratePerTola` one layer up, in the service. The same rule retail follows —
 * `RetailLineInput` carries no purity either — and it is what keeps this file
 * pure arithmetic over weights and money.
 */
export interface WholesaleLineInput {
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  readonly ratePerTola: Money
  readonly remarks: string | null
  /** Carried for the stored row, never used in a calculation here. */
  readonly purity?: string
  /** The shop's second free-text note. Never calculated with. */
  readonly male?: string | null
}

export interface WholesaleLineComputed extends WholesaleLineInput {
  readonly khalis: Weight
  readonly amount: Money
}

/** Fills in the two derived columns. Pure — no repository, no clock, no window. */
export function computeLine(line: WholesaleLineInput): WholesaleLineComputed {
  const khalis = khalisOf(line.gross, line.katt)
  return { ...line, khalis, amount: amountOf(khalis, line.ratePerTola) }
}

export interface WholesaleTotals {
  /** The slip's first bracketed total — ( 271.510 ). */
  readonly grossTotal: Weight
  /** The slip's second bracketed total — ( 234.853 ). */
  readonly khalisTotal: Weight
  readonly amountTotal: Money
}

/**
 * Totals across the lines.
 *
 * Sums the per-line rounded figures, not a re-derivation from the raw inputs, so
 * the printed total is exactly the sum of the printed rows. On the real slip
 * both approaches agree; when they would not, the one that lets the reader add
 * the column up is the correct one.
 */
export function totalsOf(lines: readonly WholesaleLineComputed[]): WholesaleTotals {
  return {
    grossTotal: Weight.sum(lines.map((l) => l.gross)),
    khalisTotal: Weight.sum(lines.map((l) => l.khalis)),
    amountTotal: Money.sum(lines.map((l) => l.amount)),
  }
}
