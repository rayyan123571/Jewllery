import { ipcMain } from 'electron'
import {
  Katt,
  Money,
  PURITIES,
  Weight,
  computeLine,
  describeBalance,
  formatPurity,
  parsePurity,
  toIsoDate,
  totalsOf,
  type DescribedBalance,
  type Party,
  type PublicUser,
  type WholesaleLineInput,
} from '@jewellery/domain'
import { OverReturnRequiresConfirmationError, Settings } from '@jewellery/application'
import {
  IPC_M2,
  type BalanceDto,
  type LedgerRowDto,
  type LinePreviewDto,
  type NewPartyDto,
  type PartyBalanceDto,
  type PartyDto,
  type PostIssueRequest,
  type PostResult,
  type PreviewDto,
  type RateHistoryDto,
  type SetRateRequest,
  type SettleRequest,
} from '../shared/ipc.js'
import type { Container } from './container.js'
import type { Session } from './ipc.js'
import {
  displayInvoiceNo,
  wholesaleLoadAsDraft,
  wholesaleNeighbours,
  wholesaleNextInvoiceNo,
  type WholesaleNavDeps,
} from './wholesaleHandlers.js'

/**
 * Handlers for parties and wholesale.
 *
 * Every figure the renderer receives is **preformatted here**, by the same
 * domain code that formats the printed slip. The renderer cannot import the
 * application layer and does no money arithmetic of its own, so the screen and
 * the paper cannot drift apart.
 *
 * Balances cross as `BalanceDto`, which carries the label-bearing text rather
 * than a bare number — there is no way for a screen to accidentally render a
 * minus sign, because it is never handed one (DECISIONS §4).
 */

/**
 * CR/DR as the old slip prints them, mapped onto our sign convention.
 *
 * The slip's convention is the opposite of ours: it shows a credit as positive
 * and subtracts an issue. Ours is positive = the party owes the shop. So:
 *
 *   party owes the shop  →  DR (debit)
 *   shop owes the party  →  CR (credit)
 *
 * Shown alongside the plain-words label so the paper still reads familiarly.
 */
function drCrOf(described: DescribedBalance): string {
  switch (described.direction) {
    case 'party-owes-shop':
      return 'DR'
    case 'shop-owes-party':
      return 'CR'
    case 'settled':
      return ''
  }
}

function balanceDto(value: Weight | Money): BalanceDto {
  const described = describeBalance(value)
  return {
    milligramsOrPaisa: value instanceof Weight ? value.milligrams : value.paisa,
    text: described.text,
    direction: described.direction,
    drCr: drCrOf(described),
  }
}

function partyDto(party: Party): PartyDto {
  return {
    id: party.id,
    code: party.code,
    name: party.name,
    mobile: party.mobile,
    city: party.city,
  }
}

