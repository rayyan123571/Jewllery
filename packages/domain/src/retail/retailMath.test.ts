import { describe, expect, it } from 'vitest'
import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { formatTola, parseTola } from '../common/tola.js'
import {
  computeRetailInvoice,
  computeRetailLine,
  totalsOfRetail,
  type RetailLineInput,
  type WastageRule,
} from './retailMath.js'

// No database, no window — the whole point of the layering.

const RATE = Money.fromRupees(237_970)

/**
 * The worked example from the brief, to the digit:
 *   gross 4.050 tola · stone 0.000 · deduction 0.570 · polish 14.00% · 237,970/tola
 *
 * The four wastage rules produce four different invoices from these same
 * inputs, which is exactly why the rule is a setting and not a constant.
 */
const EXAMPLE: RetailLineInput = {
  itemName: 'Bangles',
  grossWeight: parseTola('4.050'),
  stoneWeight: Weight.ZERO,
  purityDeduction: parseTola('0.570'),
  wastageBp: 1400,
  labourCharges: Money.ZERO,
  labourMode: 'fixed',
  stoneCharges: Money.ZERO,
  ratePerTola: RATE,
}

const RULES: Record<string, WastageRule> = {
  'add on net': { direction: 'add', basis: 'net' },
  'add on gross': { direction: 'add', basis: 'gross' },
  'subtract on net': { direction: 'subtract', basis: 'net' },
  'subtract on gross': { direction: 'subtract', basis: 'gross' },
}

describe('the four wastage rules produce four different invoices', () => {
  it.each(Object.entries(RULES))('%s computes without error', (_name, rule) => {
    const line = computeRetailLine(EXAMPLE, rule)
    expect(line.fineWeight.milligrams).toBeGreaterThan(0)
    expect(line.lineAmount.paisa).toBeGreaterThan(0)
  })

  it('shares one net weight across all four — the deduction is rule-independent', () => {
    // gross 4.050 less an ABSOLUTE 0.570 deduction is 3.480, whatever the rule.
    const nets = Object.values(RULES).map(
      (rule) => computeRetailLine(EXAMPLE, rule).netWeight.milligrams,
    )
    expect(new Set(nets).size).toBe(1)
    expect(formatTola(computeRetailLine(EXAMPLE, RULES['add on net'] as WastageRule).netWeight))
      .toBe('3.480')
  })

  it('takes a bigger wastage on gross than on net', () => {
    const onNet = computeRetailLine(EXAMPLE, RULES['add on net'] as WastageRule)
    const onGross = computeRetailLine(EXAMPLE, RULES['add on gross'] as WastageRule)
    expect(onGross.wastage.milligrams).toBeGreaterThan(onNet.wastage.milligrams)
  })

  it('makes adding worth more than subtracting, by exactly twice the wastage', () => {
    const added = computeRetailLine(EXAMPLE, RULES['add on net'] as WastageRule)
    const subtracted = computeRetailLine(EXAMPLE, RULES['subtract on net'] as WastageRule)
    expect(added.fineWeight.minus(subtracted.fineWeight).milligrams).toBe(
      added.wastage.milligrams * 2,
    )
  })

  it('produces four distinct fine weights, which is why this cannot be guessed', () => {
    const fines = Object.values(RULES).map(
      (rule) => computeRetailLine(EXAMPLE, rule).fineWeight.milligrams,
    )
    expect(new Set(fines).size).toBe(4)
  })
})

/**
 * The purity deduction is ABSOLUTE.
 *
 * The shopkeeper reads it off the piece and types it; he does not enter a rate
 * for the software to multiply. That is a ruling about how this shop works, and
 * these are the tests that hold it — the same field used to be quoted per tola
 * of gross and the difference is invisible on a one-tola item, which is exactly
 * why it needs asserting on items that are not one tola.
 */
