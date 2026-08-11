import {
  Money,
  computeRetailInvoice,
  computeRetailLine,
  totalsOfRetail,
  toIsoTimestamp,
  type Clock,
  type IsoDate,
  type Weight,
  type LabourMode,
  type PaymentMethod,
  type PublicUser,
  type Purity,
  type RetailLineComputed,
  type RetailSale,
  type RetailSaleWithItems,
  type Salesman,
  type WastageRule,
} from '@jewellery/domain'
import type {
  AuditRepository,
  CustomerRepository,
  RetailSaleFilter,
  RetailSaleRepository,
  SalesmanRepository,
} from '../abstractions/repositories.js'
import type { Settings } from '../settings/keys.js'
import type { RateService } from '../rates/RateService.js'
import { ValidationError } from '../auth/AuthService.js'
import { amountInWords } from './amountInWords.js'

/**
 * Retail sales: the calculation, the rules, and the write.
 *
 * `calculate` is pure and touches no database beyond resolving the rate. It is
 * what the screen calls on every keystroke, and it is the reason the renderer
 * contains no arithmetic at all: what the operator sees while typing is
 * produced by the same code that will price the invoice when they save.
 *
 * The wastage RULE is read here, once, and passed down to the domain — and
 * written onto the sale, so changing the setting later cannot re-price an
 * invoice that has already been issued.
 */

export interface RetailDependencies {
  readonly retailSales: RetailSaleRepository
  readonly customers: CustomerRepository
  readonly salesmen: SalesmanRepository
  readonly audit: AuditRepository
  readonly rates: RateService
  readonly settings: Settings
  readonly clock: Clock
}

/** Above this, a wastage percentage has to be confirmed rather than refused. */
export const WASTAGE_CONFIRM_ABOVE_BP = 2_500
/** Above this it is refused outright — it is not a rate, it is a typo. */
export const WASTAGE_MAX_BP = 5_000

export interface RetailItemInput {
  readonly itemName: string
  readonly purity: Purity
  readonly grossWeight: Weight
  readonly stoneWeight: Weight
  readonly cutPerTola: Weight
  readonly wastageBp: number
  readonly labourCharges: Money
  readonly labourMode: LabourMode
  readonly stoneCharges: Money
}

export interface RetailDraftInput {
  readonly branchId: string
  readonly saleDate: IsoDate
  readonly saleTime: string
  readonly customerId: string | null
  readonly customerName: string
  readonly customerMobile: string | null
  readonly salesmanId: string | null
  readonly ratePurity: Purity
  /** Overrides the recorded rate. Still stored on the sale. */
  readonly ratePerTolaOverride?: Money
  readonly items: readonly RetailItemInput[]
  readonly customerGold: Weight
  readonly customerGoldPurity: Purity | null
  readonly hallmarkCharges: Money
  readonly otherCharges: Money
  readonly discount: Money
  readonly amountPaid: Money
  readonly paymentMethod: PaymentMethod
  readonly remarks: string | null
  /** Set once the operator has read and accepted a high-wastage warning. */
  readonly confirmedHighWastage?: boolean
  /** Minted by the screen when the sale is started. See migration 008. */
  readonly draftId?: string
}

export interface RetailCalculation {
  readonly lines: readonly RetailLineComputed[]
  readonly totalFine: Weight
  readonly goldValue: Money
  readonly totalLabour: Money
  readonly totalStone: Money
  readonly itemsTotal: Money
  readonly customerGoldValue: Money
  readonly remainingGold: Weight
  readonly grandTotal: Money
  readonly balance: Money
  readonly amountInWords: string
  readonly ratePerTola: Money
  readonly rule: WastageRule
  /** Advisory only. The screen shows these; none of them blocks by itself. */
  readonly warnings: readonly string[]
}

/**
 * Raised when a line's wastage is high enough to be worth a second look but not
 * so high it is certainly wrong.
 *
 * Warn and allow, the same shape as the wholesale over-return rule: the caller
 * retries with `confirmedHighWastage: true` and it goes through, audited.
 */
