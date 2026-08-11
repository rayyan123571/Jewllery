import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { scaleDiv } from '../common/rounding.js'
import { TOLA_IN_MG } from '../common/tola.js'
import type { LabourMode } from './RetailSale.js'

/**
 * The retail sale arithmetic, and nothing else.
 *
 * Pure: no database, no clock, no settings lookup. The wastage RULE arrives as
 * an argument rather than being read here, because which rule applies is a
 * business decision the shop makes (see SETTING_KEYS.retailWastage*) and this
 * file's job is only to apply whichever one it is given. That is what makes all
 * four combinations testable with no window and no database.
 *
 * ── Why every step is integer ──────────────────────────────────────────────
 * Weight is milligrams, money is paisa, and the wastage percentage is basis
 * points — 14.00% is 1400, never 0.14. A single float in this chain would put
 * every invoice a fraction out in a way that never happened in any one place
 * and therefore cannot be found. `scaleDiv` multiplies before it divides and
 * rounds half away from zero exactly once per step.
 *
 * The one rounding rule that matters for the sum-to-the-paisa guarantee: a line
 * amount is rounded to the paisa, and the invoice total is the SUM OF THE
 * ROUNDED LINES — not a re-computation from the totals. Re-deriving the total
 * from summed weights would disagree with the printed lines by a paisa or two,
 * and a customer adding up the column on the slip would be right and the shop
 * would be wrong.
 */

/** 100% in basis points. 14.00% is 1400. */
export const BASIS_POINTS = 10_000

export type WastageDirection = 'add' | 'subtract'
export type WastageBasis = 'gross' | 'net'

export interface WastageRule {
  readonly direction: WastageDirection
  readonly basis: WastageBasis
}

export interface RetailLineInput {
  readonly itemName: string
  readonly grossWeight: Weight
  readonly stoneWeight: Weight
  /** Deduction quoted per tola of gross weight. */
  readonly cutPerTola: Weight
  readonly wastageBp: number
  /** Fixed amount, or an amount per tola of fine weight — see labourMode. */
  readonly labourCharges: Money
  readonly labourMode: LabourMode
  readonly stoneCharges: Money
  readonly ratePerTola: Money
}

export interface RetailLineComputed extends RetailLineInput {
  readonly netWeight: Weight
  readonly wastage: Weight
  readonly fineWeight: Weight
  /** The metal portion alone, before labour and stone. */
  readonly goldValue: Money
  /** Resolved from labourMode: this is the figure that is actually charged. */
  readonly labourAmount: Money
  readonly lineAmount: Money
}

/**
 * One line, from typed weights to a rounded amount.
 *
 * The cut is quoted per tola of GROSS, so the deduction scales with the piece:
 * a 0.570 cut on 4.050 tola removes 0.570 × 4.050 tola-worth of metal, not a
 * flat 0.570.
 */
export function computeRetailLine(
  input: RetailLineInput,
  rule: WastageRule,
): RetailLineComputed {
  const cutDeduction = Weight.fromMilligrams(
    scaleDiv(input.cutPerTola.milligrams, input.grossWeight.milligrams, TOLA_IN_MG),
  )

  const netWeight = input.grossWeight.minus(input.stoneWeight).minus(cutDeduction)

  const base = rule.basis === 'gross' ? input.grossWeight : netWeight
  const wastage = Weight.fromMilligrams(
    scaleDiv(base.milligrams, input.wastageBp, BASIS_POINTS),
  )

  const fineWeight =
    rule.direction === 'add' ? netWeight.plus(wastage) : netWeight.minus(wastage)

  const goldValue = Money.valueOfAtTolaRate(fineWeight, input.ratePerTola)

  // Per-tola labour is charged on the FINE weight, because that is the metal
  // the customer is being billed for; charging it on gross would bill labour on
  // stones the goldsmith never worked.
  const labourAmount =
    input.labourMode === 'per_tola'
      ? Money.fromPaisa(
          scaleDiv(input.labourCharges.paisa, fineWeight.milligrams, TOLA_IN_MG),
        )
      : input.labourCharges

  const lineAmount = goldValue.plus(labourAmount).plus(input.stoneCharges)

  return {
    ...input,
    netWeight,
    wastage,
    fineWeight,
    goldValue,
    labourAmount,
    lineAmount,
  }
}

export interface RetailTotals {
  readonly totalFine: Weight
  readonly goldValue: Money
  readonly totalLabour: Money
  readonly totalStone: Money
  /** The sum of the ROUNDED line amounts. See the note at the top of the file. */
  readonly itemsTotal: Money
}

export function totalsOfRetail(lines: readonly RetailLineComputed[]): RetailTotals {
  let totalFine = Weight.ZERO
  let goldValue = Money.ZERO
  let totalLabour = Money.ZERO
  let totalStone = Money.ZERO
  let itemsTotal = Money.ZERO

  for (const line of lines) {
    totalFine = totalFine.plus(line.fineWeight)
    goldValue = goldValue.plus(line.goldValue)
    totalLabour = totalLabour.plus(line.labourAmount)
    totalStone = totalStone.plus(line.stoneCharges)
    itemsTotal = itemsTotal.plus(line.lineAmount)
  }

  return { totalFine, goldValue, totalLabour, totalStone, itemsTotal }
}

export interface InvoiceChargeInput {
  readonly totals: RetailTotals
  readonly customerGold: Weight
  /** The rate for the customer's OWN metal, which need not match the sale's. */
  readonly customerGoldRatePerTola: Money | null
  readonly hallmarkCharges: Money
  readonly otherCharges: Money
  readonly discount: Money
  readonly amountPaid: Money
}

export interface InvoiceComputed {
  readonly customerGoldValue: Money
  readonly grandTotal: Money
  readonly balance: Money
  /** Fine sold, less what the customer brought in. Can be negative. */
  readonly remainingGold: Weight
}

/**
 * The invoice, from line totals to what is owed.
 *
 * Old gold the customer brings in is valued at the rate for ITS OWN purity, not
 * the sale's — a customer trading 21K against a 22K purchase is not giving 22K
 * metal, and valuing it as though they were would quietly overpay them.
 */
export function computeRetailInvoice(input: InvoiceChargeInput): InvoiceComputed {
  const customerGoldValue =
    input.customerGoldRatePerTola === null || input.customerGold.isZero
      ? Money.ZERO
      : Money.valueOfAtTolaRate(input.customerGold, input.customerGoldRatePerTola)

  const grandTotal = input.totals.itemsTotal
    .plus(input.hallmarkCharges)
    .plus(input.otherCharges)
    .minus(input.discount)
    .minus(customerGoldValue)

  return {
    customerGoldValue,
    grandTotal,
    balance: grandTotal.minus(input.amountPaid),
    remainingGold: input.totals.totalFine.minus(input.customerGold),
  }
}