describe('the purity deduction is absolute, not a rate', () => {
  const rule = RULES['add on net'] as WastageRule

  it('removes the figure typed, whatever the piece weighs', () => {
    const deduction = parseTola('0.090')
    for (const gross of ['1.000', '2.000', '4.050', '11.500']) {
      const line = computeRetailLine(
        { ...EXAMPLE, grossWeight: parseTola(gross), purityDeduction: deduction },
        rule,
      )
      expect(line.grossWeight.minus(line.netWeight).milligrams).toBe(deduction.milligrams)
    }
  })

  it('does NOT scale with the weight of the piece', () => {
    const single = computeRetailLine({ ...EXAMPLE, grossWeight: parseTola('1.000') }, rule)
    const double = computeRetailLine({ ...EXAMPLE, grossWeight: parseTola('2.000') }, rule)
    const singleCut = single.grossWeight.minus(single.netWeight).milligrams
    const doubleCut = double.grossWeight.minus(double.netWeight).milligrams
    // The old per-tola field would have made this 2x. It must be 1x.
    expect(doubleCut).toBe(singleCut)
  })

  it('takes the mockup’s own figures: 2.000 less 0.090 is 1.910', () => {
    const line = computeRetailLine(
      {
        ...EXAMPLE,
        grossWeight: parseTola('2.000'),
        stoneWeight: Weight.ZERO,
        purityDeduction: parseTola('0.090'),
      },
      rule,
    )
    expect(formatTola(line.netWeight)).toBe('1.910')
  })

  it('totals across items the way the summary adds them up', () => {
    // Two 2.000-tola items at 0.090 each deduct 0.180 BETWEEN them — which is
    // the figure the reference mockup's summary showed, and the reason this
    // ruling was made.
    const item = {
      ...EXAMPLE,
      grossWeight: parseTola('2.000'),
      stoneWeight: Weight.ZERO,
      purityDeduction: parseTola('0.090'),
    }
    const lines = [computeRetailLine(item, rule), computeRetailLine(item, rule)]
    const deducted = lines.reduce(
      (sum, line) => sum + line.grossWeight.minus(line.stoneWeight).minus(line.netWeight).milligrams,
      0,
    )
    expect(formatTola(Weight.fromMilligrams(deducted))).toBe('0.180')
    expect(formatTola(Weight.sum(lines.map((l) => l.netWeight)))).toBe('3.820')
  })

  it('subtracts stone weight as well as the deduction', () => {
    const withStone = computeRetailLine(
      { ...EXAMPLE, stoneWeight: parseTola('0.500') },
      rule,
    )
    const without = computeRetailLine(EXAMPLE, rule)
    expect(without.netWeight.minus(withStone.netWeight).milligrams).toBe(
      parseTola('0.500').milligrams,
    )
  })
})

describe('labour', () => {
  const rule = RULES['add on net'] as WastageRule

  it('charges a fixed amount as-is', () => {
    const line = computeRetailLine(
      { ...EXAMPLE, labourCharges: Money.fromRupees(5_000), labourMode: 'fixed' },
      rule,
    )
    expect(line.labourAmount.format()).toBe('5,000.00')
  })

  it('charges per-tola labour on the fine weight, not on gross', () => {
    const line = computeRetailLine(
      { ...EXAMPLE, labourCharges: Money.fromRupees(1_000), labourMode: 'per_tola' },
      rule,
    )
    // Gross is 4.050 tola and fine is 3.967, so Rs 1,000/tola is Rs 3,967.25 —
    // NOT the Rs 4,050.07 it would be if labour were charged on gross. The two
    // figures are close, which is exactly why this asserts the number rather
    // than a band it happens to fall in.
    expect(line.labourAmount.paisa).toBe(396_725)
    expect(line.labourAmount.paisa).not.toBe(
      Math.round((100_000 * line.grossWeight.milligrams) / 11_664),
    )
  })

  it('adds labour and stone charges on top of the metal', () => {
    const line = computeRetailLine(
      {
        ...EXAMPLE,
        labourCharges: Money.fromRupees(5_000),
        stoneCharges: Money.fromRupees(2_000),
      },
      rule,
    )
    expect(line.lineAmount.paisa).toBe(
      line.goldValue.paisa + Money.fromRupees(7_000).paisa,
    )
  })
})

describe('an invoice total is the sum of its printed lines', () => {
  const rule = RULES['add on net'] as WastageRule

  it('sums twelve lines to the paisa', () => {
    // The guarantee that matters: a customer adding up the column on the slip
    // gets the same figure the slip prints. Deriving the total from summed
    // weights instead would disagree by a paisa or two and the customer would
    // be right.
    const lines = Array.from({ length: 12 }, (_, index) =>
      computeRetailLine(
        {
          ...EXAMPLE,
          itemName: `Item ${index + 1}`,
          grossWeight: parseTola(`${index + 1}.${(index * 37) % 1000}`.slice(0, 6)),
          labourCharges: Money.fromRupees(100 * (index + 1)),
        },
        rule,
      ),
    )
    const totals = totalsOfRetail(lines)
    const byHand = lines.reduce((sum, line) => sum + line.lineAmount.paisa, 0)
    expect(totals.itemsTotal.paisa).toBe(byHand)
  })

  it('keeps the grand total equal to items plus charges less deductions', () => {
    const lines = [computeRetailLine(EXAMPLE, rule)]
    const totals = totalsOfRetail(lines)
    const invoice = computeRetailInvoice({
      totals,
      customerGold: Weight.ZERO,
      customerGoldRatePerTola: null,
      hallmarkCharges: Money.fromRupees(1_000),
      otherCharges: Money.fromRupees(500),
      discount: Money.fromRupees(2_000),
      amountPaid: Money.ZERO,
    })
    expect(invoice.grandTotal.paisa).toBe(
      totals.itemsTotal.paisa + Money.fromRupees(1_500).paisa - Money.fromRupees(2_000).paisa,
    )
  })
})

