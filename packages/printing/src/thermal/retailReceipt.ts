import { formatTola, type Money, type Weight } from '@jewellery/domain'
import {
  FONT_STACK,
  ITEM_AMOUNT_PX,
  ITEM_CELL_PADDING,
  ITEM_LABEL_PX,
  ITEM_VALUE_PX,
  LABEL_PX,
  LABEL_WEIGHT,
  NUMERIC_FONT,
  READY_SCRIPT,
  RECEIPT_WIDTH_DOTS,
  SMALL_PX,
  STROKE,
  VALUE_PX,
  VALUE_WEIGHT,
  esc,
} from './receiptStyle.js'
import type { ReceiptShop } from './wholesaleReceipt.js'

/**
 * The retail invoice, on the same 80mm paper as the wholesale slip.
 *
 * Structurally it is the wholesale receipt's twin — the same 576-dot block, the
 * same bordered tables, the same Nastaliq labels beside Arial figures — because
 * the two come out of the same printer and a shop that recognises one should
 * recognise the other.
 *
 * What differs is what a retail sale IS. A wholesale slip records a gold debt,
 * so it ends on a balance in grams. A retail invoice is a bill: it ends on a
 * grand total in rupees, an amount paid, what is left, and the amount in words —
 * which is the line a dispute is settled on when the figures are smudged.
 *
 * **This module formats; it never calculates.** Every figure arrives as a domain
 * value object and is turned into text by that object's own `format()` — the
 * same method the screen calls. The amount in words arrives as a STRING,
 * rendered once at post time and stored on the row, so the paper cannot say a
 * different number from the database even if the words function later changes.
 */

export interface RetailReceiptLine {
  readonly lineNo: number
  readonly itemName: string
  /** Display form, e.g. "22K". */
  readonly purity: string
  readonly gross: Weight
  readonly net: Weight
  readonly wastage: Weight
  readonly fine: Weight
  /** The amount actually charged, after the fixed / per-tola mode is resolved. */
  readonly labour: Money
  readonly stoneCharges: Money
  readonly amount: Money
}

export interface RetailReceiptData {
  readonly shop: ReceiptShop
  readonly invoiceNo: string
  /** Business date, `YYYY-MM-DD`. Printed as `DD-MM-YYYY`. */
  readonly date: string
  /** Local wall-clock `HH:MM`. The counter cares what time it was. */
  readonly time: string
  readonly customerName: string
  readonly customerMobile?: string | null
  readonly ratePurity: string
  readonly ratePerTola: Money
  /**
   * The shop's terms box and footer line, from Settings.
   *
   * Both optional, and both meaningful when blank: an empty string means the
   * shop cleared the field and wants nothing printed, while `undefined` means
   * the caller did not set it and the slip keeps what it has always said.
   */
  readonly terms?: string | null
  readonly footer?: string
  readonly lines: readonly RetailReceiptLine[]
  readonly totalFine: Weight
  readonly itemsTotal: Money
  readonly hallmarkCharges: Money
  readonly otherCharges: Money
  readonly discount: Money
  readonly customerGold: Weight
  readonly customerGoldValue: Money
  readonly grandTotal: Money
  readonly amountPaid: Money
  readonly balance: Money
  /** Rendered once at post time and stored. Never recomputed here. */
  readonly amountInWords: string
  readonly remarks?: string | null
  /** The rule this sale was PRICED with, printed so a reprint is checkable. */
  readonly wastageRuleLabel?: string | null
  readonly printedAt?: string | null
}

/** `2026-08-30` → `30-08-2026`, the form the shop's paper already uses. */
function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return esc(iso)
  return `${match[3]}-${match[2]}-${match[1]}`
}

function labelCell(text: string, colspan = 1): string {
  return (
    `<td colspan="${colspan}" style="border:2px solid #000;padding:3px 5px;` +
    `font:${LABEL_WEIGHT} ${LABEL_PX}px ${FONT_STACK};text-align:center;` +
    `white-space:nowrap;${STROKE}">${text}</td>`
  )
}

function valueCell(
  text: string,
  align: 'center' | 'right' | 'left' = 'center',
  wrap = false,
): string {
  return (
    `<td style="border:2px solid #000;padding:4px 5px;` +
    `font:${VALUE_WEIGHT} ${VALUE_PX}px ${NUMERIC_FONT};text-align:${align};` +
    `${wrap ? 'white-space:normal;' : 'white-space:nowrap;'}${STROKE}">${text}</td>`
  )
}

