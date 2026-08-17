import {
  checkStoredFigures,
  computePurchaseLine,
  totalsOfPurchase,
  type Clock,
  type IsoDate,
  type Katt,
  type Money,
  type PublicUser,
  type Purity,
  type PurchaseEntry,
  type PurchaseEntryWithLines,
  type PurchaseLineInput,
  type StockBucket,
  type StoredFigureCheck,
  type Weight,
} from '@jewellery/domain'
import type {
  AuditRepository,
  NewPurchaseLine,
  PartyRepository,
  PurchaseNeighbours,
  PurchaseRepository,
} from '../abstractions/repositories.js'
import type { RateService } from '../rates/RateService.js'
import type { Settings } from '../settings/keys.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * Buying gold over the counter, and the stock movements that result.
 *
 * The service owns what the domain calculations deliberately do not: resolving
 * the rate for a date and STORING it on every row, validation, and the audit
 * trail. Atomicity is the repository's job — a purchase posts as header, lines
 * and stock movements in one transaction, or not at all.
 */

export interface PurchaseDependencies {
  readonly purchases: PurchaseRepository
  readonly parties: PartyRepository
  readonly audit: AuditRepository
  readonly rates: RateService
  readonly settings: Settings
  readonly clock: Clock
}

/**
 * The purity whose rate a purchase defaults to.
 *
 * K24, not K22: a purchase line is priced on its KHALIS — the pure content
 * after the katt deduction — and pure gold is what the 24K rate quotes.
 */
export const PURCHASE_RATE_PURITY: Purity = 'K24'

export interface PurchaseLineEntryInput {
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  /** Null means "use the header rate". A typed figure is stored per line. */
  readonly ratePerTola: Money | null
  readonly bucket: StockBucket
  readonly remarks: string | null
}

export interface SavePurchaseInput {
  readonly branchId: string
  readonly partyId: string
  readonly entryDate: IsoDate
  readonly lines: readonly PurchaseLineEntryInput[]
  /** Overrides the rate in force for the date. Still stored on the row. */
  readonly ratePerTolaOverride?: Money
  readonly notes: string | null
  /** Saving over a HELD purchase keeps its number and replaces its lines. */
  readonly heldId?: string | null
}

export interface PostedPurchaseResult {
  readonly posted: PurchaseEntryWithLines
}

export class PurchaseService {
  constructor(private readonly deps: PurchaseDependencies) {}

  /**
   * The rate that will be written onto a purchase dated `on`. Resolved once,
   * here, then stored — never looked up again when the row is read back.
   */
  rateFor(branchId: string, on: IsoDate): Money | null {
    return this.deps.rates.rateOn(branchId, PURCHASE_RATE_PURITY, on)?.ratePerTola ?? null
  }

  /** Posts a purchase: stock moves, the books change. */
  post(actor: PublicUser, input: SavePurchaseInput): PostedPurchaseResult {
    return this.save(actor, input, 'posted')
  }

  /**
   * Parks a purchase as HELD: a number and a screenful of lines, and nothing
   * else. No stock movement happens until it is posted — a held invoice has
   * not happened yet.
   */
  hold(actor: PublicUser, input: SavePurchaseInput): PostedPurchaseResult {
    return this.save(actor, input, 'held')
  }