/**
 * The payment chain, which a reference mockup could not make reconcile.
 *
 * It printed Grand Total 1,028,600 with both customer amount and advance gold at
 * zero, and a Remaining Balance of 628,600 — 400,000 short. The fix is not a
 * better subtraction, it is being clear about what the headline total MEANS:
 * old gold is a payment made in metal, not a discount on the goods, so it comes
 * off the balance rather than off the total.
 */
describe('the payment chain reconciles on the slip', () => {
  const rule = RULES['add on net'] as WastageRule

  const invoiceWith = (
    customerGold: Weight,
    amountPaid: Money,
    roundingNearestRupees = 1,
  ) => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    return {
      totals,
      invoice: computeRetailInvoice({
        totals,
        customerGold,
        customerGoldRatePerTola: RATE,
        hallmarkCharges: Money.fromRupees(25_000),
        otherCharges: Money.ZERO,
        discount: Money.fromRupees(150_000),
        amountPaid,
        roundingNearestRupees,
      }),
    }
  }

  it('keeps the invoice total free of the customer’s old gold', () => {
    const { totals, invoice } = invoiceWith(parseTola('1.000'), Money.ZERO)
    expect(invoice.invoiceTotal.paisa).toBe(
      totals.itemsTotal.paisa + Money.fromRupees(25_000).paisa - Money.fromRupees(150_000).paisa,
    )
    // …and the gold is genuinely worth something, so this is not a vacuous pass.
    expect(invoice.customerGoldValue.isPositive).toBe(true)
  })

  it('subtracts BOTH the cash paid and the gold given, exactly once each', () => {
    const paid = Money.fromRupees(400_000)
    const { invoice } = invoiceWith(parseTola('1.000'), paid)
    expect(invoice.balance.paisa).toBe(
      invoice.invoiceTotal.paisa - paid.paisa - invoice.customerGoldValue.paisa,
    )
  })

  it('agrees with the payable form of the same arithmetic', () => {
    const paid = Money.fromRupees(400_000)
    const { invoice } = invoiceWith(parseTola('1.000'), paid)
    expect(invoice.grandTotal.paisa).toBe(
      invoice.invoiceTotal.paisa - invoice.customerGoldValue.paisa,
    )
    expect(invoice.balance.paisa).toBe(invoice.grandTotal.paisa - paid.paisa)
  })

  it('leaves nothing outstanding once both are paid in full', () => {
    const { invoice: probe } = invoiceWith(parseTola('1.000'), Money.ZERO)
    const { invoice } = invoiceWith(parseTola('1.000'), probe.grandTotal)
    expect(invoice.balance.paisa).toBe(0)
  })
})