function itemLabelCell(text: string, colspan = 1): string {
  return (
    `<td colspan="${colspan}" style="border:2px solid #000;padding:${ITEM_CELL_PADDING};` +
    `font:${LABEL_WEIGHT} ${ITEM_LABEL_PX}px ${FONT_STACK};text-align:center;` +
    `white-space:nowrap;${STROKE}">${text}</td>`
  )
}

function itemValueCell(
  text: string,
  align: 'center' | 'right' = 'right',
  { amount = false, wrap = false, colspan = 1 } = {},
): string {
  const size = amount ? ITEM_AMOUNT_PX : ITEM_VALUE_PX
  return (
    `<td colspan="${colspan}" style="border:2px solid #000;padding:${ITEM_CELL_PADDING};` +
    `font:${VALUE_WEIGHT} ${size}px ${NUMERIC_FONT};text-align:${align};` +
    `${wrap ? 'white-space:normal;' : 'white-space:nowrap;'}${STROKE}">${text}</td>`
  )
}

/** The bordered shop block. A blank field hides its line rather than printing empty. */
function shopHeader(shop: ReceiptShop): string {
  const name = esc(shop.name)
  const tagline = esc(shop.tagline)
  const owner = esc(shop.ownerName)
  const phone1 = esc(shop.phone1)
  const phone2 = esc(shop.phone2)
  const address = esc(shop.address)

  let html = '<div style="border:3px solid #000;text-align:center;padding:5px 6px 0">'
  if (name) {
    html +=
      `<div style="font-family:${FONT_STACK};font-size:36px;font-weight:800;` +
      `line-height:1.5;-webkit-text-stroke:0">${name}</div>`
  }
  html +=
    '<div style="border-top:3px solid #000;border-bottom:2px solid #000;' +
    'height:5px;margin:2px 10px 5px"></div>'
  if (tagline) {
    html += `<div style="font-family:${FONT_STACK};font-size:${SMALL_PX}px;line-height:1.8;${STROKE}">${tagline}</div>`
  }
  if (owner || phone1) {
    html +=
      `<div style="font-family:${FONT_STACK};font-size:20px;font-weight:600;line-height:1.7;${STROKE}">` +
      owner +
      (owner && phone1 ? '&nbsp;&nbsp;' : '') +
      (phone1 ? `<span dir="ltr">${phone1}</span>` : '') +
      '</div>'
  }
  if (phone2) {
    html += `<div style="font:600 20px ${NUMERIC_FONT};line-height:1.5"><span dir="ltr">${phone2}</span></div>`
  }
  if (address) {
    html +=
      `<div style="border-top:2px solid #000;margin-top:5px;padding:3px 0 6px;` +
      `font-family:${FONT_STACK};font-size:${SMALL_PX}px;line-height:1.7;${STROKE}">${address}</div>`
  }
  return `${html}</div>`
}

/**
 * A charge line in the breakdown.
 *
 * Zero-value lines are hidden rather than printed as `0`. A retail invoice with
 * "Hallmark 0 / Other 0 / Discount 0 / Old Gold 0" reads as four things the
 * customer was nearly charged for, and it costs four lines of paper per sale.
 * The grand total, the amount paid and the balance always print, zero or not,
 * because their absence would be the ambiguity.
 */
function chargeRow(label: string, amount: Money, force = false): string {
  if (amount.isZero && !force) return ''
  return (
    '<tr>' +
    itemLabelCell(label, 4) +
    itemValueCell(amount.formatWhole(), 'right', { amount: true, colspan: 2 }) +
    '</tr>'
  )
}

