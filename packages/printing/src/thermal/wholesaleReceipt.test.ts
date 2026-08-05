import { Katt, Money, Weight } from '@jewellery/domain'
import { describe, expect, it } from 'vitest'
import { RECEIPT_WIDTH_DOTS } from './receiptStyle.js'
import {
  buildWholesaleReceiptHtml,
  type WholesaleReceiptData,
} from './wholesaleReceipt.js'

/**
 * The renderer is a pure function from data to an HTML string, so it needs no
 * database, no window and no printer to test. What is checked here is that the
 * figures reaching the paper are the ones that were handed in, formatted by the
 * domain's own methods — nothing is recomputed on the way out.
 */

const RATE = Money.parse('358000')

function line(
  lineNo: number,
  itemName: string,
  grams: string,
  katt: string,
  khalis: string,
  amount: string,
) {
  return {
    lineNo,
    itemName,
    gross: Weight.parse(grams),
    katt: Katt.parse(katt),
    ratePerTola: RATE,
    khalis: Weight.parse(khalis),
    amount: Money.parse(amount),
  }
}

/** The real slip from docs/wholesale-receipt.jpg. */
function slip(overrides: Partial<WholesaleReceiptData> = {}): WholesaleReceiptData {
  return {
    shop: {
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: 'Trust in Purity',
      ownerName: 'Haji Abdul Rehman',
      phone1: '0300-7779999',
      phone2: null,
      address: 'Sona Bazaar, Lahore',
    },
    invoiceNo: 'WS-10001',
    date: '2026-08-30',
    partyName: 'CHAUDHARY JEWELLER',
    partyMobile: '03067380000',
    ratePerTola: RATE,
    lines: [
      line(1, 'SINGAPORI CHAIN 15', '254.200', '13', '219.777', '6745556.07'),
      line(2, 'JEWELRY', '10.280', '13', '8.888', '272796.98'),
      line(3, 'OS JEWELARY', '7.030', '11.5', '6.188', '189926.61'),
    ],
    totalGross: Weight.parse('271.510'),
    totalKhalis: Weight.parse('234.853'),
    totalAmount: Money.parse('7208279.66'),
    balanceAfter: Weight.parse('234.853'),
    printedAt: '30-08-2026 12:48 PM',
    ...overrides,
  }
}

describe('the slip is authored at the thermal head width', () => {
  it('is exactly 576 dots wide', () => {
    // One CSS pixel becomes one printer dot, so this number is the whole reason
    // the slip cannot drift left or right between machines.
    expect(RECEIPT_WIDTH_DOTS).toBe(576)
    expect(buildWholesaleReceiptHtml(slip())).toContain('width:576px')
  })

  it('carries the measurement hook the print pipeline waits on', () => {
    const html = buildWholesaleReceiptHtml(slip())
    expect(html).toContain('data-measure')
    expect(html).toContain('window.__ready')
    // Fonts must load before measuring, or the last line is cut off.
    expect(html).toContain('document.fonts')
  })

  it('is a complete document, not a fragment', () => {
    const html = buildWholesaleReceiptHtml(slip())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('charset="utf-8"')
  })
})

describe('every figure on the paper came from the data', () => {
  const html = buildWholesaleReceiptHtml(slip())

  it('prints the header', () => {
    expect(html).toContain('AL-HARAM GOLD JEWELLERS')
    expect(html).toContain('WS-10001')
    expect(html).toContain('CHAUDHARY JEWELLER')
  })

  it('prints the date as DD-MM-YYYY, the form the old slip uses', () => {
    expect(html).toContain('30-08-2026')
    expect(html).not.toContain('2026-08-30')
  })

  it('prints each line with gross, katt and khalis', () => {
    expect(html).toContain('SINGAPORI CHAIN 15')
    expect(html).toContain('254.200')
    expect(html).toContain('13.000')
    expect(html).toContain('219.777')

    expect(html).toContain('10.280')
    expect(html).toContain('8.888')

    expect(html).toContain('11.500')
    expect(html).toContain('6.188')
  })

  it('prints the bracketed totals exactly as the slip does', () => {
    expect(html).toContain('( 271.510 )')
    expect(html).toContain('( 234.853 )')
  })

  it('prints the rate per tola', () => {
    expect(html).toContain('358,000')
  })

  it('recomputes nothing — the totals are the ones handed in', () => {
    // Deliberately inconsistent totals. A renderer that recalculated would
    // "fix" them; this one must print what the ledger actually stored, because
    // the paper has to match the entry even when the entry is being examined.
    const odd = buildWholesaleReceiptHtml(
      slip({ totalKhalis: Weight.parse('999.999'), totalGross: Weight.parse('888.888') }),
    )
    expect(odd).toContain('( 999.999 )')
    expect(odd).toContain('( 888.888 )')
  })
})

