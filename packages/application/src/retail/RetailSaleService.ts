import {
  DEFAULT_SLIP_LABEL,
  Money,
  computeRetailInvoice,
  computeRetailLine,
  formatInvoiceNo,
  parseInvoiceNumber,
  totalsOfRetail,
  toIsoTimestamp,
  type Clock,
  type IsoDate,
  type Weight,
  type LabourMode,
  type PaymentMethod,
  type PublicUser,
  type Purity,
  type RetailBillWithSlips,
  type RetailLineComputed,
  type RetailSale,
  type RetailSaleWithItems,
  type WastageRule,
} from '@jewellery/domain'
import type {
  AuditRepository,
  CustomerRepository,
  DraftBill,
  RetailBillRepository,
  RetailDraftRepository,
  RetailSaleFilter,
  RetailSaleRepository,
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
  readonly retailBills: RetailBillRepository
  readonly retailDrafts: RetailDraftRepository
  readonly customers: CustomerRepository
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
  /** ABSOLUTE for this item — see RetailLineInput.purityDeduction. */
  readonly purityDeduction: Weight
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

/**
 * One slip's own facts. Everything shared by the visit lives on the bill.
 *
 * The split is exactly the one migration 009 draws: items, charges, discount and
 * payment belong to the document; customer, mobile, date, time and rate belong
 * to the visit. Holding the shared facts once is what stops two
 * slips from the same visit disagreeing about who bought them.
 */
export interface RetailSlipInput {
  readonly slipNo: number
  readonly slipLabel: string
  readonly items: readonly RetailItemInput[]
  readonly customerGold: Weight
  readonly customerGoldPurity: Purity | null
  readonly hallmarkCharges: Money
  readonly otherCharges: Money
  readonly discount: Money
  readonly amountPaid: Money
  readonly paymentMethod: PaymentMethod
  readonly remarks: string | null
  /** Per slip, because each slip is its own document in the sequence. */
  readonly draftId?: string
}

export interface RetailBillInput {
  readonly branchId: string
  readonly saleDate: IsoDate
  readonly saleTime: string
  readonly customerId: string | null
  readonly customerName: string
  readonly customerMobile: string | null
  readonly ratePurity: Purity
  readonly ratePerTolaOverride?: Money
  readonly slips: readonly RetailSlipInput[]
  readonly confirmedHighWastage?: boolean
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
  /** Items and charges less discount, rounded. The slip's GRAND TOTAL AMOUNT. */
  readonly invoiceTotal: Money
  /** The invoice total less the customer's old gold. What is payable in cash. */
  readonly grandTotal: Money
  /** `invoiceTotal − amountPaid − customerGoldValue`. What is still owed. */
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

    /*
     * Each item is priced at ITS OWN purity's rate.
     *
     * A bill can hold a 22K chain and an 18K pair of tops, and pricing both off
     * one purity would overcharge for one and undercharge for the other. The
     * sale still carries a `ratePurity` — it is the default a new item takes and
     * the one an override applies to — but a line that says 18K is valued at the
     * 18K rate.
     *
     * An explicit override applies to every line, because that is what an
     * override IS: the operator saying "price this sale at this figure".
     */
    const rateForItem = (item: RetailItemInput): Money =>
      input.ratePerTolaOverride ??
      this.rateFor(input.branchId, item.purity, input.saleDate) ??
      ratePerTola

    const lines = input.items.map((item) =>
      computeRetailLine(
        {
          itemName: item.itemName,
          grossWeight: item.grossWeight,
          stoneWeight: item.stoneWeight,
          purityDeduction: item.purityDeduction,
          wastageBp: item.wastageBp,
          labourCharges: item.labourCharges,
          labourMode: item.labourMode,
          stoneCharges: item.stoneCharges,
          ratePerTola: rateForItem(item),
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
      // Read here, once, like the wastage rule — and for the same reason: which
      // rounding applies is the shop's decision, and the domain's job is only to
      // apply whichever one it is handed.
      roundingNearestRupees: this.deps.settings.retailRoundingNearest(),
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
      invoiceTotal: invoice.invoiceTotal,
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
        // The shop does not track a salesman, so nothing is attributed to one.
        // The COLUMNS stay (migration 005) and any value an older sale already
        // carries is left exactly as it was — see the schema note there. What
        // stops here is the writing: a field the UI cannot set but the service
        // still populates is a field that comes back by accident.
        salesmanId: null,
        salesmanNameSnapshot: null,
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
          purityDeduction: line.purityDeduction,
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
      if (item.stoneWeight.isNegative || item.purityDeduction.isNegative) {
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

  // ── bills, which group slips ──────────────────────────────────────────────

  /**
   * Posts a whole bill: every slip, or none of them.
   *
   * Each slip is validated FIRST, all of them, before anything is written. That
   * ordering is the point. Validating and writing slip by slip would leave slip
   * 1 on disk when slip 3 turns out to have no rate — and while the repository's
   * transaction would roll that back, the operator would have been shown a
   * failure for slip 3 with no way to know slip 1 was fine. Validating up front
   * means the refusal names the slip that is actually wrong, before a single row
   * is written.
   *
   * The write itself is one transaction in the repository. Either the visit is
   * recorded or none of it is; a customer must never walk out with two invoices
   * for a three-piece purchase.
   */
  postBill(actor: PublicUser, input: RetailBillInput): RetailBillWithSlips {
    if (input.slips.length === 0) {
      throw new ValidationError('A bill needs at least one slip before it can be saved.')
    }

    // Every slip validated before any of them is written. A failure here names
    // the slip, because "the sale could not be saved" on a four-slip bill tells
    // the operator nothing about where to look.
    const validated = input.slips.map((slip) => {
      try {
        return { slip, calculation: this.validate(this.saleInputOf(input, slip)) }
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ValidationError(`${this.slipName(slip)}: ${error.message}`)
        }
        throw error
      }
    })

    const written = this.deps.retailBills.postBill(
      {
        branchId: input.branchId,
        billDate: input.saleDate,
        billTime: input.saleTime,
        customerId: input.customerId,
        customerNameSnapshot: input.customerName.trim(),
        customerMobileSnapshot: input.customerMobile,
        salesmanId: null,
        salesmanNameSnapshot: null,
        status: 'posted',
        createdByUserId: actor.id,
        slips: validated.map(({ slip, calculation }) => ({
          slipNo: slip.slipNo,
          // Slip 1 is the full bill unless it is renamed. A later slip that
          // was never named is "Slip 3", not a second "Full Bill" — the dump
          // caught two slips of one bill both stored under the same label.
          slipLabel:
            slip.slipLabel.trim() ||
            (slip.slipNo === 1 ? DEFAULT_SLIP_LABEL : `Slip ${slip.slipNo}`),
          sale: this.saleRowOf(actor, input, slip, calculation, 'posted'),
        })),
      },
      this.deps.settings.retailBillPrefix(),
    )

    // The draft has become a real document, so it stops being a draft. Only
    // here — a REFUSED post leaves it exactly where it was, because the
    // operator still has the work and still needs it on disk.
    this.deps.retailDrafts.clear(input.branchId)

    this.deps.audit.append({
      branchId: input.branchId,
      userId: actor.id,
      action: 'TRANSACTION_POSTED',
      entity: 'retail_bills',
      entityId: written.bill.id,
      detail: JSON.stringify({
        billNo: written.bill.billNo,
        slips: written.slips.length,
        invoiceNos: written.slips.map((slip) => slip.sale.invoiceNo),
        grandTotalPaisa: written.slips.reduce(
          (sum, slip) => sum + slip.sale.grandTotal.paisa,
          0,
        ),
      }),
    })

    return written
  }

  /** "Slip 2 (Gold Bangles)", for a message the operator can act on. */
  private slipName(slip: RetailSlipInput): string {
    const label = slip.slipLabel.trim()
    return label ? `Slip ${slip.slipNo} (${label})` : `Slip ${slip.slipNo}`
  }

  /** A slip, expressed as the sale input the existing rules already validate. */
  private saleInputOf(bill: RetailBillInput, slip: RetailSlipInput): RetailDraftInput {
    return {
      branchId: bill.branchId,
      saleDate: bill.saleDate,
      saleTime: bill.saleTime,
      customerId: bill.customerId,
      customerName: bill.customerName,
      customerMobile: bill.customerMobile,
      ratePurity: bill.ratePurity,
      ...(bill.ratePerTolaOverride ? { ratePerTolaOverride: bill.ratePerTolaOverride } : {}),
      items: slip.items,
      customerGold: slip.customerGold,
      customerGoldPurity: slip.customerGoldPurity,
      hallmarkCharges: slip.hallmarkCharges,
      otherCharges: slip.otherCharges,
      discount: slip.discount,
      amountPaid: slip.amountPaid,
      paymentMethod: slip.paymentMethod,
      remarks: slip.remarks,
      ...(bill.confirmedHighWastage === true ? { confirmedHighWastage: true } : {}),
      ...(slip.draftId ? { draftId: slip.draftId } : {}),
    }
  }

  private saleRowOf(
    actor: PublicUser,
    bill: RetailBillInput,
    slip: RetailSlipInput,
    calculation: RetailCalculation,
    status: 'posted' | 'held',
  ): Parameters<RetailSaleRepository['post']>[0] {
    const input = this.saleInputOf(bill, slip)
    return {
      branchId: input.branchId,
      saleDate: input.saleDate,
      saleTime: input.saleTime,
      customerId: input.customerId,
      customerNameSnapshot: input.customerName.trim(),
      customerMobileSnapshot: input.customerMobile,
      salesmanId: null,
      salesmanNameSnapshot: null,
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
      wastageDirection: calculation.rule.direction,
      wastageBasis: calculation.rule.basis,
      draftId: input.draftId ?? null,
      createdByUserId: actor.id,
      items: calculation.lines.map((line, index) => ({
        lineNo: index + 1,
        itemName: line.itemName,
        purity: slip.items[index]?.purity ?? input.ratePurity,
        grossWeight: line.grossWeight,
        stoneWeight: line.stoneWeight,
        purityDeduction: line.purityDeduction,
        netWeight: line.netWeight,
        wastageBp: line.wastageBp,
        wastage: line.wastage,
        fineWeight: line.fineWeight,
        labourCharges: line.labourCharges,
        labourMode: line.labourMode,
        stoneCharges: line.stoneCharges,
        lineAmount: line.lineAmount,
      })),
    }
  }


  // ── the bill in progress ──────────────────────────────────────────────────

  /**
   * Writes the branch's draft.
   *
   * Deliberately does NOT validate. A draft is a half-typed sale by definition
   * — that is what makes it a draft — and refusing to persist one because it
   * has no items yet, or no rate, would mean the operator's work is only safe
   * once it is already good enough to post. The rules that refuse still refuse,
   * at `postBill`, where a document is actually being created.
   */
  saveDraft(actor: PublicUser, draft: Omit<DraftBill, 'createdByUserId'>): void {
    this.deps.retailDrafts.save({ ...draft, createdByUserId: actor.id })
  }

  /** The branch's open draft, or null. Read once, on launch. */
  findDraft(branchId: string): DraftBill | null {
    return this.deps.retailDrafts.find(branchId)
  }

  /**
   * Throws the draft away.
   *
   * Only ever on an explicit Discard, or immediately after the bill it holds has
   * posted. Never on a failed post: if `postBill` refuses, the operator still
   * has the work and still needs it on disk.
   */
  discardDraft(branchId: string): void {
    this.deps.retailDrafts.clear(branchId)
  }

  findBillById(id: string): RetailBillWithSlips | null {
    return this.deps.retailBills.findById(id)
  }

  peekNextBillNo(): string {
    return this.deps.retailBills.peekNextBillNo(this.deps.settings.retailBillPrefix())
  }

  findById(id: string): RetailSaleWithItems | null {
    return this.deps.retailSales.findById(id)
  }

  /**
   * Finds a sale by whatever the operator typed into a search box.
   *
   * Tolerant on purpose. The number is a bare integer now, but the paper in the
   * customer's hand may say "RS-00007" from before the change, and the shop may
   * have set a display prefix since — so "7", "RS-7" and "RS-00007" all have to
   * reach invoice 7. `parseInvoiceNumber` takes the trailing digits, which is
   * the same rule migration 012 used to convert the stored values.
   */
  findByInvoiceNo(invoiceNo: string): RetailSaleWithItems | null {
    const number = parseInvoiceNumber(invoiceNo)
    return number === null ? null : this.deps.retailSales.findByInvoiceNumber(number)
  }

  /** Sales matching a date range, a customer and a status. Read-only. */
  list(filter: RetailSaleFilter): readonly RetailSale[] {
    return this.deps.retailSales.list(filter)
  }

  /** A preview of the next number, already carrying the shop's display prefix. */
  peekNextInvoiceNo(): string {
    return formatInvoiceNo(
      this.deps.retailSales.peekNextInvoiceNumber(),
      this.deps.settings.invoiceDisplayPrefix(),
    )
  }

  /** The prefix every screen and document puts in front of a number. */
  invoiceDisplayPrefix(): string {
    return this.deps.settings.invoiceDisplayPrefix()
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
