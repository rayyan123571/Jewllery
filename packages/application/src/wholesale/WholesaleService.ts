import {
  Money,
  Weight,
  computeLine,
  computeSettlement,
  totalsOf,
  type Clock,
  type IsoDate,
  type Katt,
  type PartyLedgerRow,
  type PublicUser,
  type Purity,
  type WholesaleEntry,
  type WholesaleEntryWithLines,
  type WholesaleLineInput,
} from '@jewellery/domain'
import type {
  AuditRepository,
  NewWholesaleLine,
  PartyRepository,
  WholesaleRepository,
} from '../abstractions/repositories.js'
import type { Settings } from '../settings/keys.js'
import type { RateService } from '../rates/RateService.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * Posting wholesale slips and settling gold debts.
 *
 * The service owns three things the domain calculations deliberately do not:
 * resolving the rate for a date and *storing* it on the row, deciding whether a
 * negative outcome needs confirming, and writing the audit trail.
 */

export interface WholesaleDependencies {
  readonly wholesale: WholesaleRepository
  readonly parties: PartyRepository
  readonly audit: AuditRepository
  readonly rates: RateService
  readonly settings: Settings
  readonly clock: Clock
}

/** The purity whose rate a wholesale slip is priced at. */
export const WHOLESALE_RATE_PURITY: Purity = 'K22'

export interface IssueLineInput {
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  readonly remarks: string | null
}

export interface PostIssueInput {
  readonly branchId: string
  readonly partyId: string
  readonly entryDate: IsoDate
  readonly lines: readonly IssueLineInput[]
  /** Overrides the rate in force for the date. Still stored on the row. */
  readonly ratePerTolaOverride?: Money
  readonly notes: string | null
}

export interface SettleInput {
  readonly branchId: string
  readonly partyId: string
  readonly entryDate: IsoDate
  readonly goldGiven: Weight
  readonly cashGiven: Money
  readonly ratePerTolaOverride?: Money
  readonly notes: string | null
  /**
   * Set only after the user has read the confirmation and chosen to continue.
   * Without it a settlement that would leave a negative balance is refused.
   */
  readonly confirmedOverReturn?: boolean
}

/**
 * Thrown when a settlement would leave the party's balance negative by more
 * than the tolerance, and the user has not confirmed it.
 *
 * This is the "warn and allow" rule from DECISIONS §7, expressed as a refusal
 * the UI turns into a confirmation. It is not a block: the caller retries with
 * `confirmedOverReturn: true` and it goes through, flagged and audited.
 */
export class OverReturnRequiresConfirmationError extends Error {
  override readonly name = 'OverReturnRequiresConfirmationError'
  constructor(
    readonly partyName: string,
    readonly resultingBalance: Weight,
    /** Plain words for the dialog. Says the consequence, not the rule. */
    readonly consequence: string,
  ) {
    super(consequence)
  }
}

/** A katt outside the configured band. Advisory — never blocks on its own. */
export interface KattWarning {
  readonly lineNo: number
  readonly itemName: string
  readonly katt: Katt
  readonly message: string
}

export interface PostedResult {
  readonly posted: WholesaleEntryWithLines
  readonly goldBalanceAfter: Weight
  readonly kattWarnings: readonly KattWarning[]
}

export class WholesaleService {
  constructor(private readonly deps: WholesaleDependencies) {}

  /**
   * The party's gold balance: their opening balance plus every posted delta.
   *
   * Derived, never stored. The opening balance is the one figure no transaction
   * can produce, so it lives on the party; everything after it comes from the
   * entries, which are the half that can be audited.
   */
  goldBalance(partyId: string): Weight {
    const party = this.requireParty(partyId)
    const { goldMg } = this.deps.wholesale.balances(partyId)
    return party.openingGold.plus(Weight.fromMilligrams(goldMg))
  }

  cashBalance(partyId: string): Money {
    const party = this.requireParty(partyId)
    const { cashPaisa } = this.deps.wholesale.balances(partyId)
    return party.openingCash.plus(Money.fromPaisa(cashPaisa))
  }