/** Turns any thrown error into a message a shopkeeper can act on. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function registerWholesaleHandlers(container: Container, session: Session): void {
  const requireUser = (): PublicUser => {
    if (!session.user) throw new Error('Sign in first.')
    return session.user
  }

  /** The bag the navigation handlers take. No Electron, so they are testable. */
  const navDeps: WholesaleNavDeps = {
    branchId: container.branchId,
    wholesale: container.wholesale,
    parties: container.repositories.parties,
    settings: new Settings(container.repositories.settings),
    session,
  }

  // ── parties ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_M2.partySearch, (_e, query: string): PartyDto[] =>
    container.parties.search(container.branchId, query).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      mobile: r.mobile,
      city: r.city,
    })),
  )

  ipcMain.handle(IPC_M2.partyCreate, (_e, input: NewPartyDto) => {
    try {
      const party = container.parties.create(requireUser(), {
        branchId: container.branchId,
        code: input.code,
        name: input.name,
        mobile: input.mobile,
        city: input.city,
        // Parsed here, at the edge, from the string the user typed — never
        // multiplied from a float.
        openingGold: input.openingGoldGrams.trim()
          ? Weight.parse(input.openingGoldGrams)
          : Weight.ZERO,
        openingCash: input.openingCashRupees.trim()
          ? Money.parse(input.openingCashRupees)
          : Money.ZERO,
        notes: null,
      })
      return { ok: true as const, party: partyDto(party) }
    } catch (error) {
      return { ok: false as const, message: messageOf(error) }
    }
  })

  ipcMain.handle(IPC_M2.partyGet, (_e, partyId: string): PartyBalanceDto | null => {
    const party = container.parties.findById(partyId)
    if (!party) return null
    return {
      party: partyDto(party),
      gold: balanceDto(container.wholesale.goldBalance(partyId)),
      cash: balanceDto(container.wholesale.cashBalance(partyId)),
    }
  })

  // ── rates ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_M2.wholesaleRateFor, (_e, date: string) => {
    const rate = container.wholesale.rateFor(container.branchId, toIsoDate(date))
    return rate ? { display: rate.formatWhole(), rupees: rate.format() } : null
  })

  ipcMain.handle(IPC_M2.rateSet, (_e, request: SetRateRequest) => {
    try {
      container.rates.setRate(requireUser(), {
        branchId: container.branchId,
        purity: parsePurity(request.purity),
        ratePerTola: Money.parse(request.ratePerTolaRupees),
        effectiveFrom: toIsoDate(request.effectiveFrom),
        note: request.note,
      })
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, message: messageOf(error) }
    }
  })

  /**
   * Every recorded rate, newest first.
   *
   * Read-only and derived entirely from RateService.history, which the service
   * already exposed and nothing had yet asked for. A rate is never updated in
   * place — a correction is a new row — so this is the only place a mistyped
   * rate that has since been corrected is still visible.
   */
  ipcMain.handle(IPC_M2.rateHistory, (): RateHistoryDto[] =>
    PURITIES.flatMap((purity) =>
      container.rates.history(container.branchId, purity, 50).map((rate) => ({
        id: rate.id,
        purity: formatPurity(purity),
        effectiveFrom: rate.effectiveFrom,
        display: `Rs. ${rate.ratePerTola.formatWhole()}`,
        note: rate.note,
      })),
    ).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
  )

  // ── wholesale ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_M2.wholesaleNextInvoice, (): string => wholesaleNextInvoiceNo(navDeps))

  /**
   * Walking the slip book: the four arrows, and opening what they point at.
   *
   * Both bodies live in `wholesaleHandlers.ts` for the reason the retail ones
   * do — `ipcMain.handle` needs an Electron process, and a handler that needs
   * one cannot be exercised by `npm run test`.
   */
  ipcMain.handle(
    IPC_M2.wholesaleNeighbours,
    (_e, current: number | null, includeReversed: boolean) =>
      wholesaleNeighbours(navDeps, current, includeReversed),
  )

  ipcMain.handle(IPC_M2.wholesaleLoadAsDraft, (_e, invoiceNumber: number) =>
    wholesaleLoadAsDraft(navDeps, invoiceNumber),
  )

  /**
   * Live preview for the grid as it is typed.
   *
   * Computes nothing the post path would not compute — it calls the same
   * `computeLine` and `totalsOf` — so what the operator sees while typing is
   * exactly what will be saved. A row that cannot be parsed yet reports its own
   * error and contributes nothing to the totals, rather than failing the whole
   * preview: half-typed input is normal, not exceptional.
   */
  /** A typed override, or null when the box is empty or not yet a number. */
  const overrideOf = (raw: string | undefined): Money | null => {
    if (raw === undefined || raw.trim() === '') return null
    try {
      const parsed = Money.parse(raw)
      return parsed.isPositive ? parsed : null
    } catch {
      // Half-typed input is normal while someone is still typing.
      return null
    }
  }

  ipcMain.handle(IPC_M2.wholesalePreview, (_e, request: PostIssueRequest): PreviewDto => {
    const date = toIsoDate(request.entryDate)
    const rate =
      overrideOf(request.ratePerTolaOverride) ??
      container.wholesale.rateFor(container.branchId, date)

    const parsed: LinePreviewDto[] = []
    const valid: WholesaleLineInput[] = []

    for (const line of request.lines) {
      if (!line.itemName.trim() && !line.grossGrams.trim()) continue
      try {
        if (!rate) throw new Error('No gold rate for this date.')
        const input: WholesaleLineInput = {
          itemName: line.itemName.trim(),
          gross: Weight.parse(line.grossGrams || '0'),
          katt: Katt.parse(line.kattRatti || '0'),
          ratePerTola: rate,
          remarks: line.remarks,
        }
        const computed = computeLine(input)
        valid.push(input)
        parsed.push({
          itemName: computed.itemName,
          grossDisplay: computed.gross.format(),
          kattDisplay: computed.katt.format(),
          khalisDisplay: computed.khalis.format(),
          rateDisplay: computed.ratePerTola.formatWhole(),
          amountDisplay: computed.amount.format(),
          purityDisplay: computed.katt.purityPercent(),
          error: null,
        })
      } catch (error) {
        parsed.push({
          itemName: line.itemName,
          grossDisplay: line.grossGrams,
          kattDisplay: line.kattRatti,
          khalisDisplay: '—',
          rateDisplay: rate?.formatWhole() ?? '—',
          amountDisplay: '—',
          purityDisplay: '—',
          error: messageOf(error),
        })
      }
    }

    const totals = totalsOf(valid.map(computeLine))
    const previous = request.partyId
      ? container.wholesale.goldBalance(request.partyId)
      : null

    return {
      lines: parsed,
      grossTotalDisplay: totals.grossTotal.format(),
      khalisTotalDisplay: totals.khalisTotal.format(),
      amountTotalDisplay: totals.amountTotal.format(),
      rateDisplay: rate?.formatWhole() ?? null,
      rateMissing: rate === null,
      previousBalance: previous ? balanceDto(previous) : null,
      endBalance: previous ? balanceDto(previous.plus(totals.khalisTotal)) : null,
    }
  })

  ipcMain.handle(IPC_M2.wholesalePostIssue, (_e, request: PostIssueRequest): PostResult => {
    try {
      const override = overrideOf(request.ratePerTolaOverride)
      const result = container.wholesale.postIssue(requireUser(), {
        branchId: container.branchId,
        partyId: request.partyId,
        entryDate: toIsoDate(request.entryDate),
        ...(override ? { ratePerTolaOverride: override } : {}),
        lines: request.lines
          .filter((l) => l.itemName.trim() || l.grossGrams.trim())
          .map((l) => ({
            itemName: l.itemName,
            gross: Weight.parse(l.grossGrams || '0'),
            katt: Katt.parse(l.kattRatti || '0'),
            remarks: l.remarks,
          })),
        notes: request.notes,
      })
      return {
        ok: true,
        invoiceNo: displayInvoiceNo(navDeps, result.posted.entry.invoiceNumber),
        entryId: result.posted.entry.id,
        balanceAfter: balanceDto(result.goldBalanceAfter),
        warnings: result.kattWarnings.map((w) => w.message),
      }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(IPC_M2.wholesaleSettle, (_e, request: SettleRequest): PostResult => {
    try {
      const result = container.wholesale.settle(requireUser(), {
        branchId: container.branchId,
        partyId: request.partyId,
        entryDate: toIsoDate(request.entryDate),
        goldGiven: request.goldGrams.trim() ? Weight.parse(request.goldGrams) : Weight.ZERO,
        cashGiven: request.cashRupees.trim() ? Money.parse(request.cashRupees) : Money.ZERO,
        notes: request.notes,
        ...(request.confirmedOverReturn === true ? { confirmedOverReturn: true } : {}),
      })
      return {
        ok: true,
        invoiceNo: displayInvoiceNo(navDeps, result.posted.entry.invoiceNumber),
        entryId: result.posted.entry.id,
        balanceAfter: balanceDto(result.goldBalanceAfter),
        warnings: [],
      }
    } catch (error) {
      // Distinguished from a plain failure so the UI shows a confirmation with
      // a Continue button rather than an error the user can only dismiss.
      if (error instanceof OverReturnRequiresConfirmationError) {
        return { ok: false, needsConfirmation: true, message: error.consequence }
      }
      return { ok: false, message: messageOf(error) }
    }
  })

  ipcMain.handle(IPC_M2.wholesaleLedger, (_e, partyId: string): LedgerRowDto[] =>
    container.wholesale.ledger(partyId).map((row) => {
      const end = describeBalance(row.endGold)
      return {
        entryId: row.entry.id,
        date: row.entry.entryDate,
        invoiceNo: displayInvoiceNo(navDeps, row.entry.invoiceNumber),
        kind: row.entry.kind === 'ISSUE' ? 'Issued' : 'Settled',
        grossDisplay: row.entry.totalGross.format(),
        khalisDisplay: row.entry.totalKhalis.format(),
        settledGoldDisplay: row.entry.settledGold.format(),
        settledCashDisplay: row.entry.settledCash.format(),
        previousDisplay: describeBalance(row.previousGold).text,
        endDisplay: end.text,
        endDrCr: drCrOf(end),
        isOverReturn: row.entry.isOverReturn,
        isReversed: row.entry.reversedByEntryId !== null,
      }
    }),
  )

  ipcMain.handle(IPC_M2.wholesaleRecent, (): LedgerRowDto[] => [])

  ipcMain.handle(IPC_M2.changePassword, (_e, current: string, next: string) => {
    try {
      const user = requireUser()
      container.auth.changeOwnPassword(user.id, current, next)
      // The session copy still says the password must change; refresh it so the
      // shell stops gating on a condition that has just been satisfied.
      session.user = { ...user, mustChangePassword: false }
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, message: messageOf(error) }
    }
  })
}
