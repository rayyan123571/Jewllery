import {
  Katt,
  Money,
  Weight,
  computePurchaseLine,
  formatInvoiceNo,
  isStockBucket,
  totalsOfPurchase,
  toIsoDate,
  type PublicUser,
  type PurchaseLineInput,
  type StockBucket,
} from '@jewellery/domain'
import type {
  PartyRepository,
  PurchaseLineEntryInput,
  PurchaseService,
  Settings,
} from '@jewellery/application'
import type {
  InvoiceRefDto,
  PurchaseEntryDto,
  PurchaseLineInputDto,
  PurchaseLinePreviewDto,
  PurchaseNeighboursDto,
  PurchasePreviewDto,
  PurchaseSaveResult,
  SavePurchaseRequest,
} from '../shared/ipc.js'
import type { Session } from './session.js'

/**
 * The purchase book, with no Electron anywhere in the file.
 *
 * The same split `retailHandlers.ts` and `wholesaleHandlers.ts` live under:
 * `ipcMain.handle` cannot be called without an Electron process, so a handler
 * written inline in `purchaseIpc.ts` could only be exercised by launching the
 * app — which is how a refusal path ends up untested and then broken. These
 * are plain functions over an injected dependency bag (DECISIONS §9).
 *
 * Two rules every function here keeps:
 *
 *   1. **Nothing throws across the boundary.** A read that cannot answer comes
 *      back as nulls; a write that cannot proceed comes back `{ ok: false }`.
 *   2. **Every figure is preformatted here.** The renderer receives "PUR-12",
 *      never a prefix and an integer to glue together itself.
 */

export interface PurchaseHandlerDeps {
  readonly branchId: string
  readonly purchase: PurchaseService
  readonly parties: PartyRepository
  readonly settings: Settings
  readonly session: Session
}

function requireUser(deps: PurchaseHandlerDeps): PublicUser {
  const user = deps.session.user
  if (!user) throw new Error('No user is signed in.')
  return user
}

/** Turns any thrown error into a message a shopkeeper can act on. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function displayPurchaseNo(deps: PurchaseHandlerDeps, invoiceNumber: number): string {
  return formatInvoiceNo(invoiceNumber, deps.settings.purchaseDisplayPrefix())
}

/** A typed override, or null when the box is empty or not yet a number. */
function overrideOf(raw: string | undefined): Money | null {
  if (raw === undefined || raw.trim() === '') return null
  try {
    const parsed = Money.parse(raw)
    return parsed.isPositive ? parsed : null
  } catch {
    // Half-typed input is normal while someone is still typing.
    return null
  }
}

/** The bucket as typed, or the default. Most purchases are old gold → SCRAP. */
function bucketOf(raw: string): StockBucket {
  return isStockBucket(raw) ? raw : 'SCRAP'
}

/** A row that is genuinely blank contributes nothing — not even an error. */
function isBlank(line: PurchaseLineInputDto): boolean {
  return !line.itemName.trim() && !line.grossGrams.trim()
}

export function purchaseNextInvoiceNo(deps: PurchaseHandlerDeps): string {
  try {
    return displayPurchaseNo(deps, deps.purchase.peekNextNumber())
  } catch {
    return '—'
  }
}

export function purchaseNeighbours(
  deps: PurchaseHandlerDeps,
  current: number | null,
  includeCancelled: boolean,
): PurchaseNeighboursDto {
  const nowhere: PurchaseNeighboursDto = {
    first: null,
    previous: null,
    next: null,
    last: null,
  }
  try {
    requireUser(deps)
    const ref = (n: number | null): InvoiceRefDto | null =>
      n === null ? null : { number: n, display: displayPurchaseNo(deps, n) }

    const found = deps.purchase.neighbours(
      deps.branchId,
      typeof current === 'number' && Number.isSafeInteger(current) ? current : null,
      includeCancelled === true,
    )
    return {
      first: ref(found.first),
      previous: ref(found.previous),
      next: ref(found.next),
      last: ref(found.last),
    }
  } catch {
    return nowhere
  }
}

/**
 * A saved purchase, read back in the shape the SCREEN edits.
 *
 * The stored line keeps the typed figures — gross, katt, the per-line rate —
 * beside the khalis and amount they produced, so a loaded purchase previews to
 * the figures it was saved with, to the milligram.
 *
 * Before answering, the stored figures are recomputed from the STORED katt and
 * rate. If they no longer reproduce, `figuresWarning` carries a plain sentence
 * for the banner — the screen must never silently display either figure.
 */
export function purchaseLoadAsDraft(
  deps: PurchaseHandlerDeps,
  invoiceNumber: number,
): PurchaseEntryDto | null {
  try {
    requireUser(deps)
    if (!Number.isSafeInteger(invoiceNumber) || invoiceNumber <= 0) return null
    const found = deps.purchase.findByNumber(deps.branchId, invoiceNumber)
    if (!found) return null

    const party = deps.parties.findById(found.entry.partyId)
    const lines: PurchaseLineInputDto[] = found.lines.map((line) => ({
      itemName: line.itemName,
      grossGrams: line.gross.format(),
      kattRatti: line.katt.format(),
      rateRupees: line.ratePerTola.format(),
      bucket: line.bucket,
      remarks: line.remarks,
    }))

    const check = deps.purchase.verifyStoredFigures(found)
    const figuresWarning = check.agrees
      ? null
      : `This record was produced by an earlier version of the software. Its stored ` +
        `figures do not reproduce from its own katt and rate` +
        (check.disagreeingLineNos.length > 0
          ? ` (line${check.disagreeingLineNos.length > 1 ? 's' : ''} ` +
            `${check.disagreeingLineNos.join(', ')})`
          : '') +
        `. The stored figures are shown unchanged.`

    return {
      entryId: found.entry.id,
      invoiceNumber: found.entry.invoiceNumber,
      invoiceNo: displayPurchaseNo(deps, found.entry.invoiceNumber),
      status: found.entry.status,
      figuresWarning,
      draft: {
        partyId: found.entry.partyId,
        partyName: party?.name ?? '',
        partyCode: party?.code ?? '',
        entryDate: found.entry.entryDate,
        ratePerTolaOverride: found.entry.ratePerTola.format(),
        lines,
        notes: found.entry.notes,
      },
    }
  } catch {
    return null
  }
}

