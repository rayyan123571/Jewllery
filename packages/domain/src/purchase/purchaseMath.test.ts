import { describe, expect, it } from 'vitest'
import { Katt } from '../wholesale/Katt.js'
import { Money } from '../common/Money.js'
import { Weight } from '../common/Weight.js'
import { checkStoredFigures, computePurchaseLine, totalsOfPurchase } from './purchaseMath.js'
import type { PurchaseEntryWithLines } from './PurchaseEntry.js'

/**
 * The acceptance arithmetic, against the gold-testing lab's own figure.
 *
 *   purityFraction = 1 − katt / 96
 *   khalis         = gross × purityFraction
 *   amount         = (khalis / 11.664) × ratePerTola
 *
 * In integers: khalis_mg = gross_mg × (96000 − katt_milliRatti) / 96000, and
 * 5425 × 76410 / 96000 = 4317.96… → 4318 mg. The lab's 4.3180 g reproduces to
 * the milligram, which is the whole reason weight is stored in milligrams.
 */

const RATE = Money.parse('402000')

function line(gross: string, katt: string) {
  return computePurchaseLine({
    itemName: 'OLD GOLD',
    gross: Weight.parse(gross),
    katt: Katt.parse(katt),
    ratePerTola: RATE,
    bucket: 'SCRAP',
    remarks: null,
  })
}

describe('the purchase line', () => {
  it('reproduces the lab figure: 5.425 g at katt 19.59 → 4.318 g khalis', () => {
    expect(line('5.425', '19.59').khalis.format()).toBe('4.318')
  })

  it('computes 11.381 g at katt 8.75 → 10.344 g khalis', () => {
    // 11381 × (96000 − 8750) / 96000 = 10343.67… → 10344 mg. The spec sheet
    // said 10.346; the formula it also gives says 10.344, and the formula is
    // the thing the lab figure above verifies.
    expect(line('11.381', '8.75').khalis.format()).toBe('10.344')
  })

  it('prices the khalis, not the gross', () => {
    const computed = line('5.425', '19.59')
    // 4318 mg × 40 200 000 paisa / 11 664 mg-per-tola = 14 881 995.9… paisa,
    // rounded half away from zero once: Rs 148,819.96.
    expect(computed.amount.paisa).toBe(14_881_996)
  })

  it('katt 0 buys the full gross; katt 96 buys nothing', () => {
    expect(line('5.425', '0').khalis.format()).toBe('5.425')
    expect(line('5.425', '96').khalis.format()).toBe('0.000')
  })

  it('totals are sums of the rounded per-line figures, so the column adds up', () => {
    const lines = [line('5.425', '19.59'), line('11.381', '8.75')]
    const totals = totalsOfPurchase(lines)
    expect(totals.grossTotal.format()).toBe('16.806')
    expect(totals.khalisTotal.format()).toBe('14.662')
    expect(totals.amountTotal.paisa).toBe(lines[0]!.amount.paisa + lines[1]!.amount.paisa)
  })
})

describe('checking a stored purchase against its own arithmetic', () => {
  function storedPurchase(
    tamper?: (khalisMg: number, lineNo: number) => number,
  ): PurchaseEntryWithLines {
    const computed = [line('5.425', '19.59'), line('11.381', '8.75')]
    const totals = totalsOfPurchase(computed)
    return {
      entry: {
        id: 'p1',
        branchId: 'b1',
        partyId: 'party-1',
        invoiceNumber: 1,
        entryDate: '2026-08-15' as PurchaseEntryWithLines['entry']['entryDate'],
        status: 'posted',
        ratePerTola: RATE,
        totalGross: totals.grossTotal,
        totalKhalis: totals.khalisTotal,
        totalAmount: totals.amountTotal,
        notes: null,
        cancelledAt: null,
        cancelReason: null,
        createdByUserId: 'u1',
        createdAt: '2026-08-15T09:00:00.000Z' as PurchaseEntryWithLines['entry']['createdAt'],
        updatedAt: '2026-08-15T09:00:00.000Z' as PurchaseEntryWithLines['entry']['updatedAt'],
      },
      lines: computed.map((l, i) => ({
        id: `l${i}`,
        lineNo: i + 1,
        itemName: l.itemName,
        gross: l.gross,
        katt: l.katt,
        khalis: tamper ? Weight.fromMilligrams(tamper(l.khalis.milligrams, i + 1)) : l.khalis,
        ratePerTola: l.ratePerTola,
        amount: l.amount,
        bucket: l.bucket,
        remarks: l.remarks,
      })),
    }
  }

  it('agrees when the stored figures reproduce', () => {
    expect(checkStoredFigures(storedPurchase()).agrees).toBe(true)
  })

  it('tolerates a single milligram — two scales disagree at the third decimal', () => {
    const oneOff = storedPurchase((mg, lineNo) => (lineNo === 1 ? mg + 1 : mg))
    expect(checkStoredFigures(oneOff).agrees).toBe(true)
  })

  it('names the lines that no longer reproduce', () => {
    const check = checkStoredFigures(storedPurchase((mg) => mg + 5))
    expect(check.agrees).toBe(false)
    expect(check.disagreeingLineNos).toEqual([1, 2])
  })
})