export class HighWastageRequiresConfirmationError extends Error {
  override readonly name = 'HighWastageRequiresConfirmationError'
  constructor(readonly consequence: string) {
    super(consequence)
  }
}

export class RetailSaleService {
  constructor(private readonly deps: RetailDependencies) {}

  private rule(): WastageRule {
    return {
      direction: this.deps.settings.retailWastageDirection(),
      basis: this.deps.settings.retailWastageBasis(),
    }
  }

  /** The rate that will be written onto a sale dated `on`, or null. */
  rateFor(branchId: string, purity: Purity, on: IsoDate): Money | null {
    return this.deps.rates.rateOn(branchId, purity, on)?.ratePerTola ?? null
  }

  /**
   * Everything the screen shows, computed from a draft.
   *
   * Called on every keystroke. Deliberately tolerant: an empty draft returns
   * zeroes rather than throwing, because a half-typed sale is the normal state
   * of this screen and an exception per character is not a design. The rules
   * that REFUSE live in `post`; the ones that merely advise come back here as
   * warnings.
   */
  calculate(input: RetailDraftInput): RetailCalculation {
    const rule = this.rule()
    const ratePerTola =
      input.ratePerTolaOverride ??
      this.rateFor(input.branchId, input.ratePurity, input.saleDate) ??
      Money.ZERO

    const lines = input.items.map((item) =>
      computeRetailLine(
        {
          itemName: item.itemName,
          grossWeight: item.grossWeight,
          stoneWeight: item.stoneWeight,
          cutPerTola: item.cutPerTola,
          wastageBp: item.wastageBp,
          labourCharges: item.labourCharges,
          labourMode: item.labourMode,
          stoneCharges: item.stoneCharges,
          ratePerTola,
        },
        rule,
      ),
    )

    const totals = totalsOfRetail(lines)

    const customerGoldRate =
      input.customerGold.isZero || input.customerGoldPurity === null
        ? null
        : (this.rateFor(input.branchId, input.customerGoldPurity, input.saleDate) ??
          ratePerTola)

    const invoice = computeRetailInvoice({
      totals,
      customerGold: input.customerGold,
      customerGoldRatePerTola: customerGoldRate,
      hallmarkCharges: input.hallmarkCharges,
      otherCharges: input.otherCharges,
      discount: input.discount,
      amountPaid: input.amountPaid,
    })

    const warnings: string[] = []
    if (ratePerTola.isZero) {
      warnings.push(
        `No ${input.ratePurity.slice(1)}K rate is recorded on or before ${input.saleDate}. ` +
          `Set it in Gold Rate before saving — every amount here depends on it.`,
      )
    }
    for (const [index, item] of input.items.entries()) {
      if (item.wastageBp > WASTAGE_CONFIRM_ABOVE_BP && item.wastageBp <= WASTAGE_MAX_BP) {
        warnings.push(
          `Line ${index + 1} ("${item.itemName}") has ${(item.wastageBp / 100).toFixed(2)}% ` +
            `wastage. That is unusually high — check it before saving.`,
        )
      }
    }

    return {
      lines,
      totalFine: totals.totalFine,
      goldValue: totals.goldValue,
      totalLabour: totals.totalLabour,
      totalStone: totals.totalStone,
      itemsTotal: totals.itemsTotal,
      customerGoldValue: invoice.customerGoldValue,
      remainingGold: invoice.remainingGold,
      grandTotal: invoice.grandTotal,
      balance: invoice.balance,
      amountInWords: amountInWords(invoice.grandTotal),
      ratePerTola,
      rule,
      warnings,
    }
  }

  /**
   * Posts a sale. Validates first, writes once, and is idempotent.
   *
   * Idempotency is durable, not a flag: a draft that has already produced a
   * sale returns that sale rather than writing a second. Two invoices for one
   * transaction means the gold left the shop once and the books say twice.
   */
  post(actor: PublicUser, input: RetailDraftInput): RetailSaleWithItems {
    return this.write(actor, input, 'posted')
  }

