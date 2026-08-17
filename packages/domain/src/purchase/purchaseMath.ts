import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { amountOf, khalisOf } from '../wholesale/lineMath.js'
import type { Katt } from '../wholesale/Katt.js'
import type { PurchaseEntryWithLines } from './PurchaseEntry.js'
import type { StockBucket } from '../stock/StockLedger.js'

/**
 * The purchase line computations.
 *
 * A purchase line's katt means exactly what a wholesale line's katt means — a
 * deduction quoted in ratti per tola on the 96-ratti scale — so the same two
 * functions do the arithmetic (`khalisOf`, `amountOf`) rather than a second
 * purity formula that could drift from the first:
 *
 *   khalis_mg    = gross_mg × (96000 − katt_milliRatti) / 96000
 *   amount_paisa = khalis_mg × rate_paisa_per_tola / 11664
 *
 * All integer arithmetic, rounded half-away-from-zero once per figure. The
 * amount is computed from the stored, rounded khalis, and totals are sums of
 * the per-line rounded figures, so the printed column adds up.
 */

export interface PurchaseLineInput {
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  /** The rate this line is priced at. Defaults from the header, editable per line. */
  readonly ratePerTola: Money
  readonly bucket: StockBucket
  readonly remarks: string | null
}

export interface PurchaseLineComputed extends PurchaseLineInput {
  readonly khalis: Weight
  readonly amount: Money
}

export function computePurchaseLine(line: PurchaseLineInput): PurchaseLineComputed {
  const khalis = khalisOf(line.gross, line.katt)
  return { ...line, khalis, amount: amountOf(khalis, line.ratePerTola) }
}

export interface PurchaseTotals {
  readonly grossTotal: Weight
  readonly khalisTotal: Weight
  readonly amountTotal: Money
}

export function totalsOfPurchase(lines: readonly PurchaseLineComputed[]): PurchaseTotals {
  return {
    grossTotal: Weight.sum(lines.map((line) => line.gross)),
    khalisTotal: Weight.sum(lines.map((line) => line.khalis)),
    amountTotal: Money.sum(lines.map((line) => line.amount)),
  }
}

/**
 * A stored purchase, checked against its own arithmetic.
 *
 * Reopening a posted purchase recomputes khalis and amount from the STORED
 * katt and rate and asserts they match the stored figures. If they differ by
 * more than a milligram or a paisa, the record was produced by an earlier
 * version of the arithmetic — the screen must say so plainly rather than
 * silently displaying either figure.
 */
export interface StoredFigureCheck {
  readonly agrees: boolean
  /** Line numbers whose stored khalis or amount no longer reproduces. */
  readonly disagreeingLineNos: readonly number[]
  readonly totalsAgree: boolean
}

const KHALIS_TOLERANCE_MG = 1
const AMOUNT_TOLERANCE_PAISA = 1

export function checkStoredFigures(purchase: PurchaseEntryWithLines): StoredFigureCheck {
  const disagreeingLineNos: number[] = []

  for (const line of purchase.lines) {
    const khalis = khalisOf(line.gross, line.katt)
    const amount = amountOf(khalis, line.ratePerTola)
    const khalisOff =
      Math.abs(khalis.milligrams - line.khalis.milligrams) > KHALIS_TOLERANCE_MG
    const amountOff = Math.abs(amount.paisa - line.amount.paisa) > AMOUNT_TOLERANCE_PAISA
    if (khalisOff || amountOff) disagreeingLineNos.push(line.lineNo)
  }

  const summed = totalsOfPurchase(purchase.lines)
  const totalsAgree =
    Math.abs(summed.grossTotal.milligrams - purchase.entry.totalGross.milligrams) <=
      KHALIS_TOLERANCE_MG &&
    Math.abs(summed.khalisTotal.milligrams - purchase.entry.totalKhalis.milligrams) <=
      KHALIS_TOLERANCE_MG &&
    Math.abs(summed.amountTotal.paisa - purchase.entry.totalAmount.paisa) <=
      AMOUNT_TOLERANCE_PAISA

  return {
    agrees: disagreeingLineNos.length === 0 && totalsAgree,
    disagreeingLineNos,
    totalsAgree,
  }
}
