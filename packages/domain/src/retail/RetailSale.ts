import type { Money } from '../common/Money.js'
import type { Weight } from '../common/Weight.js'
import type { IsoDate, IsoTimestamp } from '../common/time.js'
import type { Purity } from '../rates/Purity.js'
import type { WastageBasis, WastageDirection } from './retailMath.js'

/**
 * A retail sale: one invoice to one customer, over the counter.
 *
 * The shape differs from a wholesale slip in three ways that matter, and each
 * one is why this is a separate entity rather than a flag on the other:
 *
 *   1. **A retail sale is priced in money, not settled in gold.** A wholesale
 *      slip creates a gold debt; a retail sale creates a bill. The gold on it
 *      is a quantity being sold, not a balance being carried.
 *   2. **The customer may be a walk-in with no account at all.** So the
 *      customer's name and mobile are SNAPSHOTTED onto the row. A sale must
 *      still print correctly in five years if the customer record is later
 *      renamed, merged or deleted — the invoice is a record of what happened,
 *      not a view joined onto current data.
 *   3. **It can be part-paid**, which is the only thing that touches a ledger,
 *      and only when there is an account to carry the balance.
 *
 * Money is integer paisa and weight is integer milligrams throughout, per
 * DECISIONS §2. There is no float anywhere near a total.
 */

export const PAYMENT_METHODS = ['cash', 'card', 'bank', 'credit'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value)
}

/**
 * Where a sale is in its life.
 *
 * `posted` is terminal in the sense that matters: a posted sale is never edited
 * (DECISIONS §6). It can only be voided, which leaves both the sale and the
 * reason on the record.
 */