  /**
   * The rate that will be written onto a slip dated `on`.
   *
   * Resolved once, here, and then stored — never looked up again when the row is
   * read back. Returns null when none exists, so the caller can decide whether
   * that is fatal: an issue can be priced by an override, a cash settlement
   * cannot proceed at all.
   */
  rateFor(branchId: string, on: IsoDate): Money | null {
    return this.deps.rates.rateOn(branchId, WHOLESALE_RATE_PURITY, on)?.ratePerTola ?? null
  }

  postIssue(actor: PublicUser, input: PostIssueInput): PostedResult {
    if (input.lines.length === 0) {
      throw new ValidationError('A slip needs at least one item.')
    }
    this.requireParty(input.partyId)

    const rate = input.ratePerTolaOverride ?? this.rateFor(input.branchId, input.entryDate)
    if (!rate || !rate.isPositive) {
      throw new ValidationError(
        `No gold rate has been recorded on or before ${input.entryDate}. Set the ` +
          `rate that applied that day before saving this slip — every amount on ` +
          `it depends on the rate, and using today's would price it wrongly.`,
      )
    }

    const lineInputs: WholesaleLineInput[] = input.lines.map((line) => {
      const name = line.itemName.trim()
      if (name.length === 0) throw new ValidationError('Every item needs a name.')
      if (line.gross.isNegative) {
        throw new ValidationError(`"${name}" has a negative gross weight.`)
      }
      if (line.gross.isZero) {
        throw new ValidationError(`"${name}" has no weight. Remove the row or enter one.`)
      }
      return { itemName: name, gross: line.gross, katt: line.katt, ratePerTola: rate, remarks: line.remarks }
    })

    const computed = lineInputs.map(computeLine)
    const totals = totalsOf(computed)

    const lines: NewWholesaleLine[] = computed.map((line, index) => ({
      lineNo: index + 1,
      itemName: line.itemName,
      gross: line.gross,
      katt: line.katt,
      khalis: line.khalis,
      ratePerTola: line.ratePerTola,
      amount: line.amount,
      remarks: line.remarks,
    }))

    const posted = this.deps.wholesale.post({
      branchId: input.branchId,
      partyId: input.partyId,
      kind: 'ISSUE',
      entryDate: input.entryDate,
      ratePerTola: rate,
      totalGross: totals.grossTotal,
      totalKhalis: totals.khalisTotal,
      totalAmount: totals.amountTotal,
      settledGold: Weight.ZERO,
      settledCash: Money.ZERO,
      settledCashAsGold: Weight.ZERO,
      // Gold out to the party increases what they owe (DECISIONS §4).
      goldDelta: totals.khalisTotal,
      cashDelta: Money.ZERO,
      isOverReturn: false,
      confirmedByUserId: null,
      reversesEntryId: null,
      notes: input.notes,
      createdByUserId: actor.id,
      lines,
    })

    this.audit(actor, 'TRANSACTION_POSTED', posted.entry, {
      kind: 'ISSUE',
      khalisMg: totals.khalisTotal.milligrams,
    })

    return {
      posted,
      goldBalanceAfter: this.goldBalance(input.partyId),
      kattWarnings: this.checkKatt(lines),
    }
  }