  /**
   * Parks a sale without selling anything.
   *
   * Validated with the GOODS rules only — the payment rules are deliberately
   * skipped, and that is the whole point of the method. A hold is what happens
   * when the customer goes to fetch the rest of the money, so refusing to park
   * it *because* it is not paid in full would make the button useless exactly
   * when it is needed.
   *
   * It still takes an invoice number, because the row it writes carries the
   * UNIQUE NOT NULL `invoice_no` every sale carries. That number is spent: this
   * is a real document in the sequence, and a held sale that is abandoned leaves
   * an auditable gap rather than a number a later sale silently reuses.
   */
  hold(actor: PublicUser, input: RetailDraftInput): RetailSaleWithItems {
    return this.write(actor, input, 'held')
  }

  private write(
    actor: PublicUser,
    input: RetailDraftInput,
    status: 'posted' | 'held',
  ): RetailSaleWithItems {
    if (input.draftId) {
      const already = this.deps.retailSales.findByDraftId(input.draftId)
      if (already) return already
    }

    const calculation =
      status === 'posted' ? this.validate(input) : this.validateGoods(input)

    const posted = this.deps.retailSales.post(
      {
        branchId: input.branchId,
        saleDate: input.saleDate,
        saleTime: input.saleTime,
        customerId: input.customerId,
        customerNameSnapshot: input.customerName.trim(),
        customerMobileSnapshot: input.customerMobile,
        salesmanId: input.salesmanId,
        salesmanNameSnapshot: input.salesmanId
          ? (this.deps.salesmen.findById(input.salesmanId)?.name ?? null)
          : null,
        ratePurity: input.ratePurity,
        ratePerTola: calculation.ratePerTola,
        goldValue: calculation.goldValue,
        customerGold: input.customerGold,
        customerGoldPurity: input.customerGoldPurity,
        customerGoldValue: calculation.customerGoldValue,
        hallmarkCharges: input.hallmarkCharges,
        otherCharges: input.otherCharges,
        discount: input.discount,
        grandTotal: calculation.grandTotal,
        amountPaid: input.amountPaid,
        paymentMethod: input.paymentMethod,
        balance: calculation.balance,
        amountInWords: calculation.amountInWords,
        remarks: input.remarks,
        status,
        // Written onto the row so this invoice always reproduces exactly,
        // whatever the setting says later.
        wastageDirection: calculation.rule.direction,
        wastageBasis: calculation.rule.basis,
        draftId: input.draftId ?? null,
        createdByUserId: actor.id,
        items: calculation.lines.map((line, index) => ({
          lineNo: index + 1,
          itemName: line.itemName,
          purity: input.items[index]?.purity ?? input.ratePurity,
          grossWeight: line.grossWeight,
          stoneWeight: line.stoneWeight,
          cutPerTola: line.cutPerTola,
          netWeight: line.netWeight,
          wastageBp: line.wastageBp,
          wastage: line.wastage,
          fineWeight: line.fineWeight,
          labourCharges: line.labourCharges,
          labourMode: line.labourMode,
          stoneCharges: line.stoneCharges,
          lineAmount: line.lineAmount,
        })),
      },
      this.deps.settings.retailInvoicePrefix(),
    )

    this.deps.audit.append({
      branchId: input.branchId,
      userId: actor.id,
      action: status === 'posted' ? 'TRANSACTION_POSTED' : 'TRANSACTION_HELD',
      entity: 'retail_sales',
      entityId: posted.sale.id,
      detail: JSON.stringify({
        invoiceNo: posted.sale.invoiceNo,
        grandTotalPaisa: posted.sale.grandTotal.paisa,
        items: posted.items.length,
        wastageRule: `${calculation.rule.direction}/${calculation.rule.basis}`,
      }),
    })

    return posted
  }

