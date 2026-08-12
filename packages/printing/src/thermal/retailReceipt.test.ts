import { Money, Weight } from '@jewellery/domain'
import { describe, expect, it } from 'vitest'
import { RECEIPT_WIDTH_DOTS } from './receiptStyle.js'
import { buildRetailReceiptHtml, type RetailReceiptData } from './retailReceipt.js'

/**
 * A pure function from data to an HTML string, so it needs no database, no
 * window and no printer to test.
 *
 * The snapshot is of the RENDERED TEXT, not of the markup. Snapshotting the
 * markup would fail on every styling change and pass on a figure quietly moving
 * to the wrong row, which is precisely backwards: what has to stay stable is
 * what the customer reads on the paper.
 */

const RATE = Money.parse('237970')

function line(
  lineNo: number,
  itemName: string,
  purity: string,
  gross: string,
  net: string,
  wastage: string,
  fine: string,
  labour: string,
  stone: string,
  amount: string,
) {
  return {
    lineNo,
    itemName,
    purity,
    gross: Weight.parse(gross),
    net: Weight.parse(net),
    wastage: Weight.parse(wastage),
    fine: Weight.parse(fine),
    labour: Money.parse(labour),
    stoneCharges: Money.parse(stone),
    amount: Money.parse(amount),
  }
}

function invoice(overrides: Partial<RetailReceiptData> = {}): RetailReceiptData {
  return {
    shop: {
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: 'Trust in Purity',
      ownerName: 'Haji Abdul Rehman',
      phone1: '0300-7779999',
      phone2: null,
      address: 'Sona Bazaar, Lahore',
    },
    invoiceNo: 'RS-00001',
    date: '2026-08-30',
    time: '12:48',
    customerName: 'IMRAN SAHIB',
    customerMobile: '03067380000',
    ratePurity: '22K',
    ratePerTola: RATE,
    lines: [
      line(1, 'GOLD BANGLE', '22K', '47.239', '47.239', '6.613', '53.852', '4500', '0', '1102596.13'),
      line(2, 'CHAIN', '22K', '11.664', '11.664', '1.633', '13.297', '2000', '0', '273258.24'),
    ],
    totalFine: Weight.parse('67.149'),
    itemsTotal: Money.parse('1375854.37'),
    hallmarkCharges: Money.parse('1500'),
    otherCharges: Money.ZERO,
    discount: Money.parse('854.37'),
    customerGold: Weight.ZERO,
    customerGoldValue: Money.ZERO,
    grandTotal: Money.parse('1376500'),
    amountPaid: Money.parse('1000000'),
    balance: Money.parse('376500'),
    amountInWords: 'Rupees Thirteen Lakh Seventy Six Thousand Five Hundred Only',
    remarks: 'Balance on Eid',
    wastageRuleLabel: 'Wastage added to net weight, calculated on net weight',
    printedAt: '30-08-2026 12:48 PM',
    ...overrides,
  }
}

/** The words on the paper, with the markup taken away. */
function renderedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/scr\s*ipt>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/(tr|div|table)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .join('\n')
}

describe('the invoice is authored at the thermal head width', () => {
  it('is exactly 576 dots wide, like every other document on this printer', () => {
    expect(RECEIPT_WIDTH_DOTS).toBe(576)
    expect(buildRetailReceiptHtml(invoice())).toContain('width:576px')
  })

  it('carries the measurement hook the print pipeline waits on', () => {
    const html = buildRetailReceiptHtml(invoice())
    expect(html).toContain('data-measure')
    expect(html).toContain('window.__ready')
    expect(html).toContain('document.fonts')
  })

  it('is a complete document, not a fragment', () => {
    const html = buildRetailReceiptHtml(invoice())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('charset="utf-8"')
  })
})

describe('the paper, as the customer reads it', () => {
  it('matches the approved rendering', () => {
    expect(renderedText(buildRetailReceiptHtml(invoice()))).toMatchSnapshot()
  })

  it('drops the charge lines that are zero, and keeps the ones that are not', () => {
    const text = renderedText(
      buildRetailReceiptHtml(
        invoice({ hallmarkCharges: Money.ZERO, otherCharges: Money.ZERO, discount: Money.ZERO }),
      ),
    )
    expect(text).not.toContain('ہال مارک')
    expect(text).not.toContain('رعایت')
    // The three that always print, zero or not.
    expect(text).toContain('کل رقم')
    expect(text).toContain('ادا شدہ')
    expect(text).toContain('بقایا')
  })
})

