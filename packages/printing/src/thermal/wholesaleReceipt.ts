import { describeBalance, type Katt, type Money, type Weight } from '@jewellery/domain'
import {
  FONT_STACK,
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

/**
 * The wholesale slip, as HTML authored at exactly 576 dots wide.
 *
 * Built the same way as the reference implementation's `buildReceiptHtml`: one
 * fixed-width block, bordered tables, Urdu labels in a Nastaliq face and figures
 * in Arial, everything bold enough to survive a 1-bit threshold. The print
 * pipeline (Phase 2) renders this in a hidden window and sends it to the
 * thermal printer.
 *
 * **This module formats; it never calculates.** Every figure arrives as a domain
 * value object and is turned into text by that object's own `format()` — the
 * same method the screen uses. Nothing here divides, multiplies or rounds, so
 * the paper cannot disagree with the ledger. Stored integers (milligrams,
 * paisa, milli-ratti) are never touched.
 */

export interface ReceiptShop {
  readonly name: string
  readonly tagline?: string | null
  readonly ownerName?: string | null
  readonly phone1?: string | null
  readonly phone2?: string | null
  readonly address?: string | null
}

export interface ReceiptLine {
  readonly lineNo: number
  readonly itemName: string
  readonly gross: Weight
  readonly katt: Katt
  readonly ratePerTola: Money
  readonly khalis: Weight
  readonly amount: Money
}

export interface WholesaleReceiptData {
  readonly shop: ReceiptShop
  readonly invoiceNo: string
  /** Business date, `YYYY-MM-DD`. Printed as `DD-MM-YYYY`. */
  readonly date: string
  readonly partyName: string
  readonly partyMobile?: string | null
  readonly ratePerTola: Money | null
  readonly lines: readonly ReceiptLine[]
  readonly totalGross: Weight
  readonly totalKhalis: Weight
  readonly totalAmount: Money
  /** The party's gold balance AFTER this entry. Signed; may be negative. */
  readonly balanceAfter: Weight
  /** Shown in the footer. Supplied by the caller so this stays pure. */
  readonly printedAt?: string | null
}

/** `2026-08-30` → `30-08-2026`, the form the old slip prints. */
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

function valueCell(text: string, align: 'center' | 'right' | 'left' = 'center', wrap = false): string {
  return (
    `<td style="border:2px solid #000;padding:4px 5px;` +
    `font:${VALUE_WEIGHT} ${VALUE_PX}px ${NUMERIC_FONT};text-align:${align};` +
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
    // Already 800 weight — the inherited stroke would bleed the glyphs together,
    // so it is explicitly zeroed back out.
    html +=
      `<div style="font-family:${FONT_STACK};font-size:36px;font-weight:800;` +
      `line-height:1.5;-webkit-text-stroke:0">${name}</div>`
  }
  // The double rule belongs to the box, not to any field: it keeps separating
  // the name from the phones even when the tagline is blank.
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

export function buildWholesaleReceiptHtml(data: WholesaleReceiptData): string {
  const rate = data.ratePerTola ? data.ratePerTola.formatWhole() : '-'

  // Invoice / date / party. dir=rtl so the Urdu label column sits on the right,
  // matching the reference slip.
  const infoRows = [
    `<tr>${labelCell('رسید نمبر')}${valueCell(esc(data.invoiceNo))}${labelCell('تاریخ')}${valueCell(formatDate(data.date))}</tr>`,
    `<tr>${labelCell('پارٹی')}${valueCell(esc(data.partyName), 'center', true)}${labelCell('ریٹ فی تولہ')}${valueCell(rate)}</tr>`,
    data.partyMobile
      ? `<tr>${labelCell('موبائل')}${valueCell(`<span dir="ltr">${esc(data.partyMobile)}</span>`)}${labelCell('')}${valueCell('')}</tr>`
      : '',
  ].join('')

  // The item table. Columns exactly as the real slip, plus rate and amount:
  //   ITEM | GR | KATT | RATE | خالص | AMOUNT
  const itemHeader =
    '<tr>' +
    labelCell('آئٹم') +
    labelCell('وزن') +
    labelCell('کاٹ') +
    labelCell('ریٹ') +
    labelCell('خالص') +
    labelCell('رقم') +
    '</tr>'

  const itemRows = data.lines
    .map(
      (line) =>
        '<tr>' +
        valueCell(esc(line.itemName), 'right', true) +
        valueCell(line.gross.format(), 'right') +
        valueCell(line.katt.format(), 'right') +
        valueCell(line.ratePerTola.formatWhole(), 'right') +
        valueCell(line.khalis.format(), 'right') +
        valueCell(line.amount.formatWhole(), 'right') +
        '</tr>',
    )
    .join('')

  // Totals row, in the slip's bracketed style.
  const totalsRow =
    '<tr>' +
    labelCell('ٹوٹل') +
    valueCell(`( ${data.totalGross.format()} )`, 'right') +
    valueCell('') +
    valueCell('') +
    valueCell(`( ${data.totalKhalis.format()} )`, 'right') +
    valueCell(data.totalAmount.formatWhole(), 'right') +
    '</tr>'

  // The balance after this entry. Never a bare minus sign — a magnitude plus an
  // explicit label, exactly as on screen (DECISIONS §4). The CR/DR tag is the
  // old slip's own vocabulary, kept so the paper still reads familiarly.
  const balance = describeBalance(data.balanceAfter)
  const drCr =
    balance.direction === 'party-owes-shop'
      ? 'DR'
      : balance.direction === 'shop-owes-party'
        ? 'CR'
        : ''
  const balanceText = drCr ? `${balance.text} /${drCr}` : balance.text

  const balanceRow =
    '<tr>' +
    labelCell('بقایا وزن', 3) +
    `<td colspan="3" style="border:2px solid #000;padding:5px;` +
    `font:800 ${VALUE_PX}px ${NUMERIC_FONT};text-align:center;${STROKE}">` +
    `<span style="border:3px solid #000;padding:2px 10px;display:inline-block">${esc(balanceText)}</span>` +
    '</td></tr>'

  const footer =
    `<div style="font-family:${FONT_STACK};font-size:${SMALL_PX}px;text-align:center;` +
    `border-top:3px solid #000;margin-top:9px;padding-top:7px;line-height:1.8;${STROKE}">` +
    'شکریہ! دوبارہ تشریف لائیں' +
    '</div>' +
    (data.printedAt
      ? `<div style="font:600 16px ${NUMERIC_FONT};text-align:center;padding:2px 0 10px">${esc(data.printedAt)}</div>`
      : '<div style="height:10px"></div>')

  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    'table{border-collapse:collapse;width:100%;border:3px solid #000;margin-top:8px}' +
    '</style></head><body>' +
    // data-measure is what READY_SCRIPT measures for the paper feed length.
    `<div data-measure dir="rtl" style="width:${RECEIPT_WIDTH_DOTS}px;box-sizing:border-box;padding:2px 10px 0">` +
    shopHeader(data.shop) +
    `<div style="font-family:${FONT_STACK};font-size:${LABEL_PX}px;font-weight:800;` +
    `text-align:center;border:3px solid #000;border-top:none;padding:3px 0;${STROKE}">` +
    'ہول سیل رسید' +
    '</div>' +
    `<table>${infoRows}</table>` +
    `<table>${itemHeader}${itemRows}${totalsRow}${balanceRow}</table>` +
    footer +
    '</div>' +
    READY_SCRIPT +
    '</body></html>'
  )
}