  /**
   * Every rule that can refuse a sale, in the order the operator meets them.
   *
   * Each message says the consequence in plain words rather than naming the
   * rule, because the person reading it is at a counter with a customer in
   * front of them.
   */
  validate(input: RetailDraftInput): RetailCalculation {
    const calculation = this.validateGoods(input)
    this.validatePayment(input, calculation)
    return calculation
  }

  /**
   * The rules about what is being sold, and what it comes to.
   *
   * Split out from the payment rules because a HELD sale must pass these and
   * must not be asked the payment questions — nothing has been paid yet, and
   * that is not an error, it is the reason it is on hold.
   */
  private validateGoods(input: RetailDraftInput): RetailCalculation {
    // 1. Something to sell.
    if (input.items.length === 0) {
      throw new ValidationError('Add at least one item before saving this sale.')
    }

    // 2. Real weights, and enough of them to survive the deductions.
    const rule = this.rule()
    for (const [index, item] of input.items.entries()) {
      const label = item.itemName.trim() || `Line ${index + 1}`
      if (item.itemName.trim().length === 0) {
        throw new ValidationError(`Line ${index + 1} needs an item name.`)
      }
      if (!item.grossWeight.isPositive) {
        throw new ValidationError(`"${label}" has no weight. Enter one or remove the line.`)
      }
      if (item.stoneWeight.isNegative || item.cutPerTola.isNegative) {
        throw new ValidationError(`"${label}" has a negative stone weight or cut.`)
      }

      // 4. Wastage band. Above the ceiling it is a typo, not a rate.
      if (item.wastageBp < 0 || item.wastageBp > WASTAGE_MAX_BP) {
        throw new ValidationError(
          `"${label}" has ${(item.wastageBp / 100).toFixed(2)}% wastage. ` +
            `Wastage must be between 0% and ${WASTAGE_MAX_BP / 100}%.`,
        )
      }

      const computed = computeRetailLine(
        { ...item, ratePerTola: Money.ZERO },
        rule,
      )
      if (!computed.netWeight.isPositive) {
        throw new ValidationError(
          `"${label}" has nothing left after the stone weight and cut are taken off. ` +
            `Check the gross weight, the stone weight and the cut.`,
        )
      }
      if (computed.fineWeight.isNegative) {
        throw new ValidationError(
          `"${label}" comes out at a negative fine weight once wastage is applied. ` +
            `Check the wastage percentage.`,
        )
      }
    }

    // 4b. High but plausible wastage: warn and allow, never block outright.
    const high = input.items.find(
      (item) => item.wastageBp > WASTAGE_CONFIRM_ABOVE_BP && item.wastageBp <= WASTAGE_MAX_BP,
    )
    if (high && input.confirmedHighWastage !== true) {
      throw new HighWastageRequiresConfirmationError(
        `"${high.itemName.trim()}" is being sold with ${(high.wastageBp / 100).toFixed(2)}% ` +
          `wastage, which is well above a normal charge. Continue?`,
      )
    }

    // 3. A rate must exist. Never defaulted to zero — pricing gold at nothing
    //    is invisible on the invoice and wrong in the ledger.
    const ratePerTola =
      input.ratePerTolaOverride ??
      this.rateFor(input.branchId, input.ratePurity, input.saleDate)
    if (!ratePerTola || !ratePerTola.isPositive) {
      throw new ValidationError(
        `No ${input.ratePurity.slice(1)}K gold rate has been recorded on or before ` +
          `${input.saleDate}. Set the rate that applied that day before saving — ` +
          `every amount on this sale depends on it.`,
      )
    }

    const calculation = this.calculate({ ...input, ratePerTolaOverride: ratePerTola })

    // 5. A discount cannot exceed what is being discounted.
    const discountable = calculation.itemsTotal
      .plus(input.hallmarkCharges)
      .plus(input.otherCharges)
    if (input.discount.isNegative) {
      throw new ValidationError('A discount cannot be negative.')
    }
    if (input.discount.paisa > discountable.paisa) {
      throw new ValidationError(
        `The discount of Rs ${input.discount.format()} is more than the sale is worth ` +
          `(Rs ${discountable.format()}). Reduce it.`,
      )
    }

    // 6. Old gold cannot turn the invoice into a refund. That is a purchase,
    //    and it belongs on a purchase document, not hidden inside a sale.
    if (calculation.customerGoldValue.paisa > discountable.minus(input.discount).paisa) {
      throw new ValidationError(
        `The customer's old gold is worth Rs ${calculation.customerGoldValue.format()}, ` +
          `which is more than this sale comes to. Record the difference as a purchase ` +
          `rather than a negative invoice.`,
      )
    }

    // A negative payment is nonsense whoever the customer is, so it is checked
    // before the walk-in rule — otherwise the walk-in message fires first and
    // tells the operator to pay in full when the real fault is the minus sign.
    if (input.amountPaid.isNegative) {
      throw new ValidationError('The amount paid cannot be negative.')
    }

    return calculation
  }

