import {
  Money,
  Weight,
  can,
  computeRetailInvoice,
  computeRetailLine,
  formatGram,
  formatPurity,
  formatTola,
  isLabourMode,
  isPaymentMethod,
  isPurity,
  isSaleStatus,
  parsePurity,
  parseTola,
  toIsoDate,
  totalsOfRetail,
  type IsoDate,
  type Permissions,
  type PublicUser,
  type Purity,
  type RetailLineComputed,
  type RetailSaleItem,
  type RetailSaleWithItems,
  type ShopProfile,
  type WastageRule,
} from '@jewellery/domain'
import {
  HighWastageRequiresConfirmationError,
  RETAIL_ROUNDING_STEPS,
  type CustomerService,
  type RetailItemInput,
  type RetailDraftInput,
  type RetailSaleService,
  type Settings,
} from '@jewellery/application'
import { buildRetailReceiptHtml, type RetailReceiptLine } from '@jewellery/printing'
import type {
  CustomerDto,
  MoneyDto,
  RetailBillCalculateRequest,
  RetailBillCalculationDto,
  RetailBillDraftDto,
  RetailBillPostResult,
  NewCustomerDto,
  RetailCalculateRequest,
  RetailCalculationDto,
  RetailItemDto,
  RetailDraftDto,
  RetailLineDto,
  RetailListRequest,
  RetailLoadRequest,
  RetailPostRequest,
  RetailPostResult,
  RetailRoundingDto,
  RetailSaleDto,
  RetailSlipDto,
  RetailSaleSummaryDto,
  SalesmanDto,
  WastageRuleChoice,
  WastageRuleDto,
  WeightDto,
  WeightFieldDto,
  WeightUnit,
} from '../shared/ipc.js'
import type { Session } from './session.js'

/**
 * Everything the retail channels do, with no Electron anywhere in the file.
 *
 * `retailIpc.ts` is a thin registration layer over these functions and holds no
 * logic of its own. The split is not decoration: `ipcMain.handle` cannot be
 * called without an Electron process, so a handler written inline in that file
 * can only be exercised by launching the app — which is exactly how a refusal
 * path ends up untested and then broken. These are plain functions over an
 * injected dependency bag, so every refusal below is checked with no database
 * and no window, the same rule the application layer lives under (DECISIONS §9).
 *
 * Three things every handler here does, without exception:
 *
 *   1. **Refuses without a session.** `created_by` is NOT NULL and a foreign key
 *      to `users`. A handler that cannot name a user must not write a row.
 *   2. **Never throws across the boundary.** An exception crossing IPC reaches
 *      the renderer as a rejected promise with a stringified stack; every
 *      failure here comes back as `{ ok: false, message }` a shopkeeper can read.
 *   3. **Computes nothing the post path would not compute.** `calculate` calls
 *      the same RetailSaleService the save path calls, so what the operator sees
 *      while typing is not an approximation of the invoice — it is the invoice.
 */

export interface RetailHandlerDeps {
  readonly branchId: string
  readonly retail: RetailSaleService
  readonly customers: CustomerService
  readonly settings: Settings
  /** For the printed document's letterhead. Null before the shop is set up. */
  readonly shopProfile: () => ShopProfile | null
  readonly session: Session
}

/** Turns any thrown error into a message a shopkeeper can act on. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

class RefusedError extends Error {}

function requireUser(deps: RetailHandlerDeps): PublicUser {
  const user = deps.session.user
  if (!user) {
    throw new RefusedError(
      'No user is signed in, so this entry could not be attributed to anybody. ' +
        'Restart the application.',
    )
  }
  return user
}

function requirePermission(deps: RetailHandlerDeps, permission: keyof Permissions): PublicUser {
  const user = requireUser(deps)
  if (!can(user.role, permission)) {
    throw new RefusedError(
      `${user.name} is signed in as ${user.role} and is not allowed to do this. ` +
        `Ask an administrator.`,
    )
  }
  return user
}

// ── parsing the wire types ──────────────────────────────────────────────────
//
// Everything crosses as the operator typed it and is parsed HERE, exactly once,
// by the domain's own exact parsers. No decimal ever becomes a float on the way
// in: `Weight.parse` and `Money.parse` pad strings rather than multiplying.

/**
 * A typed weight, in whichever unit the toggle is showing.
 *
 * `exactMg` wins when it is set, and that is what makes the Gram ⇄ Tola toggle
 * lossless — see the note on WeightFieldDto. Re-parsing the displayed text on
 * every flip would move the stored weight by up to 6 mg a time.
 */
function weightOf(field: WeightFieldDto | null | undefined, unit: WeightUnit): Weight {
  if (!field) return Weight.ZERO
  if (field.exactMg !== null && field.exactMg !== undefined) {
    return Weight.fromMilligrams(field.exactMg)
  }
  const text = field.text.trim()
  if (text === '') return Weight.ZERO
  return unit === 'tola' ? parseTola(text) : Weight.parse(text)
}

function moneyOf(text: string | null | undefined): Money {
  const trimmed = (text ?? '').trim()
  return trimmed === '' ? Money.ZERO : Money.parse(trimmed)
}

/** Tolerant of half-typed input, which is the normal state of a live screen. */
function moneyOrZero(text: string | null | undefined): Money {
  try {
    return moneyOf(text)
  } catch {
    return Money.ZERO
  }
}