describe('every figure on the paper came from the data', () => {
  const html = buildRetailReceiptHtml(invoice())

  it('prints the header, the invoice number and the customer', () => {
    expect(html).toContain('AL-HARAM GOLD JEWELLERS')
    expect(html).toContain('RS-00001')
    expect(html).toContain('IMRAN SAHIB')
  })

  it('prints the date as DD-MM-YYYY, never the ISO form', () => {
    expect(html).toContain('30-08-2026')
    expect(html).not.toContain('2026-08-30')
  })

  it('prints each line with its fine weight and its amount', () => {
    expect(html).toContain('GOLD BANGLE')
    expect(html).toContain('53.852')
    expect(html).toContain('1,102,596')
    expect(html).toContain('CHAIN')
    expect(html).toContain('13.297')
    expect(html).toContain('273,258')
  })

  it('prints the total fine in grams AND in tola, so nobody converts by hand', () => {
    expect(html).toContain('67.149 g')
    // 67.149 g is 5.757 tola. Formatted by the domain, not by this module.
    expect(html).toContain('5.757 tola')
  })

  it('prints the grand total, what was paid and what is left', () => {
    expect(html).toContain('Rs 1,376,500')
    expect(html).toContain('1,000,000')
    expect(html).toContain('Rs 376,500 (still due)')
  })

  it('prints the amount in words exactly as it was stored', () => {
    expect(html).toContain('Rupees Thirteen Lakh Seventy Six Thousand Five Hundred Only')
  })

  it('prints the remarks and the wastage rule the sale was priced with', () => {
    expect(html).toContain('Balance on Eid')
    expect(html).toContain('Wastage added to net weight, calculated on net weight')
  })

  it('prints a signature rule for each side of the counter', () => {
    expect(html).toContain('دستخط گاہک')
    expect(html).toContain('دستخط دکاندار')
  })

  it('recomputes nothing — the totals are the ones handed in', () => {
    // Deliberately inconsistent. A renderer that recalculated would "fix" these;
    // this one must print what the ledger stored, because a reprint has to match
    // the row even when the row is the thing being examined.
    const odd = buildRetailReceiptHtml(
      invoice({ grandTotal: Money.parse('999999'), totalFine: Weight.parse('1.111') }),
    )
    expect(odd).toContain('Rs 999,999')
    expect(odd).toContain('1.111 g')
  })
})

describe('the balance is never a bare minus sign', () => {
  it('says the money is still due when the customer owes', () => {
    expect(buildRetailReceiptHtml(invoice())).toContain('Rs 376,500 (still due)')
  })

  it('says the money is to be returned when they overpaid', () => {
    const html = buildRetailReceiptHtml(invoice({ balance: Money.parse('-2500') }))
    expect(html).toContain('Rs 2,500 (to return)')
    expect(html).not.toContain('-2,500')
  })

  it('says paid in full at zero', () => {
    expect(buildRetailReceiptHtml(invoice({ balance: Money.ZERO }))).toContain(
      'Rs 0 (paid in full)',
    )
  })

  it('never emits a signed figure anywhere on the paper', () => {
    for (const value of ['-2500', '-125000.50', '-1']) {
      const html = buildRetailReceiptHtml(invoice({ balance: Money.parse(value) }))
      // The style block legitimately contains hyphens (-webkit-text-stroke), so
      // this targets a minus immediately in front of a figure.
      expect(html).not.toMatch(/-\d[\d,]*\.\d/)
    }
  })
})

describe('old gold traded in against the sale', () => {
  it('prints its weight and what it was worth', () => {
    const html = buildRetailReceiptHtml(
      invoice({
        customerGold: Weight.parse('11.664'),
        customerGoldValue: Money.parse('237970'),
      }),
    )
    expect(html).toContain('پرانا سونا 11.664 g')
    expect(html).toContain('237,970')
  })

  it('says nothing at all when none was traded', () => {
    expect(buildRetailReceiptHtml(invoice())).not.toContain('پرانا سونا')
  })
})

describe('user text is escaped, never injected raw', () => {
  it('escapes a customer name containing markup', () => {
    const html = buildRetailReceiptHtml(
      invoice({ customerName: '<script>alert(1)</script> & Sons' }),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; Sons')
  })

  it('escapes an item name and the remarks too', () => {
    const html = buildRetailReceiptHtml(
      invoice({
        lines: [line(1, 'RING <22K>', '22K', '5', '5', '0.7', '5.7', '500', '0', '120000')],
        remarks: '<b>bold</b>',
      }),
    )
    expect(html).toContain('RING &lt;22K&gt;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('leaves the measurement script intact when text is escaped', () => {
    const html = buildRetailReceiptHtml(invoice({ customerName: '</script><b>x' }))
    expect(html).toContain('window.__ready')
  })
})

describe('optional fields', () => {
  it('omits the mobile row when the customer has no number', () => {
    expect(buildRetailReceiptHtml(invoice({ customerMobile: null }))).not.toContain('موبائل')
  })

  it('names no salesman anywhere — the shop does not track one', () => {
    // The row is gone rather than blank. A labelled box printed empty on every
    // receipt reads as a field somebody forgot to fill in, and the counter
    // starts asking who was supposed to fill it.
    expect(buildRetailReceiptHtml(invoice())).not.toContain('سیلزمین')
  })

  it('handles a sale with no lines without breaking the document', () => {
    const html = buildRetailReceiptHtml(invoice({ lines: [] }))
    expect(html).toContain('کیش میمو')
    expect(html).toContain('window.__ready')
  })
})