  /**
   * Settles a gold debt in gold, in cash, or in both.
   *
   * All three reduce the **gold** debt — see DECISIONS §10. The rate used for a
   * cash portion is resolved for the settlement's own date and stored on the
   * row, so the settlement means the same thing forever.
   */
  settle(actor: PublicUser, input: SettleInput): PostedResult {
    const party = this.requireParty(input.partyId)

    if (input.goldGiven.isZero && input.cashGiven.isZero) {
      throw new ValidationError('Enter gold, cash, or both to settle.')
    }
    if (input.goldGiven.isNegative || input.cashGiven.isNegative) {
      throw new ValidationError(
        'A settlement cannot be negative. To correct a posted entry, reverse it.',
      )
    }

    const needsRate = !input.cashGiven.isZero
    const rate = input.ratePerTolaOverride ?? this.rateFor(input.branchId, input.entryDate)
    if (needsRate && (!rate || !rate.isPositive)) {
      throw new ValidationError(
        `This settlement includes a cash payment, but no gold rate has been ` +
          `recorded on or before ${input.entryDate}. Record the rate that applied ` +
          `that day before saving — a cash payment cannot reduce a gold debt ` +
          `without one, and using today's rate would settle a real debt at the ` +
          `wrong price.`,
      )
    }

    const previous = this.goldBalance(input.partyId)
    const result = computeSettlement({
      previousGoldBalance: previous,
      goldGiven: input.goldGiven,
      cashGiven: input.cashGiven,
      ratePerTola: needsRate ? (rate as Money) : null,
    })

    // Warn and allow, never block. Below the tolerance it passes quietly —
    // two scales disagree at the third decimal and a modal every time trains
    // people to click through it.
    const tolerance = this.deps.settings.overReturnToleranceMg()
    const beyondTolerance =
      result.newGoldBalance.isNegative &&
      result.newGoldBalance.absolute.milligrams > tolerance

    if (beyondTolerance && input.confirmedOverReturn !== true) {
      const owed = result.newGoldBalance.absolute
      throw new OverReturnRequiresConfirmationError(
        party.name,
        result.newGoldBalance,
        `This leaves ${party.name} with ${owed.formatWithUnit()} that you owe them. Continue?`,
      )
    }

    const posted = this.deps.wholesale.post({
      branchId: input.branchId,
      partyId: input.partyId,
      kind: 'SETTLEMENT',
      entryDate: input.entryDate,
      ratePerTola: needsRate ? (rate as Money) : null,
      totalGross: Weight.ZERO,
      totalKhalis: Weight.ZERO,
      totalAmount: Money.ZERO,
      settledGold: input.goldGiven,
      settledCash: input.cashGiven,
      settledCashAsGold: result.goldFromCash,
      // Gold coming back reduces what the party owes.
      goldDelta: result.totalGoldSettled.negated(),
      // Deliberately zero: settling a gold debt in cash is a gold-debt
      // transaction, never an unrelated cash credit (DECISIONS §10).
      cashDelta: Money.ZERO,
      isOverReturn: beyondTolerance,
      confirmedByUserId: beyondTolerance ? actor.id : null,
      reversesEntryId: null,
      notes: input.notes,
      createdByUserId: actor.id,
      lines: [],
    })

    this.audit(actor, 'TRANSACTION_POSTED', posted.entry, {
      kind: 'SETTLEMENT',
      settledGoldMg: input.goldGiven.milligrams,
      settledCashPaisa: input.cashGiven.paisa,
      cashAsGoldMg: result.goldFromCash.milligrams,
      ratePerTolaPaisa: rate?.paisa ?? null,
    })

    if (beyondTolerance) {
      this.audit(actor, 'OVER_RETURN_CONFIRMED', posted.entry, {
        resultingBalanceMg: result.newGoldBalance.milligrams,
        toleranceMg: tolerance,
      })
    }

    return {
      posted,
      goldBalanceAfter: result.newGoldBalance,
      kattWarnings: [],
    }
  }

  /**
   * Reverses a posted entry by posting its mirror image.
   *
   * Never an edit and never a delete: both rows survive, so the books show what
   * happened *and* what corrected it (DECISIONS §6).
   */
  reverse(actor: PublicUser, entryId: string, reason: string): WholesaleEntryWithLines {
    const original = this.deps.wholesale.findById(entryId)
    if (!original) throw new ValidationError('No such entry.')
    if (original.entry.reversedByEntryId) {
      throw new ValidationError('That entry has already been reversed.')
    }
    if (reason.trim().length === 0) {
      throw new ValidationError('A reversal needs a reason. It stays on the record.')
    }

    const reversal = this.deps.wholesale.post({
      branchId: original.entry.branchId,
      partyId: original.entry.partyId,
      kind: original.entry.kind,
      entryDate: this.deps.rates.today(),
      ratePerTola: original.entry.ratePerTola,
      totalGross: original.entry.totalGross.negated(),
      totalKhalis: original.entry.totalKhalis.negated(),
      totalAmount: original.entry.totalAmount.negated(),
      settledGold: original.entry.settledGold.negated(),
      settledCash: original.entry.settledCash.negated(),
      settledCashAsGold: original.entry.settledCashAsGold.negated(),
      goldDelta: original.entry.goldDelta.negated(),
      cashDelta: original.entry.cashDelta.negated(),
      isOverReturn: false,
      confirmedByUserId: null,
      reversesEntryId: original.entry.id,
      notes: reason.trim(),
      createdByUserId: actor.id,
      lines: [],
    })

    this.deps.wholesale.markReversed(original.entry.id, reversal.entry.id)
    this.audit(actor, 'TRANSACTION_REVERSED', reversal.entry, {
      reversed: original.entry.invoiceNumber,
      reason: reason.trim(),
    })
    return reversal
  }