function weightOrZero(field: WeightFieldDto | null | undefined, unit: WeightUnit): Weight {
  try {
    return weightOf(field, unit)
  } catch {
    return Weight.ZERO
  }
}

/**
 * A percentage to two places, as basis points. 14.00% is 1400, never 0.14.
 *
 * Money's rupee-to-paisa parser IS this conversion — the same exact ×100 with
 * the same refusal of a third decimal — so it is reused rather than written a
 * second time and left to drift.
 */
function basisPointsOf(text: string | null | undefined): number {
  const trimmed = (text ?? '').trim()
  return trimmed === '' ? 0 : Money.parse(trimmed).paisa
}

function purityOf(value: string | null | undefined, fallback: Purity): Purity {
  return value && isPurity(value) ? parsePurity(value) : fallback
}

function unitOf(draft: RetailDraftDto): WeightUnit {
  return draft.weightUnit === 'tola' ? 'tola' : 'gram'
}

function parseItem(dto: RetailItemDto, unit: WeightUnit, ratePurity: Purity): RetailItemInput {
  return {
    itemName: dto.itemName,
    purity: purityOf(dto.purity, ratePurity),
    grossWeight: weightOf(dto.grossWeight, unit),
    stoneWeight: weightOf(dto.stoneWeight, unit),
    cutPerTola: weightOf(dto.cutPerTola, unit),
    wastageBp: basisPointsOf(dto.wastagePercent),
    labourCharges: moneyOf(dto.labourCharges),
    labourMode: isLabourMode(dto.labourMode) ? dto.labourMode : 'fixed',
    stoneCharges: moneyOf(dto.stoneCharges),
  }
}

/**
 * The draft, with the items already parsed.
 *
 * Money fields are read tolerantly on the calculate path and strictly on the
 * save path, which is the difference between the two callers: a half-typed
 * discount must not blow up a keystroke, and must absolutely not be silently
 * treated as zero when the sale is committed.
 */
function draftInput(
  deps: RetailHandlerDeps,
  draft: RetailDraftDto,
  items: readonly RetailItemInput[],
  strict: boolean,
): RetailDraftInput {
  const unit = unitOf(draft)
  const money = strict ? moneyOf : moneyOrZero
  const weight = strict
    ? (field: WeightFieldDto | null | undefined) => weightOf(field, unit)
    : (field: WeightFieldDto | null | undefined) => weightOrZero(field, unit)
  const ratePurity = purityOf(draft.ratePurity, 'K22')
  const override = money(draft.ratePerTolaOverride)

  return {
    branchId: deps.branchId,
    saleDate: isoDateOf(draft.saleDate),
    saleTime: draft.saleTime,
    customerId: draft.customerId,
    customerName: draft.customerName,
    customerMobile: draft.customerMobile?.trim() ? draft.customerMobile.trim() : null,
    salesmanId: draft.salesmanId,
    ratePurity,
    // An empty box means "use the recorded rate", not "price this at nothing".
    ...(override.isPositive ? { ratePerTolaOverride: override } : {}),
    items,
    customerGold: weight(draft.customerGold),
    customerGoldPurity: draft.customerGoldPurity
      ? purityOf(draft.customerGoldPurity, ratePurity)
      : null,
    hallmarkCharges: money(draft.hallmarkCharges),
    otherCharges: money(draft.otherCharges),
    discount: money(draft.discount),
    amountPaid: money(draft.amountPaid),
    paymentMethod: isPaymentMethod(draft.paymentMethod) ? draft.paymentMethod : 'cash',
    remarks: draft.remarks?.trim() ? draft.remarks.trim() : null,
    ...(draft.confirmedHighWastage === true ? { confirmedHighWastage: true } : {}),
    ...(draft.draftId ? { draftId: draft.draftId } : {}),
  }
}

/** A malformed date must not silently become the first of January. */
function isoDateOf(value: string): IsoDate {
  return toIsoDate(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : todayIsoFallback())
}