  private save(
    actor: PublicUser,
    input: SavePurchaseInput,
    status: 'held' | 'posted',
  ): PostedPurchaseResult {
    if (input.lines.length === 0) {
      throw new ValidationError('A purchase needs at least one item.')
    }
    this.requireParty(input.partyId)

    const headerRate = input.ratePerTolaOverride ?? this.rateFor(input.branchId, input.entryDate)
    if (!headerRate || !headerRate.isPositive) {
      throw new ValidationError(
        `No gold rate has been recorded on or before ${input.entryDate}. Set the ` +
          `rate that applied that day before saving this purchase — every amount ` +
          `on it depends on the rate, and using today's would price it wrongly.`,
      )
    }

    if (input.heldId) {
      const held = this.deps.purchases.findById(input.heldId)
      if (!held) throw new ValidationError('The held purchase no longer exists.')
      if (held.entry.status !== 'held') {
        throw new ValidationError(
          `${String(held.entry.invoiceNumber)} is ${held.entry.status}, not held. ` +
            `A posted purchase is corrected by cancelling it, never by saving over it.`,
        )
      }
    }

    const lineInputs: PurchaseLineInput[] = input.lines.map((line) => {
      const name = line.itemName.trim()
      if (name.length === 0) throw new ValidationError('Every item needs a name.')
      if (line.gross.isNegative) {
        throw new ValidationError(`"${name}" has a negative gross weight.`)
      }
      if (line.gross.isZero) {
        throw new ValidationError(`"${name}" has no weight. Remove the row or enter one.`)
      }
      const rate = line.ratePerTola ?? headerRate
      if (!rate.isPositive) {
        throw new ValidationError(`"${name}" has a rate of zero.`)
      }
      return {
        itemName: name,
        gross: line.gross,
        katt: line.katt,
        ratePerTola: rate,
        bucket: line.bucket,
        remarks: line.remarks,
      }
    })

    const computed = lineInputs.map(computePurchaseLine)
    const totals = totalsOfPurchase(computed)

    const lines: NewPurchaseLine[] = computed.map((line, index) => ({
      lineNo: index + 1,
      itemName: line.itemName,
      gross: line.gross,
      katt: line.katt,
      khalis: line.khalis,
      ratePerTola: line.ratePerTola,
      amount: line.amount,
      bucket: line.bucket,
      remarks: line.remarks,
    }))

    const posted = this.deps.purchases.post({
      branchId: input.branchId,
      partyId: input.partyId,
      entryDate: input.entryDate,
      status,
      ratePerTola: headerRate,
      totalGross: totals.grossTotal,
      totalKhalis: totals.khalisTotal,
      totalAmount: totals.amountTotal,
      notes: input.notes,
      createdByUserId: actor.id,
      heldId: input.heldId ?? null,
      lines,
    })

    this.audit(actor, status === 'posted' ? 'TRANSACTION_POSTED' : 'TRANSACTION_HELD', posted.entry, {
      grossMg: totals.grossTotal.milligrams,
      khalisMg: totals.khalisTotal.milligrams,
      amountPaisa: totals.amountTotal.paisa,
    })

    return { posted }
  }

  /**
   * Cancels a purchase.
   *
   * For a posted one the repository writes reversing stock rows in the same
   * transaction that flips the status — the original rows survive, the pair
   * nets to zero, and the summary returns to its previous values. The reason
   * is required because it stays on the record.
   */
  cancel(actor: PublicUser, purchaseId: string, reason: string): PurchaseEntryWithLines {
    const existing = this.deps.purchases.findById(purchaseId)
    if (!existing) throw new ValidationError('No such purchase.')
    if (existing.entry.status === 'cancelled') {
      throw new ValidationError('That purchase has already been cancelled.')
    }
    if (reason.trim().length === 0) {
      throw new ValidationError('A cancellation needs a reason. It stays on the record.')
    }

    const cancelled = this.deps.purchases.cancel(purchaseId, reason.trim())
    this.audit(actor, 'TRANSACTION_CANCELLED', cancelled.entry, {
      wasStatus: existing.entry.status,
      reason: reason.trim(),
    })
    return cancelled
  }

  findById(id: string): PurchaseEntryWithLines | null {
    return this.deps.purchases.findById(id)
  }

  findByNumber(branchId: string, invoiceNumber: number): PurchaseEntryWithLines | null {
    return this.deps.purchases.findByNumber(branchId, invoiceNumber)
  }

  /**
   * A stored purchase, checked against its own arithmetic.
   *
   * Recomputes khalis and amount from the STORED katt and rate and compares
   * with the stored figures. Disagreement means the record was produced by an
   * earlier version — the screen shows a plain banner rather than silently
   * displaying either figure.
   */
  verifyStoredFigures(purchase: PurchaseEntryWithLines): StoredFigureCheck {
    return checkStoredFigures(purchase)
  }

  peekNextNumber(): number {
    return this.deps.purchases.peekNextNumber()
  }

  neighbours(
    branchId: string,
    current: number | null,
    includeCancelled: boolean,
  ): PurchaseNeighbours {
    return this.deps.purchases.neighbours(branchId, current, includeCancelled)
  }

  listRecent(branchId: string, limit = 50): PurchaseEntry[] {
    return this.deps.purchases.listRecent(branchId, limit)
  }

  private requireParty(partyId: string) {
    const party = this.deps.parties.findById(partyId)
    if (!party) throw new ValidationError('Select a party before saving.')
    return party
  }

  private audit(
    actor: PublicUser,
    action: 'TRANSACTION_POSTED' | 'TRANSACTION_HELD' | 'TRANSACTION_CANCELLED',
    entry: PurchaseEntry,
    detail: Record<string, unknown>,
  ): void {
    this.deps.audit.append({
      branchId: entry.branchId,
      userId: actor.id,
      action,
      entity: 'purchase_entries',
      entityId: entry.id,
      detail: JSON.stringify({ invoiceNumber: entry.invoiceNumber, ...detail }),
    })
  }
}