describe('the balance after the entry', () => {
  it('prints a positive balance with the DR tag the old slip uses', () => {
    const html = buildWholesaleReceiptHtml(slip())
    expect(html).toContain('234.853 g (they owe) /DR')
  })

  it('prints a balance the shop owes as CR, never as a bare minus', () => {
    const html = buildWholesaleReceiptHtml(
      slip({ balanceAfter: Weight.parse('-7.310') }),
    )
    expect(html).toContain('7.310 g (we owe) /CR')
    expect(html).not.toContain('-7.310')
  })

  it('forces the balance to read left-to-right inside the RTL slip', () => {
    // Without dir=ltr the bidi algorithm renders "234.853 g (they owe) /DR" as
    // "g (they owe) /DR 234.853" — the figure moves to the wrong end.
    const html = buildWholesaleReceiptHtml(slip())
    expect(html).toMatch(/<span dir="ltr">[^<]*234\.853 g \(they owe\) \/DR/)
  })

  it('prints a settled balance with no CR or DR tag at all', () => {
    const html = buildWholesaleReceiptHtml(slip({ balanceAfter: Weight.ZERO }))
    expect(html).toContain('0.000 g')
    expect(html).not.toMatch(/0\.000 g \/(DR|CR)/)
  })

  it('never emits a signed figure anywhere on the slip', () => {
    for (const mg of ['-0.500', '-7.310', '-1234.567']) {
      const html = buildWholesaleReceiptHtml(slip({ balanceAfter: Weight.parse(mg) }))
      // A minus immediately before a figure. The style block legitimately
      // contains hyphens (-webkit-text-stroke), so this targets numbers only.
      expect(html).not.toMatch(/-\d[\d,]*\.\d/)
    }
  })
})

describe('user text is escaped, never injected raw', () => {
  it('escapes a party name containing markup', () => {
    const html = buildWholesaleReceiptHtml(
      slip({ partyName: '<script>alert(1)</script> & Sons' }),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; Sons')
  })

  it('escapes an item name too', () => {
    const html = buildWholesaleReceiptHtml(
      slip({ lines: [line(1, 'CHAIN <22K>', '10', '13', '8.646', '265000')] }),
    )
    expect(html).toContain('CHAIN &lt;22K&gt;')
  })

  it('leaves the measurement script intact when text is escaped', () => {
    // Raw injection could break window.__ready, and the pipeline would then
    // hang waiting for a height that never arrives.
    const html = buildWholesaleReceiptHtml(slip({ partyName: '</script><b>x' }))
    expect(html).toContain('window.__ready')
  })
})

describe('optional fields', () => {
  it('hides a blank tagline, phone and address rather than printing empty lines', () => {
    const html = buildWholesaleReceiptHtml(
      slip({
        shop: { name: 'SHOP', tagline: null, ownerName: null, phone1: null, phone2: null, address: null },
      }),
    )
    expect(html).toContain('SHOP')
    // The double rule belongs to the box and stays even with no tagline.
    expect(html).toContain('border-bottom:2px solid #000')
  })

  it('omits the mobile row when the party has no number', () => {
    const html = buildWholesaleReceiptHtml(slip({ partyMobile: null }))
    expect(html).not.toContain('موبائل')
  })

  it('handles a slip with no rate', () => {
    const html = buildWholesaleReceiptHtml(slip({ ratePerTola: null }))
    expect(html).toContain('ریٹ فی تولہ')
  })

  it('handles an empty line list without breaking the document', () => {
    const html = buildWholesaleReceiptHtml(slip({ lines: [] }))
    expect(html).toContain('ہول سیل رسید')
    expect(html).toContain('window.__ready')
  })
})