function todayIsoFallback(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// ── building the wire types ─────────────────────────────────────────────────

function weightDto(weight: Weight): WeightDto {
  // Both units, computed here so a unit toggle in the renderer is a choice
  // between two strings it was already given rather than a conversion it does.
  return { mg: weight.milligrams, gram: formatGram(weight), tola: formatTola(weight) }
}

function moneyDto(amount: Money): MoneyDto {
  return { paisa: amount.paisa, rupees: amount.format(), whole: amount.formatWhole() }
}

function lineDto(computed: RetailLineComputed, purity: Purity): RetailLineDto {
  return {
    itemName: computed.itemName,
    purity: formatPurity(purity),
    purityCode: purity,
    gross: weightDto(computed.grossWeight),
    stone: weightDto(computed.stoneWeight),
    cutPerTola: weightDto(computed.cutPerTola),
    net: weightDto(computed.netWeight),
    wastagePercent: (computed.wastageBp / 100).toFixed(2),
    wastage: weightDto(computed.wastage),
    fine: weightDto(computed.fineWeight),
    labour: moneyDto(computed.labourAmount),
    labourMode: computed.labourMode,
    stoneCharges: moneyDto(computed.stoneCharges),
    amount: moneyDto(computed.lineAmount),
    error: null,
  }
}

function emptyLineDto(dto: RetailItemDto, error: string | null): RetailLineDto {
  const zeroWeight = weightDto(Weight.ZERO)
  const zeroMoney = moneyDto(Money.ZERO)
  return {
    itemName: dto.itemName,
    purity: isPurity(dto.purity) ? formatPurity(dto.purity) : '—',
    purityCode: dto.purity,
    gross: zeroWeight,
    stone: zeroWeight,
    cutPerTola: zeroWeight,
    net: zeroWeight,
    wastagePercent: '0.00',
    wastage: zeroWeight,
    fine: zeroWeight,
    labour: zeroMoney,
    labourMode: dto.labourMode,
    stoneCharges: zeroMoney,
    amount: zeroMoney,
    error,
  }
}

/** The rule in the words the settings card uses, so both say the same thing. */
export function labelOfRule(rule: WastageRule): string {
  const direction = rule.direction === 'add' ? 'added to' : 'taken out of'
  const basis = rule.basis === 'gross' ? 'gross' : 'net'
  return `Wastage ${direction} net weight, calculated on ${basis} weight`
}

// ── the handlers ────────────────────────────────────────────────────────────

/**
 * Everything the screen shows, from a draft. Pure — it writes nothing.
 *
 * Called on every keystroke, so it is deliberately tolerant: a row that cannot
 * be parsed yet reports its own error and contributes nothing to the totals
 * rather than failing the whole response. Half-typed input is the normal state
 * of this screen, not an exceptional one.
 */
export function retailCalculate(
  deps: RetailHandlerDeps,
  request: RetailCalculateRequest,
): RetailCalculationDto {
  const draft = request.draft
  const unit = unitOf(draft)
  const ratePurity = purityOf(draft.ratePurity, 'K22')

  const parsed = draft.items.map((dto) => {
    try {
      return { dto, input: parseItem(dto, unit, ratePurity), error: null as string | null }
    } catch (error) {
      return { dto, input: null, error: messageOf(error) }
    }
  })

  const valid = parsed.flatMap((row) => (row.input ? [row.input] : []))
  const calculation = deps.retail.calculate(draftInput(deps, draft, valid, false))

  let cursor = 0
  const lines = parsed.map((row) => {
    if (!row.input) return emptyLineDto(row.dto, row.error)
    const computed = calculation.lines[cursor++]
    return computed ? lineDto(computed, row.input.purity) : emptyLineDto(row.dto, null)
  })

  // The row being typed. Computed by the SAME service against the same rate and
  // the same rule, then deliberately kept out of the totals — it has not been
  // added to the sale yet, and a total that already counted it would be a lie
  // the moment the operator abandoned the row.
  let entry: RetailLineDto | null = null
  if (request.entry) {
    try {
      const input = parseItem(request.entry, unit, ratePurity)
      const one = deps.retail.calculate(draftInput(deps, draft, [input], false))
      const computed = one.lines[0]
      entry = computed ? lineDto(computed, input.purity) : emptyLineDto(request.entry, null)
    } catch (error) {
      entry = emptyLineDto(request.entry, messageOf(error))
    }
  }

  const rateMissing = !calculation.ratePerTola.isPositive

  return {
    lines,
    entry,
    totalFine: weightDto(calculation.totalFine),
    customerGold: weightDto(weightOrZero(draft.customerGold, unit)),
    remainingGold: weightDto(calculation.remainingGold),
    goldValue: moneyDto(calculation.goldValue),
    totalLabour: moneyDto(calculation.totalLabour),
    totalStone: moneyDto(calculation.totalStone),
    itemsTotal: moneyDto(calculation.itemsTotal),
    hallmarkCharges: moneyDto(moneyOrZero(draft.hallmarkCharges)),
    otherCharges: moneyDto(moneyOrZero(draft.otherCharges)),
    discount: moneyDto(moneyOrZero(draft.discount)),
    customerGoldValue: moneyDto(calculation.customerGoldValue),
    invoiceTotal: moneyDto(calculation.invoiceTotal),
    grandTotal: moneyDto(calculation.grandTotal),
    amountPaid: moneyDto(moneyOrZero(draft.amountPaid)),
    balance: moneyDto(calculation.balance),
    amountInWords: calculation.amountInWords,
    ratePerTola: moneyDto(calculation.ratePerTola),
    // Shown as missing, never as a zero. Pricing gold at nothing is invisible
    // on the invoice and wrong in the ledger (DECISIONS §7).
    rateDisplay: rateMissing ? null : calculation.ratePerTola.formatWhole(),
    rateMissing,
    wastageRuleLabel: labelOfRule(calculation.rule),
    warnings: calculation.warnings,
  }
}

export function retailSave(
  deps: RetailHandlerDeps,
  request: RetailPostRequest,
): RetailPostResult {
  return commit(deps, request, 'posted')
}

export function retailHold(
  deps: RetailHandlerDeps,
  request: RetailPostRequest,
): RetailPostResult {
  return commit(deps, request, 'held')
}

function commit(
  deps: RetailHandlerDeps,
  request: RetailPostRequest,
  status: 'posted' | 'held',
): RetailPostResult {
  try {
    const user = requireUser(deps)
    const draft = request.draft
    if (!draft.draftId || draft.draftId.trim() === '') {
      // Without it, a retry after a reply that never arrived writes a second
      // invoice for one transaction. See migration 008.
      return {
        ok: false,
        message: 'This sale has no draft id, so saving it twice could not be prevented.',
      }
    }
    const unit = unitOf(draft)
    const ratePurity = purityOf(draft.ratePurity, 'K22')
    const items = draft.items.map((dto) => parseItem(dto, unit, ratePurity))
    const input = draftInput(deps, draft, items, true)

    const written =
      status === 'posted' ? deps.retail.post(user, input) : deps.retail.hold(user, input)

    return {
      ok: true,
      saleId: written.sale.id,
      invoiceNo: written.sale.invoiceNo,
      status: written.sale.status,
      grandTotal: written.sale.grandTotal.format(),
      balance: written.sale.balance.format(),
      amountInWords: written.sale.amountInWords,
    }
  } catch (error) {
    // Distinguished from a plain failure so the screen shows a question with a
    // Continue button rather than an error the operator can only dismiss.
    if (error instanceof HighWastageRequiresConfirmationError) {
      return { ok: false, needsConfirmation: true, message: error.consequence }
    }
    return { ok: false, message: messageOf(error) }
  }
}

export function retailLoad(
  deps: RetailHandlerDeps,
  reference: RetailLoadRequest,
): RetailSaleDto | null {
  try {
    requireUser(deps)
    const found = reference.saleId
      ? deps.retail.findById(reference.saleId)
      : reference.invoiceNo
        ? deps.retail.findByInvoiceNo(reference.invoiceNo)
        : null
    return found ? saleDto(found) : null
  } catch {
    return null
  }
}

export function retailList(
  deps: RetailHandlerDeps,
  filter: RetailListRequest,
): readonly RetailSaleSummaryDto[] {
  try {
    requireUser(deps)
    return deps.retail
      .list({
        branchId: deps.branchId,
        ...(filter.fromDate ? { fromDate: isoDateOf(filter.fromDate) } : {}),
        ...(filter.toDate ? { toDate: isoDateOf(filter.toDate) } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.status && isSaleStatus(filter.status) ? { status: filter.status } : {}),
        limit: clampLimit(filter.limit),
      })
      .map((sale) => ({
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        date: sale.saleDate,
        time: sale.saleTime,
        customerName: sale.customerNameSnapshot,
        salesmanName: sale.salesmanNameSnapshot,
        grandTotal: sale.grandTotal.format(),
        balance: sale.balance.format(),
        status: sale.status,
      }))
  } catch {
    return []
  }
}

/** A list request is a read, so a bad limit is clamped rather than refused. */
function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) return 100
  return Math.min(limit, 500)
}