/**
 * Live preview for the grid as it is typed.
 *
 * Calls the same `computePurchaseLine` and `totalsOfPurchase` the save path
 * runs, so what the operator sees while typing is exactly what will be saved.
 * A row that cannot be parsed yet reports its own error and contributes
 * nothing to the totals — half-typed input is normal, not exceptional.
 */
export function purchasePreview(
  deps: PurchaseHandlerDeps,
  request: SavePurchaseRequest,
): PurchasePreviewDto {
  const date = toIsoDate(request.entryDate)
  const headerRate =
    overrideOf(request.ratePerTolaOverride) ?? deps.purchase.rateFor(deps.branchId, date)

  const parsed: PurchaseLinePreviewDto[] = []
  const valid: PurchaseLineInput[] = []

  for (const line of request.lines) {
    if (isBlank(line)) continue
    try {
      const lineRate = overrideOf(line.rateRupees) ?? headerRate
      if (!lineRate) throw new Error('No gold rate for this date.')
      const input: PurchaseLineInput = {
        itemName: line.itemName.trim(),
        gross: Weight.parse(line.grossGrams || '0'),
        katt: Katt.parse(line.kattRatti || '0'),
        ratePerTola: lineRate,
        bucket: bucketOf(line.bucket),
        remarks: line.remarks,
      }
      const computed = computePurchaseLine(input)
      valid.push(input)
      parsed.push({
        itemName: computed.itemName,
        grossDisplay: computed.gross.format(),
        kattDisplay: computed.katt.format(),
        khalisDisplay: computed.khalis.format(),
        rateDisplay: computed.ratePerTola.formatWhole(),
        amountDisplay: computed.amount.format(),
        purityDisplay: computed.katt.purityPercent(),
        bucket: computed.bucket,
        error: null,
      })
    } catch (error) {
      parsed.push({
        itemName: line.itemName,
        grossDisplay: line.grossGrams,
        kattDisplay: line.kattRatti,
        khalisDisplay: '—',
        rateDisplay: headerRate?.formatWhole() ?? '—',
        amountDisplay: '—',
        purityDisplay: '—',
        bucket: bucketOf(line.bucket),
        error: messageOf(error),
      })
    }
  }

  const totals = totalsOfPurchase(valid.map(computePurchaseLine))
  return {
    lines: parsed,
    grossTotalDisplay: totals.grossTotal.format(),
    khalisTotalDisplay: totals.khalisTotal.format(),
    amountTotalDisplay: totals.amountTotal.format(),
    rateDisplay: headerRate?.formatWhole() ?? null,
    rateMissing: headerRate === null,
  }
}

/** The request's rows, parsed strictly — the save path refuses what the preview tolerates. */
function parsedLines(request: SavePurchaseRequest): PurchaseLineEntryInput[] {
  return request.lines
    .filter((line) => !isBlank(line))
    .map((line) => ({
      itemName: line.itemName,
      gross: Weight.parse(line.grossGrams || '0'),
      katt: Katt.parse(line.kattRatti || '0'),
      ratePerTola: overrideOf(line.rateRupees),
      bucket: bucketOf(line.bucket),
      remarks: line.remarks,
    }))
}

export function purchaseSave(
  deps: PurchaseHandlerDeps,
  request: SavePurchaseRequest,
  status: 'posted' | 'held',
): PurchaseSaveResult {
  try {
    const actor = requireUser(deps)
    const override = overrideOf(request.ratePerTolaOverride)
    const input = {
      branchId: deps.branchId,
      partyId: request.partyId,
      entryDate: toIsoDate(request.entryDate),
      lines: parsedLines(request),
      ...(override ? { ratePerTolaOverride: override } : {}),
      notes: request.notes,
      heldId: request.heldId,
    }
    const result =
      status === 'posted' ? deps.purchase.post(actor, input) : deps.purchase.hold(actor, input)

    return {
      ok: true,
      invoiceNo: displayPurchaseNo(deps, result.posted.entry.invoiceNumber),
      entryId: result.posted.entry.id,
      khalisTotalDisplay: result.posted.entry.totalKhalis.format(),
      amountTotalDisplay: result.posted.entry.totalAmount.format(),
    }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function purchaseCancel(
  deps: PurchaseHandlerDeps,
  entryId: string,
  reason: string,
): { ok: true } | { ok: false; message: string } {
  try {
    deps.purchase.cancel(requireUser(deps), entryId, reason)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

/** The K24 rate in force on a date, for the ENTRY DETAILS refresh control. */
export function purchaseRateFor(
  deps: PurchaseHandlerDeps,
  date: string,
): { display: string; rupees: string } | null {
  try {
    const rate = deps.purchase.rateFor(deps.branchId, toIsoDate(date))
    return rate ? { display: rate.formatWhole(), rupees: rate.format() } : null
  } catch {
    return null
  }
}