export const SALE_STATUSES = ['draft', 'held', 'posted', 'void'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export function isSaleStatus(value: string): value is SaleStatus {
  return (SALE_STATUSES as readonly string[]).includes(value)
}

/** How a line's labour charge is quoted. */
export const LABOUR_MODES = ['fixed', 'per_tola'] as const
export type LabourMode = (typeof LABOUR_MODES)[number]

export function isLabourMode(value: string): value is LabourMode {
  return (LABOUR_MODES as readonly string[]).includes(value)
}

export interface RetailSaleItem {
  readonly id: string
  readonly saleId: string
  readonly lineNo: number
  readonly itemName: string
  readonly purity: Purity
  readonly grossWeight: Weight
  readonly stoneWeight: Weight
  /**
   * The purity deduction taken off this item, in milligrams. ABSOLUTE — see
   * RetailLineInput.purityDeduction. Stored per row so an invoice reprints
   * exactly whatever the field means later.
   */
  readonly purityDeduction: Weight
  readonly netWeight: Weight
  /** Basis points: 14.00% is 1400. Never a float — see DECISIONS §2. */
  readonly wastageBp: number
  readonly wastage: Weight
  /** What the customer is actually charged gold for. */
  readonly fineWeight: Weight
  readonly labourCharges: Money
  readonly labourMode: LabourMode
  readonly stoneCharges: Money
  /**
   * The rate this LINE was priced at. Zero means "not recorded" — see
   * migration 014 — and a reader falls back to the sale's header rate.
   *
   * Stored per line because the Rate cell is per item: a bill can hold a piece
   * at the board rate and another quoted keenly, and without this a reopened
   * invoice reprices itself at the header rate and stops matching the paper.
   */
  readonly ratePerTola: Money
  readonly lineAmount: Money
}

export interface RetailSale {
  readonly id: string
  /**
   * The number, as a bare integer. NEVER reset, NEVER reused.
   *
   * This is the identifier for a piece of paper that has already left the shop,
   * so a second document claiming the same number is not a bug that can be
   * fixed later — it is two customers holding the same invoice. The counter is
   * continuous for the life of the database and a voided number stays burned.
   *
   * Integer rather than the text below because a report has to ORDER BY it:
   * '10' sorts before '9' as text, which would put the tenth sale above the
   * ninth and send the operator to the wrong bill.
   */
  readonly invoiceNumber: number
  /**
   * The same value as text, which is what the UNIQUE constraint has always
   * been enforced on. Written in the same statement as `invoiceNumber` and
   * never separately, so the two cannot drift. Not for display — see
   * `formatInvoiceNo`, which is where the shop's prefix is applied.
   */
  readonly invoiceNo: string
  readonly branchId: string
  readonly saleDate: IsoDate
  /** Local wall-clock time, HH:MM. The counter cares what time it was. */
  readonly saleTime: string
  readonly customerId: string | null
  /** Snapshotted, so the invoice survives the customer record changing. */
  readonly customerNameSnapshot: string
  readonly customerMobileSnapshot: string | null
  readonly salesmanId: string | null
  readonly salesmanNameSnapshot: string | null
  readonly ratePurity: Purity
  readonly ratePerTola: Money
  readonly goldValue: Money
  /** Old gold the customer traded in against this sale. */
  readonly customerGold: Weight
  readonly customerGoldPurity: Purity | null
  readonly customerGoldValue: Money
  readonly hallmarkCharges: Money
  readonly otherCharges: Money
  readonly discount: Money
  readonly grandTotal: Money
  readonly amountPaid: Money
  readonly paymentMethod: PaymentMethod
  readonly balance: Money
  /** Rendered once at post time, so the paper and the screen never disagree. */
  readonly amountInWords: string
  readonly remarks: string | null
  readonly status: SaleStatus
  readonly voidReason: string | null
  /**
   * The draft this sale was posted from, if any.
   *
   * UNIQUE where not null. It is what makes posting idempotent across a
   * restart: a retry finds the sale that already exists instead of writing a
   * second invoice for one transaction.
   */
  readonly draftId: string | null
  /**
   * The bill this sale is a slip of, or null for a sale written before bills.
   *
   * Every invoice is now a bill with one implicit slip, so this is set on
   * everything new. It is read to answer one question: does the bill this
   * invoice belongs to hold OTHER slips? Bills written before the tab strip
   * came off can, and one of those must open read-only with a note rather than
   * silently showing its first slip as though that were the whole visit.
   */
  readonly billId: string | null
  /** The wastage rule this sale was PRICED with, so it always reprints the same. */
  readonly wastageDirection: WastageDirection
  readonly wastageBasis: WastageBasis
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
  readonly postedAt: IsoTimestamp | null
}

export interface RetailSaleWithItems {
  readonly sale: RetailSale
  readonly items: readonly RetailSaleItem[]
}

/** The label Slip 1 carries unless the operator renames it. */
export const DEFAULT_SLIP_LABEL = 'Full Bill'

/**
 * One customer visit, grouping several slips.
 *
 * A customer buys bangles, a chain and a pair of tops together and wants three
 * separate pieces of paper, because each is for a different person. That is one
 * visit producing several documents — and the bill is what says they were one
 * visit rather than three unrelated sales on the same afternoon.
 *
 * The customer, the mobile, the salesman, the date and the time live here
 * because they belong to the VISIT. Items, charges, discount and payment live
 * on each slip, because they belong to the document. Holding the shared facts
 * once is what stops two slips from the same visit disagreeing about who bought
 * them.
 *
 * The rate is deliberately NOT here. See migration 009: it stays on each slip
 * so a posted invoice reproduces from its own row and never depends on a parent.
 */
export interface RetailBill {
  readonly id: string
  readonly billNo: string
  readonly branchId: string
  readonly billDate: IsoDate
  readonly billTime: string
  readonly customerId: string | null
  readonly customerNameSnapshot: string
  readonly customerMobileSnapshot: string | null
  readonly salesmanId: string | null
  readonly salesmanNameSnapshot: string | null
  readonly status: SaleStatus
  readonly createdByUserId: string
  readonly createdAt: IsoTimestamp
  readonly postedAt: IsoTimestamp | null
}

/** A slip: a retail sale, plus where it sits in its bill. */
export interface RetailSlip extends RetailSaleWithItems {
  readonly slipNo: number
  readonly slipLabel: string
}

export interface RetailBillWithSlips {
  readonly bill: RetailBill
  /** In slip order, always. */
  readonly slips: readonly RetailSlip[]
}

/** A counter salesman, for attributing a sale. Not a system user. */
export interface Salesman {
  readonly id: string
  readonly name: string
  readonly isActive: boolean
}

export interface Customer {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly address: string | null
  readonly city: string | null
  readonly cnic: string | null
  /**
   * A walk-in has a row so the sale can point at a name, but no standing
   * account — which is why a walk-in sale must be paid in full (there is no
   * ledger to carry a balance on).
   */
  readonly isWalkIn: boolean
  readonly openingGold: Weight
  readonly openingCash: Money
}

export interface NewCustomer {
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly address: string | null
  readonly city: string | null
  readonly cnic: string | null
  readonly isWalkIn: boolean
  readonly openingGold: Weight
  readonly openingCash: Money
}