/**
 * Voids a posted sale.
 *
 * Permission-checked, because this is the one retail action that changes what
 * the books already say. A salesman may sell all day and may not unsell.
 */
export function retailVoid(
  deps: RetailHandlerDeps,
  saleId: string,
  reason: string,
): { ok: true } | { ok: false; message: string } {
  try {
    const user = requirePermission(deps, 'canReverseTransactions')
    deps.retail.void(user, saleId, reason)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function retailNextInvoiceNo(deps: RetailHandlerDeps): string {
  try {
    return deps.retail.peekNextInvoiceNo()
  } catch {
    return '—'
  }
}

export function retailReceipt(deps: RetailHandlerDeps, saleId: string): string | null {
  try {
    requireUser(deps)
    const found = deps.retail.findById(saleId)
    if (!found) return null
    const shop = deps.shopProfile()
    return buildRetailReceiptHtml({
      shop: {
        name: shop?.name ?? 'GOLD JEWELLERS',
        tagline: shop?.tagline ?? null,
        ownerName: shop?.ownerName ?? null,
        phone1: shop?.phone1 ?? null,
        phone2: shop?.phone2 ?? null,
        address: shop?.address ?? null,
      },
      invoiceNo: found.sale.invoiceNo,
      date: found.sale.saleDate,
      time: found.sale.saleTime,
      customerName: found.sale.customerNameSnapshot,
      customerMobile: found.sale.customerMobileSnapshot,
      salesmanName: found.sale.salesmanNameSnapshot,
      ratePurity: formatPurity(found.sale.ratePurity),
      ratePerTola: found.sale.ratePerTola,
      lines: found.items.map(receiptLine(found)),
      totalFine: totalFineOf(found),
      itemsTotal: itemsTotalOf(found),
      hallmarkCharges: found.sale.hallmarkCharges,
      otherCharges: found.sale.otherCharges,
      discount: found.sale.discount,
      customerGold: found.sale.customerGold,
      customerGoldValue: found.sale.customerGoldValue,
      grandTotal: found.sale.grandTotal,
      amountPaid: found.sale.amountPaid,
      balance: found.sale.balance,
      amountInWords: found.sale.amountInWords,
      remarks: found.sale.remarks,
      wastageRuleLabel: labelOfRule({
        direction: found.sale.wastageDirection,
        basis: found.sale.wastageBasis,
      }),
      printedAt: null,
    })
  } catch {
    return null
  }
}

/**
 * A stored item, as a line of paper.
 *
 * Every weight and every amount comes straight off the row. The ONE figure that
 * is not stored is the labour actually charged — a per-tola quote is stored as
 * the quote, not as the resulting amount — so it is recovered by running the
 * stored inputs back through the same domain function that priced them, with
 * the rule and the rate the sale itself carries. That is exactly the operation
 * the reprint-after-a-rule-change test proves is stable.
 */
function receiptLine(sale: RetailSaleWithItems) {
  return (item: RetailSaleItem): RetailReceiptLine => {
    const repriced = computeRetailLine(
      {
        itemName: item.itemName,
        grossWeight: item.grossWeight,
        stoneWeight: item.stoneWeight,
        cutPerTola: item.cutPerTola,
        wastageBp: item.wastageBp,
        labourCharges: item.labourCharges,
        labourMode: item.labourMode,
        stoneCharges: item.stoneCharges,
        ratePerTola: sale.sale.ratePerTola,
      },
      { direction: sale.sale.wastageDirection, basis: sale.sale.wastageBasis },
    )
    return {
      lineNo: item.lineNo,
      itemName: item.itemName,
      purity: formatPurity(item.purity),
      gross: item.grossWeight,
      net: item.netWeight,
      wastage: item.wastage,
      fine: item.fineWeight,
      labour: repriced.labourAmount,
      stoneCharges: item.stoneCharges,
      amount: item.lineAmount,
    }
  }
}

function totalFineOf(sale: RetailSaleWithItems): Weight {
  return Weight.sum(sale.items.map((item) => item.fineWeight))
}

function itemsTotalOf(sale: RetailSaleWithItems): Money {
  return Money.sum(sale.items.map((item) => item.lineAmount))
}

function saleDto(found: RetailSaleWithItems): RetailSaleDto {
  return {
    summary: {
      saleId: found.sale.id,
      invoiceNo: found.sale.invoiceNo,
      date: found.sale.saleDate,
      time: found.sale.saleTime,
      customerName: found.sale.customerNameSnapshot,
      salesmanName: found.sale.salesmanNameSnapshot,
      grandTotal: found.sale.grandTotal.format(),
      balance: found.sale.balance.format(),
      status: found.sale.status,
    },
    lines: found.items.map((item) => {
      const repriced = computeRetailLine(
        {
          itemName: item.itemName,
          grossWeight: item.grossWeight,
          stoneWeight: item.stoneWeight,
          cutPerTola: item.cutPerTola,
          wastageBp: item.wastageBp,
          labourCharges: item.labourCharges,
          labourMode: item.labourMode,
          stoneCharges: item.stoneCharges,
          ratePerTola: found.sale.ratePerTola,
        },
        { direction: found.sale.wastageDirection, basis: found.sale.wastageBasis },
      )
      return {
        ...lineDto(repriced, item.purity),
        // The STORED figures win over the recomputed ones. They are the same by
        // construction; preferring the row means a reprint shows what was
        // written even if that construction is ever changed underneath it.
        gross: weightDto(item.grossWeight),
        net: weightDto(item.netWeight),
        wastage: weightDto(item.wastage),
        fine: weightDto(item.fineWeight),
        amount: moneyDto(item.lineAmount),
      }
    }),
    totalFine: weightDto(totalFineOf(found)),
    amountInWords: found.sale.amountInWords,
    ratePurity: formatPurity(found.sale.ratePurity),
    ratePerTola: moneyDto(found.sale.ratePerTola),
    customerMobile: found.sale.customerMobileSnapshot,
    paymentMethod: found.sale.paymentMethod,
    amountPaid: moneyDto(found.sale.amountPaid),
    remarks: found.sale.remarks,
    wastageRuleLabel: labelOfRule({
      direction: found.sale.wastageDirection,
      basis: found.sale.wastageBasis,
    }),
  }
}

// ── customers and salesmen ──────────────────────────────────────────────────

export function customerSearch(
  deps: RetailHandlerDeps,
  query: string,
): readonly CustomerDto[] {
  try {
    requireUser(deps)
    return deps.customers.search(query).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      mobile: row.mobile,
      city: row.city,
      isWalkIn: row.isWalkIn,
    }))
  } catch {
    return []
  }
}

