import { formatInvoiceNo } from '@jewellery/domain'
import type { PublicUser } from '@jewellery/domain'
import type { PartyRepository, Settings, WholesaleService } from '@jewellery/application'
import type {
  InvoiceRefDto,
  LineInputDto,
  WholesaleEntryDto,
  WholesaleNeighboursDto,
} from '../shared/ipc.js'
import type { Session } from './session.js'

/**
 * Walking the wholesale slip book, with no Electron anywhere in the file.
 *
 * The same split `retailHandlers.ts` lives under, for the same reason:
 * `ipcMain.handle` cannot be called without an Electron process, so a handler
 * written inline in `wholesaleIpc.ts` can only be exercised by launching the
 * app — which is how a refusal path ends up untested and then broken. These are
 * plain functions over an injected dependency bag (DECISIONS §9).
 *
 * Two rules every function here keeps:
 *
 *   1. **Nothing throws across the boundary.** A read that cannot answer comes
 *      back as four nulls or a null slip, which renders as disabled arrows
 *      rather than as a rejected promise carrying a stack trace.
 *   2. **Every number is preformatted here.** The renderer receives "WS-10002",
 *      never a prefix and an integer to glue together itself.
 */

export interface WholesaleNavDeps {
  readonly branchId: string
  readonly wholesale: WholesaleService
  readonly parties: PartyRepository
  readonly settings: Settings
  readonly session: Session
}

function requireUser(deps: WholesaleNavDeps): PublicUser {
  const user = deps.session.user
  if (!user) throw new Error('No user is signed in.')
  return user
}

/**
 * The slip number as the shop shows it.
 *
 * Every place a number reaches a person goes through here — the toolbar, the
 * record strip, the save message, the ledger and the printed slip. That is the
 * point: a prefix applied in five places is a prefix that will one day be
 * applied in four.
 */
export function displayInvoiceNo(deps: WholesaleNavDeps, invoiceNumber: number): string {
  return formatInvoiceNo(invoiceNumber, deps.settings.wholesaleDisplayPrefix())
}

export function wholesaleNeighbours(
  deps: WholesaleNavDeps,
  current: number | null,
  includeReversed: boolean,
): WholesaleNeighboursDto {
  const nowhere: WholesaleNeighboursDto = {
    first: null,
    previous: null,
    next: null,
    last: null,
  }
  try {
    requireUser(deps)
    const ref = (n: number | null): InvoiceRefDto | null =>
      n === null ? null : { number: n, display: displayInvoiceNo(deps, n) }

    const found = deps.wholesale.neighbours(
      deps.branchId,
      typeof current === 'number' && Number.isSafeInteger(current) ? current : null,
      includeReversed === true,
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
 * A posted slip, read back in the shape the SCREEN edits.
 *
 * The inverse of the parse the post path does, and it is exact rather than
 * approximate because the stored line keeps the two typed figures — `gross_mg`
 * and `katt_milli_ratti` — beside the khalis and the amount they produced. So a
 * loaded slip previews to the figures it was posted with, to the milligram.
 *
 * The rate is pinned as an override for the same reason the retail loader pins
 * one: a slip priced last Tuesday must not reprice itself at today's rate the
 * moment somebody opens it to look at.
 */
export function wholesaleLoadAsDraft(
  deps: WholesaleNavDeps,
  invoiceNumber: number,
): WholesaleEntryDto | null {
  try {
    requireUser(deps)
    if (!Number.isSafeInteger(invoiceNumber) || invoiceNumber <= 0) return null
    const found = deps.wholesale.findByNumber(deps.branchId, invoiceNumber)
    if (!found) return null

    const party = deps.parties.findById(found.entry.partyId)
    // The two TYPED figures, back as the operator typed them. Everything else
    // on the row — khalis, the line amount — is derived from these, so nothing
    // has to be worked backwards out of a result.
    const lines: LineInputDto[] = found.lines.map((line) => ({
      itemName: line.itemName,
      grossGrams: line.gross.format(),
      kattRatti: line.katt.format(),
      remarks: line.remarks,
    }))

    return {
      entryId: found.entry.id,
      invoiceNumber: found.entry.invoiceNumber,
      invoiceNo: displayInvoiceNo(deps, found.entry.invoiceNumber),
      kind: found.entry.kind,
      isReversed: found.entry.reversedByEntryId !== null,
      draft: {
        partyId: found.entry.partyId,
        partyName: party?.name ?? '',
        partyCode: party?.code ?? '',
        entryDate: found.entry.entryDate,
        ratePerTolaOverride: found.entry.ratePerTola?.format() ?? '',
        lines,
        notes: found.entry.notes,
      },
    }
  } catch {
    return null
  }
}

/** A PREVIEW of the next slip number. Reserves nothing. */
export function wholesaleNextInvoiceNo(deps: WholesaleNavDeps): string {
  try {
    return displayInvoiceNo(deps, deps.wholesale.peekNextNumber())
  } catch {
    return '—'
  }
}