  /** The rules about who is paying, and whether there is anywhere to owe from. */
  private validatePayment(input: RetailDraftInput, calculation: RetailCalculation): void {
    // 8. Credit needs somebody to owe it.
    const customer = input.customerId
      ? this.deps.customers.findById(input.customerId)
      : null
    if (input.customerId && !customer) {
      throw new ValidationError('That customer no longer exists. Choose another.')
    }
    if (input.paymentMethod === 'credit' && !customer) {
      throw new ValidationError(
        'A credit sale needs a customer account to carry the balance. ' +
          'Add the customer first, or take payment now.',
      )
    }

    // 7. A walk-in has no ledger, so there is nowhere for a balance to live.
    const isWalkIn = customer === null || customer.isWalkIn
    if (isWalkIn && input.amountPaid.paisa !== calculation.grandTotal.paisa) {
      throw new ValidationError(
        `A walk-in customer has no account to carry a balance, so the full ` +
          `Rs ${calculation.grandTotal.format()} has to be paid now. ` +
          `Add the customer as an account to sell on credit.`,
      )
    }
  }

  findById(id: string): RetailSaleWithItems | null {
    return this.deps.retailSales.findById(id)
  }

  findByInvoiceNo(invoiceNo: string): RetailSaleWithItems | null {
    return this.deps.retailSales.findByInvoiceNo(invoiceNo)
  }

  /** Sales matching a date range, a customer and a status. Read-only. */
  list(filter: RetailSaleFilter): readonly RetailSale[] {
    return this.deps.retailSales.list(filter)
  }

  /** The salesmen a sale may be attributed to. Active only. */
  salesmen(): readonly Salesman[] {
    return this.deps.salesmen.list(true)
  }

  peekNextInvoiceNo(): string {
    return this.deps.retailSales.peekNextInvoiceNo(this.deps.settings.retailInvoicePrefix())
  }

  /**
   * Voids a posted sale. Never deletes, and the invoice number stays burned —
   * a gap is auditable, a reused number is a second document claiming to be the
   * first.
   */
  void(actor: PublicUser, id: string, reason: string): void {
    const existing = this.deps.retailSales.findById(id)
    if (!existing) throw new ValidationError('No such sale.')
    if (existing.sale.status === 'void') {
      throw new ValidationError('That sale has already been voided.')
    }
    if (reason.trim().length === 0) {
      throw new ValidationError('Voiding a sale needs a reason. It stays on the record.')
    }

    this.deps.retailSales.markVoid(id, reason.trim(), toIsoTimestamp(this.deps.clock.now()))
    this.deps.audit.append({
      branchId: existing.sale.branchId,
      userId: actor.id,
      action: 'TRANSACTION_REVERSED',
      entity: 'retail_sales',
      entityId: id,
      detail: JSON.stringify({ invoiceNo: existing.sale.invoiceNo, reason: reason.trim() }),
    })
  }
}