export function customerCreate(
  deps: RetailHandlerDeps,
  input: NewCustomerDto,
): { ok: true; customer: CustomerDto } | { ok: false; message: string } {
  try {
    const user = requireUser(deps)
    const created = input.isWalkIn
      ? deps.customers.createWalkIn(user, input.name, input.mobile.trim() || null)
      : deps.customers.create(user, {
          name: input.name,
          mobile: input.mobile.trim() || null,
          address: input.address.trim() || null,
          city: input.city.trim() || null,
          cnic: input.cnic.trim() || null,
          // Parsed here, at the edge, from the string the operator typed.
          openingGold: input.openingGoldGrams.trim()
            ? Weight.parse(input.openingGoldGrams)
            : Weight.ZERO,
          openingCash: input.openingCashRupees.trim()
            ? Money.parse(input.openingCashRupees)
            : Money.ZERO,
        })
    return {
      ok: true,
      customer: {
        id: created.id,
        code: created.code,
        name: created.name,
        mobile: created.mobile,
        city: created.city,
        isWalkIn: created.isWalkIn,
      },
    }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function salesmenList(deps: RetailHandlerDeps): readonly SalesmanDto[] {
  try {
    requireUser(deps)
    return deps.retail.salesmen().map((row) => ({ id: row.id, name: row.name }))
  } catch {
    return []
  }
}

// ── the wastage rule picker ─────────────────────────────────────────────────

/**
 * The worked example on the Settings card.
 *
 * Fixed sample inputs, run through `computeRetailLine` — the SAME function that
 * prices a real line — for all four combinations. There is deliberately no
 * second copy of this arithmetic anywhere: a settings card that demonstrated
 * the rule with its own maths could show one answer while the till charged
 * another, which is the exact failure the card exists to prevent.
 */
const RATE_RUPEES_PER_TOLA = '237970'

interface Sample {
  readonly title: string
  readonly note: string | null
  readonly grossTola: string
  readonly stoneTola: string
  readonly cutTola: string
  readonly wastagePercent: string
}

/**
 * Two samples, and the second one is load-bearing.
 *
 * The first is the piece from the brief. On it, stone and cut are both zero —
 * so NET WEIGHT EQUALS GROSS WEIGHT, and "calculated on gross" and "calculated
 * on net" produce byte-identical invoices. A card offering four rules that only
 * ever shows two answers cannot help anybody match a past invoice, which is the
 * entire job it was given.
 *
 * The second is the same piece with a stone in it, which is what separates
 * them. Both are shown, because the first is the one the shop was asked about
 * and the second is the one that answers the question.
 */
const SAMPLES: readonly Sample[] = [
  {
    title: 'A plain piece',
    note: null,
    grossTola: '4.050',
    stoneTola: '0.000',
    cutTola: '0.000',
    wastagePercent: '14.00',
  },
  {
    title: 'The same piece with a 0.250-tola stone',
    note:
      'With no stone and no cut, gross weight and net weight are the same number, so the ' +
      'two “calculated on” options give the same answer above. A stone is what separates ' +
      'them — check this table against an invoice for a stone-set piece.',
    grossTola: '4.050',
    stoneTola: '0.250',
    cutTola: '0.000',
    wastagePercent: '14.00',
  },
]

const RULE_LABELS: Readonly<Record<string, string>> = {
  'add/net': 'Added to net weight, calculated on net weight',
  'add/gross': 'Added to net weight, calculated on gross weight',
  'subtract/net': 'Taken out of net weight, calculated on net weight',
  'subtract/gross': 'Taken out of net weight, calculated on gross weight',
}

export function retailWastageRule(
  deps: RetailHandlerDeps,
  selection: WastageRuleChoice | null,
): WastageRuleDto {
  const savedDirection = deps.settings.retailWastageDirection()
  const savedBasis = deps.settings.retailWastageBasis()
  const chosenDirection = selection?.direction ?? savedDirection
  const chosenBasis = selection?.basis ?? savedBasis
  const rate = Money.parse(RATE_RUPEES_PER_TOLA)

  const examples = SAMPLES.map((sample) => ({
    title: sample.title,
    note: sample.note,
    sample: {
      grossTola: sample.grossTola,
      stoneTola: sample.stoneTola,
      cutTola: sample.cutTola,
      wastagePercent: sample.wastagePercent,
      rateDisplay: `Rs ${rate.formatWhole()}/tola`,
    },
    options: (['add', 'subtract'] as const).flatMap((direction) =>
      (['net', 'gross'] as const).map((basis) => {
        const computed = computeRetailLine(
          {
            itemName: 'Sample',
            grossWeight: parseTola(sample.grossTola),
            stoneWeight: parseTola(sample.stoneTola),
            cutPerTola: parseTola(sample.cutTola),
            wastageBp: basisPointsOf(sample.wastagePercent),
            labourCharges: Money.ZERO,
            labourMode: 'fixed' as const,
            stoneCharges: Money.ZERO,
            ratePerTola: rate,
          },
          { direction, basis },
        )
        return {
          direction,
          basis,
          label: RULE_LABELS[`${direction}/${basis}`] ?? `${direction}/${basis}`,
          wastageDisplay: `${formatTola(computed.wastage)} tola`,
          fineDisplay: `${formatTola(computed.fineWeight)} tola`,
          amountDisplay: `Rs ${computed.lineAmount.formatWhole()}`,
          isSaved: direction === savedDirection && basis === savedBasis,
          isSelected: direction === chosenDirection && basis === chosenBasis,
        }
      }),
    ),
  }))

  return { savedDirection, savedBasis, examples }
}

/**
 * Records the shop's choice.
 *
 * Permission-checked against `canSetGoldRate` — the closest thing the role model
 * has to "may change something that re-prices everything sold from now on", and
 * for the same reason it exists. It does NOT re-price anything already sold:
 * every posted sale carries its own rule on its own row (migration 006).
 */
export function retailWastageRuleSet(
  deps: RetailHandlerDeps,
  rule: WastageRuleChoice,
): { ok: true } | { ok: false; message: string } {
  try {
    requirePermission(deps, 'canSetGoldRate')
    deps.settings.setRetailWastageRule(rule.direction, rule.basis)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

// ── bills, which group slips ────────────────────────────────────────────────

/**
 * A slip, expressed as the draft the existing calculate path already handles.
 *
 * This is the whole trick of the bill layer: a slip IS a retail sale, so every
 * figure on it is produced by the SAME `retail.calculate` the single-sale screen
 * used. There is no second calculation for slips, and therefore no second
 * calculation that can disagree with the one that prices the invoice.
 */
function draftOfSlip(bill: RetailBillDraftDto, slip: RetailSlipDto): RetailDraftDto {
  return {
    draftId: slip.draftId,
    saleDate: bill.saleDate,
    saleTime: bill.saleTime,
    customerId: bill.customerId,
    customerName: bill.customerName,
    customerMobile: bill.customerMobile,
    salesmanId: bill.salesmanId,
    ratePurity: bill.ratePurity,
    ratePerTolaOverride: bill.ratePerTolaOverride,
    weightUnit: bill.weightUnit,
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
  }
}

/**
 * Every slip in the bill, computed. Pure — writes nothing.
 *
 * Called on every keystroke like `retailCalculate`, and just as tolerant: a
 * half-typed slip reports its own errors and still answers. The entry row is
 * computed for the ACTIVE slip only, because that is the only one with a DETAILS
 * form open.
 */
export function retailBillCalculate(
  deps: RetailHandlerDeps,
  request: RetailBillCalculateRequest,
): RetailBillCalculationDto {
  const bill = request.draft
  const slips = bill.slips.map((slip) => {
    const calculation = retailCalculate(deps, {
      draft: draftOfSlip(bill, slip),
      entry: slip.slipNo === request.activeSlipNo ? request.entry : null,
    })
    return {
      slipNo: slip.slipNo,
      slipLabel: slip.slipLabel,
      calculation,
      // The tab's own figure. Preformatted here, like every other number that
      // crosses this boundary.
      total: calculation.invoiceTotal.rupees,
    }
  })

  const active =
    slips.find((slip) => slip.slipNo === request.activeSlipNo)?.calculation ??
    slips[0]?.calculation ??
    retailCalculate(deps, {
      draft: draftOfSlip(bill, emptySlip()),
      entry: request.entry,
    })

  const billTotal = Money.fromPaisa(
    slips.reduce((sum, slip) => sum + slip.calculation.invoiceTotal.paisa, 0),
  )

  return {
    slips,
    active,
    billTotal: moneyDto(billTotal),
    rateDisplay: active.rateDisplay,
    rateMissing: active.rateMissing,
  }
}

/** A bill with no slips is not a real state, but a keystroke can produce one. */
function emptySlip(): RetailSlipDto {
  return {
    slipNo: 1,
    slipLabel: 'Full Bill',
    draftId: '',
    items: [],
    customerGold: { text: '', exactMg: null },
    customerGoldPurity: null,
    hallmarkCharges: '',
    otherCharges: '',
    discount: '',
    amountPaid: '',
    paymentMethod: 'cash',
    remarks: null,
  }
}

/**
 * Posts every slip in the bill, in ONE transaction.
 *
 * Nothing here decides atomicity — the repository does, in a single
 * `db.transaction`. What this does is refuse before writing: a slip with no
 * draft id cannot be made idempotent, and a bill that is half-idempotent is
 * worse than one that is not, because the retry writes some of it twice.
 */
export function retailBillSave(
  deps: RetailHandlerDeps,
  request: { draft: RetailBillDraftDto },
): RetailBillPostResult {
  try {
    const user = requireUser(deps)
    const bill = request.draft

    if (bill.slips.length === 0) {
      return { ok: false, message: 'Add at least one slip before saving this bill.' }
    }
    for (const slip of bill.slips) {
      if (!slip.draftId || slip.draftId.trim() === '') {
        return {
          ok: false,
          message:
            `Slip ${slip.slipNo} has no draft id, so saving this bill twice could not ` +
            `be prevented.`,
        }
      }
    }

    const unit = unitOf(bill as unknown as RetailDraftDto)
    const ratePurity = purityOf(bill.ratePurity, 'K22')
    const override = moneyOf(bill.ratePerTolaOverride)

    const written = deps.retail.postBill(user, {
      branchId: deps.branchId,
      saleDate: isoDateOf(bill.saleDate),
      saleTime: bill.saleTime,
      customerId: bill.customerId,
      customerName: bill.customerName,
      customerMobile: bill.customerMobile?.trim() ? bill.customerMobile.trim() : null,
      salesmanId: bill.salesmanId,
      ratePurity,
      ...(override.isPositive ? { ratePerTolaOverride: override } : {}),
      ...(bill.confirmedHighWastage === true ? { confirmedHighWastage: true } : {}),
      slips: bill.slips.map((slip) => ({
        slipNo: slip.slipNo,
        slipLabel: slip.slipLabel,
        draftId: slip.draftId,
        items: slip.items.map((dto) => parseItem(dto, unit, ratePurity)),
        customerGold: weightOf(slip.customerGold, unit),
        customerGoldPurity: slip.customerGoldPurity
          ? purityOf(slip.customerGoldPurity, ratePurity)
          : null,
        hallmarkCharges: moneyOf(slip.hallmarkCharges),
        otherCharges: moneyOf(slip.otherCharges),
        discount: moneyOf(slip.discount),
        amountPaid: moneyOf(slip.amountPaid),
        paymentMethod: isPaymentMethod(slip.paymentMethod) ? slip.paymentMethod : 'cash',
        remarks: slip.remarks?.trim() ? slip.remarks.trim() : null,
      })),
    })

    return {
      ok: true,
      billId: written.bill.id,
      billNo: written.bill.billNo,
      slips: written.slips.map((slip) => ({
        slipNo: slip.slipNo,
        slipLabel: slip.slipLabel,
        saleId: slip.sale.id,
        invoiceNo: slip.sale.invoiceNo,
      })),
      billTotal: Money.sum(
        written.slips.map((slip) => slip.sale.grandTotal),
      ).format(),
    }
  } catch (error) {
    if (error instanceof HighWastageRequiresConfirmationError) {
      return { ok: false, needsConfirmation: true, message: error.consequence }
    }
    return { ok: false, message: messageOf(error) }
  }
}

export function retailBillNextNo(deps: RetailHandlerDeps): string {
  try {
    return deps.retail.peekNextBillNo()
  } catch {
    return '—'
  }
}

/**
 * Every slip in a bill, as ONE print job.
 *
 * Each slip's document is built by the same `retailReceipt` that prints it
 * alone, and they are concatenated with a page break between them. That is the
 * whole of "Print full bill": there is no second receipt template, so a slip
 * printed with the bill is byte-identical to the same slip printed on its own.
 */
export function retailBillReceipt(deps: RetailHandlerDeps, billId: string): string | null {
  try {
    requireUser(deps)
    const found = deps.retail.findBillById(billId)
    if (!found || found.slips.length === 0) return null

    const documents = found.slips
      .map((slip) => retailReceipt(deps, slip.sale.id))
      .filter((html): html is string => html !== null)
    if (documents.length === 0) return null

    return joinReceipts(documents)
  } catch {
    return null
  }
}

/**
 * Splices several complete receipt documents into one printable page.
 *
 * The bodies are lifted out and stacked inside the FIRST document's shell, so
 * the 80mm page setup, the fonts and the styles are the ones the printer
 * already gets — rather than a second wrapper built here that could drift from
 * the real one.
 */
function joinReceipts(documents: readonly string[]): string {
  const first = documents[0] as string
  if (documents.length === 1) return first

  const bodyOf = (html: string): string => {
    const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)
    return match?.[1] ?? html
  }

  const bodies = documents
    .map(
      (html, index) =>
        `<div class="slip-page"${index > 0 ? ' style="page-break-before: always;"' : ''}>` +
        `${bodyOf(html)}</div>`,
    )
    .join('\n')

  return first.replace(/<body([^>]*)>[\s\S]*<\/body>/i, `<body$1>${bodies}</body>`)
}

// ── the rounding step ───────────────────────────────────────────────────────

/**
 * What each rounding step does to one worked invoice.
 *
 * The same shape as the wastage card and for the same reason: the figures come
 * from `computeRetailInvoice`, the function that totals a real sale, so the card
 * cannot demonstrate one rule while the till applies another.
 *
 * The sample is the first wastage sample priced under the SAVED wastage rule —
 * not a fixed number — because a rounding card showing a total the shop's own
 * rule would never produce is a card nobody can check against a real slip.
 */
const ROUNDING_NOTES: Readonly<Record<number, string>> = {
  1: 'No rounding. The total stands exactly as computed, to the paisa.',
  100: 'The total lands on a round hundred rupees.',
  1000: 'The total lands on a round thousand rupees.',
}

function roundingSampleTotal(deps: RetailHandlerDeps, step: number): Money {
  const sample = SAMPLES[0] as Sample
  const line = computeRetailLine(
    {
      itemName: 'Sample',
      grossWeight: parseTola(sample.grossTola),
      stoneWeight: parseTola(sample.stoneTola),
      cutPerTola: parseTola(sample.cutTola),
      wastageBp: basisPointsOf(sample.wastagePercent),
      labourCharges: Money.ZERO,
      labourMode: 'fixed',
      stoneCharges: Money.ZERO,
      ratePerTola: Money.parse(RATE_RUPEES_PER_TOLA),
    },
    {
      direction: deps.settings.retailWastageDirection(),
      basis: deps.settings.retailWastageBasis(),
    },
  )
  return computeRetailInvoice({
    totals: totalsOfRetail([line]),
    customerGold: Weight.ZERO,
    customerGoldRatePerTola: null,
    hallmarkCharges: Money.ZERO,
    otherCharges: Money.ZERO,
    discount: Money.ZERO,
    amountPaid: Money.ZERO,
    roundingNearestRupees: step,
  }).invoiceTotal
}

export function retailRounding(deps: RetailHandlerDeps): RetailRoundingDto {
  const savedStep = deps.settings.retailRoundingNearest()
  return {
    savedStep,
    exactDisplay: `Rs ${roundingSampleTotal(deps, 1).format()}`,
    options: RETAIL_ROUNDING_STEPS.map((step) => ({
      step,
      label: step === 1 ? 'Exact — no rounding' : `Nearest Rs ${step}`,
      note: ROUNDING_NOTES[step] ?? '',
      totalDisplay: `Rs ${roundingSampleTotal(deps, step).format()}`,
      isSaved: step === savedStep,
    })),
  }
}

/**
 * Records the shop's rounding habit.
 *
 * Permission-checked against `canSetGoldRate`, exactly as the wastage rule is:
 * both change what every future invoice comes to. And like it, this re-prices
 * nothing already sold — a posted sale carries its own total on its own row.
 */
export function retailRoundingSet(
  deps: RetailHandlerDeps,
  step: number,
): { ok: true } | { ok: false; message: string } {
  try {
    requirePermission(deps, 'canSetGoldRate')
    deps.settings.setRetailRoundingNearest(step)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

// ── leaving the application ─────────────────────────────────────────────────

/**
 * The hosts a link may point at.
 *
 * An allowlist rather than a scheme check. `shell.openExternal` hands a string
 * to the operating system, and the renderer composes the URL — so without this,
 * anything that ever influences a customer's mobile number influences what the
 * shop's PC is told to open. Two entries, both WhatsApp, because that is the
 * only outbound link the application has.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set(['wa.me', 'api.whatsapp.com'])

export function checkExternalUrl(url: string): { ok: true } | { ok: false; message: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, message: 'That is not a link this application can open.' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'Only secure (https) links can be opened.' }
  }
  if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
    return {
      ok: false,
      message: `This application does not open links to ${parsed.hostname}.`,
    }
  }
  return { ok: true }
}
