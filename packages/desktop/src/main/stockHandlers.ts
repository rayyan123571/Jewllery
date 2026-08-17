import {
  Katt,
  Weight,
  formatInvoiceNo,
  isStockBucket,
  isStockMovementKind,
  toIsoDate,
  type PublicUser,
  type StockMovement,
} from '@jewellery/domain'
import type {
  PurchaseRepository,
  Settings,
  StockLedgerRow,
  StockMovementFilter,
  StockService,
} from '@jewellery/application'
import type {
  StockAdjustRequest,
  StockAdjustResult,
  StockLedgerRequest,
  StockLedgerRowDto,
  StockSummaryDto,
} from '../shared/ipc.js'
import type { Session } from './session.js'

/**
 * Reading and correcting stock, with no Electron anywhere in the file.
 *
 * Same rules as the purchase handlers: nothing throws across the boundary, and
 * every figure crosses preformatted. One rule is this file's own: every weight
 * leaves here as a MAGNITUDE plus a direction or a flag. The shell forbids a
 * bare minus sign in front of a figure anywhere on screen (DECISIONS §4), so a
 * negative bucket says "isNegative", never "-3.120".
 */

export interface StockHandlerDeps {
  readonly branchId: string
  readonly stock: StockService
  readonly purchases: PurchaseRepository
  readonly settings: Settings
  readonly session: Session
}

function requireUser(deps: StockHandlerDeps): PublicUser {
  const user = deps.session.user
  if (!user) throw new Error('No user is signed in.')
  return user
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** "2026-08-15 14:05" — the moment, without the milliseconds. */
function atDisplayOf(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 16)}`
}

const EMPTY_SUMMARY: StockSummaryDto = {
  buckets: [],
  totalGrossDisplay: '0.000',
  totalKhalisDisplay: '0.000',
  totalIsNegative: false,
  negativeBuckets: [],
  valuationDisplay: null,
  valuationRateDisplay: null,
  valuationAtDisplay: '',
}

export function stockSummary(deps: StockHandlerDeps): StockSummaryDto {
  try {
    requireUser(deps)
    const summary = deps.stock.summary(deps.branchId)
    return {
      buckets: summary.buckets.map((b) => ({
        bucket: b.bucket,
        grossDisplay: b.gross.absolute.format(),
        khalisDisplay: b.khalis.absolute.format(),
        isNegative: b.isNegative,
      })),
      totalGrossDisplay: summary.totalGross.absolute.format(),
      totalKhalisDisplay: summary.totalKhalis.absolute.format(),
      totalIsNegative: summary.totalGross.isNegative || summary.totalKhalis.isNegative,
      negativeBuckets: summary.negativeBuckets,
      valuationDisplay: summary.valuation ? `Rs ${summary.valuation.formatWhole()}` : null,
      valuationRateDisplay: summary.valuationRatePerTola
        ? `Rs ${summary.valuationRatePerTola.formatWhole()} / tola (24K)`
        : null,
      valuationAtDisplay: atDisplayOf(summary.valuationAt),
    }
  } catch {
    return EMPTY_SUMMARY
  }
}

/**
 * The ledger, newest first, each row carrying the balance the whole book stood
 * at after it. References to purchases carry the book's own display number so
 * the screen can open the source document.
 */
export function stockLedger(
  deps: StockHandlerDeps,
  request: StockLedgerRequest,
): StockLedgerRowDto[] {
  try {
    requireUser(deps)

    const filter: StockMovementFilter = {
      branchId: deps.branchId,
      ...(request.fromDate?.trim() ? { fromDate: toIsoDate(request.fromDate) } : {}),
      ...(request.toDate?.trim() ? { toDate: toIsoDate(request.toDate) } : {}),
      ...(request.bucket && isStockBucket(request.bucket) ? { bucket: request.bucket } : {}),
      ...(request.kind && isStockMovementKind(request.kind) ? { kind: request.kind } : {}),
    }

    // Purchase ids resolve to invoice numbers once per document, not per row.
    const refNumbers = new Map<string, number | null>()
    const refNumberOf = (movement: StockMovement): number | null => {
      if (movement.refType !== 'purchase' || !movement.refId) return null
      if (!refNumbers.has(movement.refId)) {
        refNumbers.set(
          movement.refId,
          deps.purchases.findById(movement.refId)?.entry.invoiceNumber ?? null,
        )
      }
      return refNumbers.get(movement.refId) ?? null
    }

    return deps.stock.ledger(filter).map((row: StockLedgerRow): StockLedgerRowDto => {
      const m = row.movement
      const refNumber = refNumberOf(m)
      return {
        id: m.id,
        date: m.at.slice(0, 10),
        atDisplay: atDisplayOf(m.at),
        kind: m.kind,
        bucket: m.bucket,
        itemName: m.itemName,
        direction: m.gross.isNegative || m.khalis.isNegative ? 'out' : 'in',
        grossDisplay: m.gross.absolute.format(),
        khalisDisplay: m.khalis.absolute.format(),
        kattDisplay: m.katt?.format() ?? null,
        note: m.note,
        refDisplay:
          refNumber !== null
            ? formatInvoiceNo(refNumber, deps.settings.purchaseDisplayPrefix())
            : null,
        refType: m.refType,
        refInvoiceNumber: refNumber,
        runningGrossDisplay: row.runningGross.absolute.format(),
        runningKhalisDisplay: row.runningKhalis.absolute.format(),
        runningIsNegative: row.runningGross.isNegative || row.runningKhalis.isNegative,
      }
    })
  } catch {
    return []
  }
}

/**
 * A manual correction. The khalis is derived from the typed gross and katt by
 * the same arithmetic every purchase line uses; direction turns the magnitudes
 * negative for a count that found LESS than the books.
 */
export function stockAdjust(
  deps: StockHandlerDeps,
  request: StockAdjustRequest,
): StockAdjustResult {
  try {
    const actor = requireUser(deps)
    if (!isStockBucket(request.bucket)) {
      return { ok: false, message: 'Choose a bucket.' }
    }

    const gross = Weight.parse(request.grossGrams || '0')
    const katt = Katt.parse(request.kattRatti.trim() || '0')
    const khalis = deps.stock.khalisFor(gross, katt)
    const sign = request.direction === 'remove' ? -1 : 1

    const movement = deps.stock.adjust(actor, {
      branchId: deps.branchId,
      bucket: request.bucket,
      gross: sign === -1 ? gross.negated() : gross,
      khalis: sign === -1 ? khalis.negated() : khalis,
      katt: request.kattRatti.trim() ? katt : null,
      itemName: request.itemName?.trim() ? request.itemName.trim() : null,
      reason: request.reason,
    })

    return { ok: true, khalisDisplay: movement.khalis.absolute.format() }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}