export function buildRetailReceiptHtml(data: RetailReceiptData): string {
  // Invoice / date / customer. dir=rtl so the Urdu label column sits on the
  // right, exactly as on the wholesale slip.
  const infoRows = [
    `<tr>${labelCell('بل نمبر')}${valueCell(esc(data.invoiceNo))}${labelCell('تاریخ')}${valueCell(formatDate(data.date))}</tr>`,
    `<tr>${labelCell('گاہک')}${valueCell(esc(data.customerName), 'center', true)}${labelCell('وقت')}${valueCell(esc(data.time))}</tr>`,
    `<tr>${labelCell('ریٹ فی تولہ')}${valueCell(`${esc(data.ratePurity)} ${data.ratePerTola.formatWhole()}`)}${labelCell('')}${valueCell('')}</tr>`,
    data.customerMobile
      ? `<tr>${labelCell('موبائل')}${valueCell(`<span dir="ltr">${esc(data.customerMobile)}</span>`)}${labelCell('')}${valueCell('')}</tr>`
      : '',
  ].join('')

  // Six columns, which is what fits in 576 dots at ITEM_VALUE_PX:
  //   ITEM | وزن (gross) | خالص (fine) | مزدوری (labour) | نگ (stone) | رقم
  const itemHeader =
    '<tr>' +
    itemLabelCell('آئٹم') +
    itemLabelCell('وزن') +
    itemLabelCell('خالص') +
    itemLabelCell('مزدوری') +
    itemLabelCell('نگ') +
    itemLabelCell('رقم') +
    '</tr>'

  const itemRows = data.lines
    .map(
      (line) =>
        '<tr>' +
        itemValueCell(`${esc(line.itemName)} ${esc(line.purity)}`, 'right', { wrap: true }) +
        itemValueCell(line.gross.format()) +
        itemValueCell(line.fine.format()) +
        itemValueCell(line.labour.formatWhole()) +
        itemValueCell(line.stoneCharges.formatWhole()) +
        itemValueCell(line.amount.formatWhole(), 'right', { amount: true }) +
        '</tr>',
    )
    .join('')

  // Total fine is printed in BOTH units. The shop quotes and argues in tola;
  // the scale on the counter reads grams. Printing one and not the other means
  // somebody converts it by hand on the back of the slip.
  const fineRow =
    '<tr>' +
    itemLabelCell('کل خالص', 2) +
    itemValueCell(
      `${data.totalFine.format()} g&nbsp;&nbsp;/&nbsp;&nbsp;${formatTola(data.totalFine)} tola`,
      'center',
      { colspan: 4 },
    ) +
    '</tr>'

  const chargeRows =
    chargeRow('آئٹم ٹوٹل', data.itemsTotal, true) +
    chargeRow('ہال مارک', data.hallmarkCharges) +
    chargeRow('دیگر', data.otherCharges) +
    chargeRow('رعایت', data.discount) +
    (data.customerGold.isZero
      ? ''
      : '<tr>' +
        itemLabelCell(`پرانا سونا ${data.customerGold.format()} g`, 4) +
        itemValueCell(data.customerGoldValue.formatWhole(), 'right', {
          amount: true,
          colspan: 2,
        }) +
        '</tr>')

  // The grand total is the figure the customer checks first, so it gets its own
  // full-width band at the largest size on the slip.
  const grandTotalRow =
    '<tr>' +
    itemLabelCell('کل رقم', 2) +
    `<td colspan="4" style="border:2px solid #000;padding:5px 4px;` +
    `font:800 ${LABEL_PX}px ${NUMERIC_FONT};text-align:center;` +
    `white-space:nowrap;${STROKE}"><span dir="ltr">Rs ${data.grandTotal.formatWhole()}</span></td>` +
    '</tr>'

  const settlementRows =
    chargeRow('ادا شدہ', data.amountPaid, true) +
    // dir=ltr on the value: inside an RTL document the bidi algorithm reorders
    // a mixed string and moves the figure to the wrong end of the line. The
    // wholesale slip found this the same way — by rendering it and looking.
    '<tr>' +
    itemLabelCell('بقایا', 4) +
    `<td colspan="2" style="border:2px solid #000;padding:${ITEM_CELL_PADDING};` +
    `font:800 ${ITEM_LABEL_PX + 1}px ${NUMERIC_FONT};text-align:right;` +
    `white-space:nowrap;${STROKE}"><span dir="ltr">${balanceText(data.balance)}</span></td>` +
    '</tr>'

  // A legal fixture of the invoice, and the reason it is stored rather than
  // rendered: this is what a dispute is settled on when the figures are altered.
  const wordsBlock =
    `<div style="border:2px solid #000;border-top:none;padding:5px 6px;` +
    `font:600 ${SMALL_PX}px ${NUMERIC_FONT};text-align:center;` +
    `line-height:1.6;${STROKE}"><span dir="ltr">${esc(data.amountInWords)}</span></div>`

  const remarksBlock = data.remarks
    ? `<div style="border:2px solid #000;border-top:none;padding:4px 6px;` +
      `font-family:${FONT_STACK};font-size:${SMALL_PX}px;line-height:1.7;${STROKE}">` +
      `${esc(data.remarks)}</div>`
    : ''

  const ruleBlock = data.wastageRuleLabel
    ? `<div style="font:600 14px ${NUMERIC_FONT};text-align:center;padding:4px 0 0">` +
      `<span dir="ltr">${esc(data.wastageRuleLabel)}</span></div>`
    : ''

  // The signature rule. A printed line with nothing above it is what a counter
  // signs; without it people sign across the totals.
  const signature =
    '<div style="display:flex;justify-content:space-between;gap:20px;margin-top:26px">' +
    signatureCell('دستخط گاہک') +
    signatureCell('دستخط دکاندار') +
    '</div>'

  /**
   * The shop's own terms, printed in a ruled box under the totals.
   *
   * A blank setting prints NO BOX, rather than an empty rectangle: a shop that
   * cleared the field is saying it wants no terms, and an empty box on a
   * customer's receipt looks like something failed to print.
   */
  const termsBlock = (data.terms ?? '').trim()
    ? `<div style="font-family:${FONT_STACK};font-size:${SMALL_PX}px;line-height:1.9;` +
      `border:3px solid #000;margin-top:8px;padding:4px 7px;${STROKE}">` +
      `${esc((data.terms ?? '').trim())}</div>`
    : ''

  // The shop's own words, or the ones this slip has always carried. A blank
  // setting means the shop cleared the line, so nothing is printed at all —
  // `??` would put the default back and overrule them on their own paper.
  const footerText = data.footer === undefined ? 'شکریہ! دوبارہ تشریف لائیں' : data.footer.trim()
  const footer =
    (footerText
      ? `<div style="font-family:${FONT_STACK};font-size:${SMALL_PX}px;text-align:center;` +
        `border-top:3px solid #000;margin-top:9px;padding-top:7px;line-height:1.8;${STROKE}">` +
        esc(footerText) +
        '</div>'
      : '') +
    (data.printedAt
      ? `<div style="font:600 16px ${NUMERIC_FONT};text-align:center;padding:2px 0 10px">${esc(data.printedAt)}</div>`
      : '<div style="height:10px"></div>')

  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    'table{border-collapse:collapse;width:100%;border:3px solid #000;margin-top:8px}' +
    '</style></head><body>' +
    `<div data-measure dir="rtl" style="width:${RECEIPT_WIDTH_DOTS}px;box-sizing:border-box;padding:2px 10px 0">` +
    shopHeader(data.shop) +
    `<div style="font-family:${FONT_STACK};font-size:${LABEL_PX}px;font-weight:800;` +
    `text-align:center;border:3px solid #000;border-top:none;padding:3px 0;${STROKE}">` +
    'کیش میمو' +
    '</div>' +
    `<table>${infoRows}</table>` +
    `<table>${itemHeader}${itemRows}${fineRow}${chargeRows}${grandTotalRow}${settlementRows}</table>` +
    wordsBlock +
    remarksBlock +
    termsBlock +
    ruleBlock +
    signature +
    footer +
    '</div>' +
    READY_SCRIPT +
    '</body></html>'
  )
}

/**
 * The balance, never as a bare minus sign (DECISIONS §4).
 *
 * A retail balance is the customer's, not a party ledger's, so the words are the
 * ones a counter uses: money still owed, or money to be handed back.
 */
function balanceText(balance: Money): string {
  if (balance.isZero) return 'Rs 0 (paid in full)'
  return balance.isNegative
    ? `Rs ${balance.absolute.formatWhole()} (to return)`
    : `Rs ${balance.formatWhole()} (still due)`
}

function signatureCell(label: string): string {
  return (
    '<div style="flex:1;text-align:center">' +
    '<div style="border-top:2px solid #000;margin-bottom:3px"></div>' +
    `<div style="font-family:${FONT_STACK};font-size:${SMALL_PX}px;${STROKE}">${label}</div>` +
    '</div>'
  )
}