describe('the invoice rounding step', () => {
  const rule = RULES['add on net'] as WastageRule

  const totalAt = (roundingNearestRupees: number) => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    return computeRetailInvoice({
      totals,
      customerGold: Weight.ZERO,
      customerGoldRatePerTola: null,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
      roundingNearestRupees,
    })
  }

  it('leaves the total exact to the paisa at the default step of 1', () => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    expect(totalAt(1).invoiceTotal.paisa).toBe(totals.itemsTotal.paisa)
    // The example genuinely carries paisa, so "exact" is being tested.
    expect(totals.itemsTotal.paisa % 100).not.toBe(0)
  })

  it('omitting the step behaves exactly as a step of 1', () => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    const without = computeRetailInvoice({
      totals,
      customerGold: Weight.ZERO,
      customerGoldRatePerTola: null,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
    })
    expect(without.invoiceTotal.paisa).toBe(totalAt(1).invoiceTotal.paisa)
  })

  it('lands on a round hundred rupees at 100', () => {
    const rounded = totalAt(100).invoiceTotal
    expect(rounded.paisa % 10_000).toBe(0)
    // Within half a step of the exact figure — rounded, not truncated.
    expect(Math.abs(rounded.paisa - totalAt(1).invoiceTotal.paisa)).toBeLessThanOrEqual(5_000)
  })

  it('lands on a round thousand rupees at 1000', () => {
    const rounded = totalAt(1000).invoiceTotal
    expect(rounded.paisa % 100_000).toBe(0)
    expect(Math.abs(rounded.paisa - totalAt(1).invoiceTotal.paisa)).toBeLessThanOrEqual(50_000)
  })

  it('carries the rounding into the balance, so the two never disagree', () => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    const paid = Money.fromRupees(100_000)
    const invoice = computeRetailInvoice({
      totals,
      customerGold: Weight.ZERO,
      customerGoldRatePerTola: null,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: paid,
      roundingNearestRupees: 100,
    })
    // The balance is derived from the ROUNDED total. If it were derived from the
    // exact one, the slip's own subtraction would be out by the rounding.
    expect(invoice.balance.paisa).toBe(invoice.invoiceTotal.paisa - paid.paisa)
    expect(invoice.invoiceTotal.paisa % 10_000).toBe(0)
  })

  it('rounds a line-priced total only once, at the end', () => {
    // Two lines whose exact sum rounds differently from the sum of their
    // individually-rounded selves. Rounding per line would show a total that
    // disagrees with the column above it.
    const lines = [
      computeRetailLine({ ...EXAMPLE, labourCharges: Money.parse('40.00') }, rule),
      computeRetailLine({ ...EXAMPLE, labourCharges: Money.parse('40.00') }, rule),
    ]
    const totals = totalsOfRetail(lines)
    const invoice = computeRetailInvoice({
      totals,
      customerGold: Weight.ZERO,
      customerGoldRatePerTola: null,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
      roundingNearestRupees: 100,
    })
    expect(totals.itemsTotal.paisa).toBe(
      lines[0]!.lineAmount.paisa + lines[1]!.lineAmount.paisa,
    )
    expect(invoice.invoiceTotal.paisa % 10_000).toBe(0)
  })
})

describe('old gold traded in', () => {
  const rule = RULES['add on net'] as WastageRule

  it('is valued at its OWN purity rate, not the sale rate', () => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    const at22 = computeRetailInvoice({
      totals,
      customerGold: parseTola('1.000'),
      customerGoldRatePerTola: RATE,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
    })
    const at21 = computeRetailInvoice({
      totals,
      customerGold: parseTola('1.000'),
      customerGoldRatePerTola: Money.fromRupees(220_000),
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
    })
    // Lower-purity metal is worth less, so more is left to pay.
    expect(at21.grandTotal.paisa).toBeGreaterThan(at22.grandTotal.paisa)
  })

  it('contributes nothing when no rate is known for it', () => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    const invoice = computeRetailInvoice({
      totals,
      customerGold: parseTola('1.000'),
      customerGoldRatePerTola: null,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
    })
    expect(invoice.customerGoldValue.isZero).toBe(true)
  })

  it('reports remaining gold as fine sold less gold received', () => {
    const totals = totalsOfRetail([computeRetailLine(EXAMPLE, rule)])
    const invoice = computeRetailInvoice({
      totals,
      customerGold: parseTola('1.000'),
      customerGoldRatePerTola: RATE,
      hallmarkCharges: Money.ZERO,
      otherCharges: Money.ZERO,
      discount: Money.ZERO,
      amountPaid: Money.ZERO,
    })
    expect(invoice.remainingGold.milligrams).toBe(
      totals.totalFine.milligrams - parseTola('1.000').milligrams,
    )
  })
})

describe('tola conversion', () => {
  it('round-trips three decimal places', () => {
    expect(formatTola(parseTola('4.050'))).toBe('4.050')
    expect(formatTola(parseTola('0.001'))).toBe('0.001')
    expect(formatTola(parseTola('1234.567'))).toBe('1,234.567')
  })

  it('holds one tola as exactly 11,664 mg', () => {
    expect(parseTola('1.000').milligrams).toBe(11_664)
  })

  it('refuses more precision than the trade quotes', () => {
    expect(() => parseTola('1.0001')).toThrow(/three decimal places/)
  })

  it('formats a negative without losing the sign', () => {
    expect(formatTola(Weight.fromMilligrams(-11_664))).toBe('-1.000')
  })
})