  /**
   * The party ledger, in the slip's own shape: Previous → Current Issued → End
   * Balance, accumulated down the page.
   */
  ledger(partyId: string, limit = 200): PartyLedgerRow[] {
    const party = this.requireParty(partyId)
    let gold = party.openingGold
    let cash = party.openingCash

    return this.deps.wholesale.listForParty(partyId, limit).map((entry) => {
      const previousGold = gold
      const previousCash = cash
      gold = gold.plus(entry.goldDelta)
      cash = cash.plus(entry.cashDelta)
      return { entry, previousGold, endGold: gold, previousCash, endCash: cash }
    })
  }

  findById(id: string): WholesaleEntryWithLines | null {
    return this.deps.wholesale.findById(id)
  }

  /**
   * One slip out of the ISSUE book, by the number printed on it.
   *
   * The issue book is the one the slip screen edits. A settlement is read from
   * the ledger, where it belongs, rather than through the arrows.
   */
  findByNumber(branchId: string, invoiceNumber: number): WholesaleEntryWithLines | null {
    return this.deps.wholesale.findByNumber(branchId, 'ISSUE', invoiceNumber)
  }

  /** A PREVIEW of the next slip number. Reserves nothing, burns nothing. */
  peekNextNumber(): number {
    return this.deps.wholesale.peekNextNumber('ISSUE')
  }

  /**
   * Where the four navigation controls can go from the slip on screen.
   *
   * Reversed slips are skipped unless asked for. A reversal never deletes the
   * original and never reuses its number, so hiding it leaves a visible gap in
   * the numbering — which is correct, and is what tells the operator a slip was
   * corrected rather than lost.
   */
  neighbours(
    branchId: string,
    current: number | null,
    includeReversed: boolean,
  ): { first: number | null; previous: number | null; next: number | null; last: number | null } {
    return this.deps.wholesale.neighbours(branchId, current, includeReversed)
  }

  listRecent(branchId: string, limit = 50): WholesaleEntry[] {
    return this.deps.wholesale.listRecent(branchId, limit)
  }

  /**
   * Advisory katt check. Off unless someone has turned it on and set a band.
   *
   * Never blocks — it returns warnings the screen shows beside the row. Katt
   * outside 0–96 is a different matter and is refused by the value type.
   */
  private checkKatt(lines: readonly NewWholesaleLine[]): KattWarning[] {
    if (!this.deps.settings.kattCheckEnabled()) return []
    const { min, max } = this.deps.settings.kattRangeMilliRatti()

    return lines.flatMap((line) => {
      const value = line.katt.milliRatti
      if (value >= min && value <= max) return []
      return [
        {
          lineNo: line.lineNo,
          itemName: line.itemName,
          katt: line.katt,
          message:
            `Katt ${line.katt.format()} on "${line.itemName}" is outside the ` +
            `expected ${min / 1000}–${max / 1000} ratti per tola ` +
            `(${line.katt.purityPercent()} pure). Check it.`,
        },
      ]
    })
  }

  private requireParty(partyId: string) {
    const party = this.deps.parties.findById(partyId)
    if (!party) throw new ValidationError('Select a party before saving.')
    return party
  }

  private audit(
    actor: PublicUser,
    action: 'TRANSACTION_POSTED' | 'TRANSACTION_REVERSED' | 'OVER_RETURN_CONFIRMED',
    entry: WholesaleEntry,
    detail: Record<string, unknown>,
  ): void {
    this.deps.audit.append({
      branchId: entry.branchId,
      userId: actor.id,
      action,
      entity: 'wholesale_entries',
      entityId: entry.id,
      detail: JSON.stringify({ invoiceNumber: entry.invoiceNumber, ...detail }),
    })
  }
}
