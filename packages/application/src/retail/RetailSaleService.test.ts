import {
  Money,
  Weight,
  fixedClock,
  formatTola,
  parseTola,
  toIsoDate,
  type PublicUser,
} from '@jewellery/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FakeAuditRepository,
  FakeCustomerRepository,
  FakeGoldRateRepository,
  FakeRetailBillRepository,
  FakeRetailSaleRepository,
  FakeSalesmanRepository,
  FakeSettingsRepository,
} from '../testing/fakes.js'
import { RateService } from '../rates/RateService.js'
import { Settings, SETTING_KEYS } from '../settings/keys.js'
import { ValidationError } from '../auth/AuthService.js'
import {
  HighWastageRequiresConfirmationError,
  RetailSaleService,
  type RetailBillInput,
  type RetailDraftInput,
  type RetailItemInput,
  type RetailSlipInput,
} from './RetailSaleService.js'

// No database, no window.

const clock = fixedClock('2026-08-30T09:00:00.000Z')
const BRANCH = 'branch-1'
const TODAY = toIsoDate('2026-08-30')

const actor: PublicUser = {
  id: 'user-1',
  branchId: BRANCH,
  name: 'Admin',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

let rates: FakeGoldRateRepository
let audit: FakeAuditRepository
let customers: FakeCustomerRepository
let salesmen: FakeSalesmanRepository
let sales: FakeRetailSaleRepository
let bills: FakeRetailBillRepository
let settingsRepo: FakeSettingsRepository
let service: RetailSaleService

const ITEM: RetailItemInput = {
  itemName: 'Bangles',
  purity: 'K22',
  grossWeight: parseTola('4.050'),
  stoneWeight: Weight.ZERO,
  purityDeduction: Weight.ZERO,
  wastageBp: 1400,
  labourCharges: Money.fromRupees(5_000),
  labourMode: 'fixed',
  stoneCharges: Money.ZERO,
}

function draft(overrides: Partial<RetailDraftInput> = {}): RetailDraftInput {
  return {
    branchId: BRANCH,
    saleDate: TODAY,
    saleTime: '14:05',
    customerId: null,
    customerName: 'Walk-in',
    customerMobile: null,
    salesmanId: null,
    ratePurity: 'K22',
    items: [ITEM],
    customerGold: Weight.ZERO,
    customerGoldPurity: null,
    hallmarkCharges: Money.ZERO,
    otherCharges: Money.ZERO,
    discount: Money.ZERO,
    amountPaid: Money.ZERO,
    paymentMethod: 'cash',
    remarks: null,
    ...overrides,
  }
}

/** A draft that pays exactly what it comes to — the walk-in rule needs this. */
function paidInFull(overrides: Partial<RetailDraftInput> = {}): RetailDraftInput {
  const base = draft(overrides)
  return { ...base, amountPaid: service.calculate(base).grandTotal }
}

beforeEach(() => {
  rates = new FakeGoldRateRepository(clock)
  audit = new FakeAuditRepository(clock)
  customers = new FakeCustomerRepository()
  salesmen = new FakeSalesmanRepository()
  sales = new FakeRetailSaleRepository()
  bills = new FakeRetailBillRepository(sales)
  settingsRepo = new FakeSettingsRepository()
  rates.seed(BRANCH, 'K22', 237_970, '2026-08-01')
  service = new RetailSaleService({
    retailSales: sales,
    retailBills: bills,
    customers,
    salesmen,
    audit,
    rates: new RateService({ goldRates: rates, audit, clock }),
    settings: new Settings(settingsRepo),
    clock,
  })
})

describe('the calculation the screen sees', () => {
  it('is produced by the service, never by the renderer', () => {
    const result = service.calculate(draft())
    expect(result.lines).toHaveLength(1)
    expect(result.grandTotal.paisa).toBeGreaterThan(0)
    expect(result.amountInWords).toMatch(/^Rupees /)
  })

  it('tolerates an empty draft rather than throwing on every keystroke', () => {
    const result = service.calculate(draft({ items: [] }))
    expect(result.grandTotal.isZero).toBe(true)
    expect(result.amountInWords).toBe('Rupees Zero Only')
  })

  it('warns rather than throws when no rate is recorded', () => {
    const result = service.calculate(draft({ ratePurity: 'K18' }))
    expect(result.warnings.join(' ')).toMatch(/No 18K rate is recorded/)
  })

  it('uses the rule from settings and reports which one it used', () => {
    settingsRepo.set(SETTING_KEYS.retailWastageDirection, 'subtract')
    settingsRepo.set(SETTING_KEYS.retailWastageBasis, 'gross')
    const result = service.calculate(draft())
    expect(result.rule).toEqual({ direction: 'subtract', basis: 'gross' })
  })
})

describe('the ten rules that refuse a sale', () => {
  it('1. refuses a sale with no items', () => {
    expect(() => service.validate(draft({ items: [] }))).toThrow(
      /Add at least one item before saving/,
    )
  })

  it('2a. refuses an item with no weight', () => {
    expect(() =>
      service.validate(draft({ items: [{ ...ITEM, grossWeight: Weight.ZERO }] })),
    ).toThrow(/has no weight/)
  })

  it('2b. refuses an item with nothing left after stone and cut', () => {
    expect(() =>
      service.validate(
        draft({ items: [{ ...ITEM, stoneWeight: parseTola('5.000') }] }),
      ),
    ).toThrow(/nothing left after the stone weight and cut/)
  })

  it('2c. refuses an unnamed item — the name prints on the invoice', () => {
    expect(() => service.validate(draft({ items: [{ ...ITEM, itemName: '  ' }] }))).toThrow(
      /needs an item name/,
    )
  })

  it('3. refuses a sale with no rate for that purity and date, never defaulting to zero', () => {
    expect(() => service.validate(draft({ ratePurity: 'K18' }))).toThrow(
      /No 18K gold rate has been recorded/,
    )
  })

  it('4a. refuses wastage above the 50% ceiling — that is a typo, not a rate', () => {
    expect(() => service.validate(draft({ items: [{ ...ITEM, wastageBp: 5_001 }] }))).toThrow(
      /Wastage must be between 0% and 50%/,
    )
  })

  it('4b. refuses negative wastage', () => {
    expect(() => service.validate(draft({ items: [{ ...ITEM, wastageBp: -1 }] }))).toThrow(
      /Wastage must be between/,
    )
  })

  it('4c. asks for confirmation above 25%, and allows it once confirmed', () => {
    const high = draft({ items: [{ ...ITEM, wastageBp: 3_000 }] })
    expect(() => service.validate(high)).toThrow(HighWastageRequiresConfirmationError)
    expect(() => service.validate(high)).toThrow(/Continue\?/)

    const confirmed = { ...high, confirmedHighWastage: true }
    expect(() =>
      service.validate({ ...confirmed, amountPaid: service.calculate(confirmed).grandTotal }),
    ).not.toThrow()
  })

  it('5. refuses a discount larger than the sale', () => {
    expect(() =>
      service.validate(draft({ discount: Money.fromRupees(10_000_000) })),
    ).toThrow(/more than the sale is worth/)
  })

  it('6. refuses old gold worth more than the sale — that is a purchase', () => {
    expect(() =>
      service.validate(
        draft({ customerGold: parseTola('100.000'), customerGoldPurity: 'K22' }),
      ),
    ).toThrow(/Record the difference as a purchase/)
  })

  it('7. refuses a part-paid walk-in — there is no ledger to carry the balance', () => {
    expect(() => service.validate(draft({ amountPaid: Money.fromRupees(100) }))).toThrow(
      /walk-in customer has no account to carry a balance/,
    )
  })

  it('7b. accepts a part-paid ACCOUNT customer', () => {
    const customer = customers.create(
      {
        code: 'C-0001',
        name: 'Ahmed',
        mobile: null,
        address: null,
        city: null,
        cnic: null,
        isWalkIn: false,
        openingGold: Weight.ZERO,
        openingCash: Money.ZERO,
      },
      actor.id,
    )
    expect(() =>
      service.validate(
        draft({
          customerId: customer.id,
          customerName: 'Ahmed',
          amountPaid: Money.fromRupees(100),
        }),
      ),
    ).not.toThrow()
  })

  it('8. refuses credit without a customer account', () => {
    expect(() => service.validate(draft({ paymentMethod: 'credit' }))).toThrow(
      /credit sale needs a customer account/,
    )
  })

  it('9. posting the same draft twice returns the first sale, never a second', () => {
    // Two invoices for one transaction means the gold left the shop once and
    // the books say twice.
    const input = paidInFull({ draftId: 'draft-abc' })
    const first = service.post(actor, input)
    const second = service.post(actor, input)
    expect(second.sale.id).toBe(first.sale.id)
    expect(second.sale.invoiceNo).toBe(first.sale.invoiceNo)
    expect(sales.rows).toHaveLength(1)
  })

  it('10. refuses a negative amount paid', () => {
    expect(() =>
      service.validate(draft({ amountPaid: Money.fromRupees(-1) })),
    ).toThrow(/cannot be negative/)
  })

  it('refuses a customer id that no longer exists', () => {
    expect(() => service.validate(draft({ customerId: 'gone' }))).toThrow(
      /no longer exists/,
    )
  })

  it('throws ValidationError, so the IPC layer turns each into ok:false', () => {
    expect(() => service.validate(draft({ items: [] }))).toThrow(ValidationError)
  })
})

describe('posting', () => {
  it('writes the sale, its items and an audit entry', () => {
    const posted = service.post(actor, paidInFull())
    expect(posted.sale.invoiceNo).toBe('RS-00001')
    expect(posted.items).toHaveLength(1)
    expect(audit.entries.at(-1)?.action).toBe('TRANSACTION_POSTED')
  })

  it('stores the amount in words rendered once, at post time', () => {
    const posted = service.post(actor, paidInFull())
    expect(posted.sale.amountInWords).toMatch(/^Rupees .+ Only$/)
  })

  it('stores the rate it priced with, not a rate looked up later', () => {
    const posted = service.post(actor, paidInFull())
    expect(posted.sale.ratePerTola.paisa).toBe(Money.fromRupees(237_970).paisa)
  })
})

describe('a posted sale reprints identically after the wastage rule changes', () => {
  it('keeps every figure it was saved with when the setting is changed underneath it', () => {
    // The point of storing the rule on the row. Without it, changing the
    // setting would silently re-price every past invoice the next time one was
    // reprinted, and the paper in the customer's hand would stop matching the
    // screen — history moving under the shop's feet.
    const posted = service.post(actor, paidInFull())
    const before = {
      invoiceNo: posted.sale.invoiceNo,
      grandTotal: posted.sale.grandTotal.paisa,
      fine: posted.items[0]?.fineWeight.milligrams,
      wastage: posted.items[0]?.wastage.milligrams,
      words: posted.sale.amountInWords,
      direction: posted.sale.wastageDirection,
      basis: posted.sale.wastageBasis,
    }

    settingsRepo.set(SETTING_KEYS.retailWastageDirection, 'subtract')
    settingsRepo.set(SETTING_KEYS.retailWastageBasis, 'gross')

    // A brand-new sale prices differently — the setting genuinely took effect.
    expect(service.calculate(draft()).grandTotal.paisa).not.toBe(before.grandTotal)

    // The posted one does not move.
    const reread = service.findById(posted.sale.id)
    expect(reread?.sale.grandTotal.paisa).toBe(before.grandTotal)
    expect(reread?.items[0]?.fineWeight.milligrams).toBe(before.fine)
    expect(reread?.items[0]?.wastage.milligrams).toBe(before.wastage)
    expect(reread?.sale.amountInWords).toBe(before.words)
    expect(reread?.sale.wastageDirection).toBe(before.direction)
    expect(reread?.sale.wastageBasis).toBe(before.basis)
  })
})

describe('voiding', () => {
  it('needs a reason, which stays on the record', () => {
    const posted = service.post(actor, paidInFull())
    expect(() => service.void(actor, posted.sale.id, '   ')).toThrow(/needs a reason/)
  })

  it('refuses to void twice', () => {
    const posted = service.post(actor, paidInFull())
    service.void(actor, posted.sale.id, 'entered twice')
    expect(() => service.void(actor, posted.sale.id, 'again')).toThrow(/already been voided/)
  })

  it('burns the invoice number — the next sale takes the following one', () => {
    const first = service.post(actor, paidInFull({ draftId: 'a' }))
    service.void(actor, first.sale.id, 'entered twice')
    const second = service.post(actor, paidInFull({ draftId: 'b' }))
    expect(second.sale.invoiceNo).toBe('RS-00002')
  })
})

/**
 * One visit, several slips.
 *
 * The guarantee under test is the whole reason a bill exists as a row rather
 * than as a convention: **either every slip posts or none of them does.** A
 * bill that wrote two of its three slips is worse than one that wrote none —
 * the customer walks out with two invoices and a third piece of gold that
 * nothing in the books accounts for, and no screen shows anything is missing.
 */
describe('a bill posts atomically, or not at all', () => {
  const slip = (
    slipNo: number,
    label: string,
    overrides: Partial<RetailSlipInput> = {},
  ): RetailSlipInput => ({
    slipNo,
    slipLabel: label,
    items: [ITEM],
    customerGold: Weight.ZERO,
    customerGoldPurity: null,
    hallmarkCharges: Money.ZERO,
    otherCharges: Money.ZERO,
    discount: Money.ZERO,
    amountPaid: Money.ZERO,
    paymentMethod: 'cash',
    remarks: null,
    ...overrides,
  })

  /** Every slip paid in full, which is what the walk-in rule demands. */
  const bill = (slips: readonly RetailSlipInput[]): RetailBillInput => {
    const base: RetailBillInput = {
      branchId: BRANCH,
      saleDate: TODAY,
      saleTime: '14:05',
      customerId: null,
      customerName: 'Walk-in',
      customerMobile: null,
      salesmanId: null,
      ratePurity: 'K22',
      slips,
    }
    return {
      ...base,
      slips: slips.map((s) => ({
        ...s,
        amountPaid: service.calculate({
          ...draft({ items: s.items }),
          hallmarkCharges: s.hallmarkCharges,
          otherCharges: s.otherCharges,
          discount: s.discount,
        }).grandTotal,
      })),
    }
  }

  it('writes every slip under one bill, each with its own invoice number', () => {
    const posted = service.postBill(
      actor,
      bill([slip(1, 'Full Bill'), slip(2, 'Gold Bangles'), slip(3, 'Gold Chain')]),
    )
    expect(posted.slips).toHaveLength(3)
    expect(posted.bill.billNo).toBe('RB-00001')
    // Distinct documents, from the same continuous retail sequence.
    expect(posted.slips.map((s) => s.sale.invoiceNo)).toEqual([
      'RS-00001',
      'RS-00002',
      'RS-00003',
    ])
    expect(posted.slips.map((s) => s.slipNo)).toEqual([1, 2, 3])
    expect(posted.slips.map((s) => s.slipLabel)).toEqual([
      'Full Bill',
      'Gold Bangles',
      'Gold Chain',
    ])
  })

  it('shares the customer, the date and the salesman across every slip', () => {
    const posted = service.postBill(actor, bill([slip(1, 'Full Bill'), slip(2, 'Tops')]))
    for (const written of posted.slips) {
      expect(written.sale.customerNameSnapshot).toBe('Walk-in')
      expect(written.sale.saleDate).toBe(TODAY)
      expect(written.sale.saleTime).toBe('14:05')
    }
  })

  it('writes NOTHING when a later slip fails at write time', () => {
    // Slip 3 fails the way a CHECK constraint would — after every slip has
    // already passed validation, which is precisely the case a per-slip write
    // would get wrong.
    bills.failOnSlipNo = 3
    expect(() =>
      service.postBill(
        actor,
        bill([slip(1, 'Full Bill'), slip(2, 'Gold Bangles'), slip(3, 'Gold Chain')]),
      ),
    ).toThrow(/CHECK constraint failed/)

    expect(bills.bills).toHaveLength(0)
    expect(sales.rows).toHaveLength(0)
  })

  it('leaves the invoice sequence untouched by a bill that failed', () => {
    bills.failOnSlipNo = 2
    expect(() =>
      service.postBill(actor, bill([slip(1, 'Full Bill'), slip(2, 'Gold Bangles')])),
    ).toThrow()

    // The next real sale takes the FIRST number. A rolled-back allocation that
    // stayed spent would leave a gap the database never actually produced.
    bills.failOnSlipNo = null
    const posted = service.post(actor, paidInFull({ draftId: 'after-failure' }))
    expect(posted.sale.invoiceNo).toBe('RS-00001')
  })

  it('refuses the whole bill when ONE slip breaks a rule, and names that slip', () => {
    expect(() =>
      service.postBill(
        actor,
        bill([slip(1, 'Full Bill'), slip(2, 'Gold Chain', { items: [] })]),
      ),
    ).toThrow(/Slip 2 \(Gold Chain\): Add at least one item/)
    // Validated before anything was written, so slip 1 never reached the disk.
    expect(sales.rows).toHaveLength(0)
  })

  it('refuses a bill with no slips at all', () => {
    expect(() => service.postBill(actor, bill([]))).toThrow(/at least one slip/)
  })

  it('records one audit entry for the bill, naming every invoice it produced', () => {
    service.postBill(actor, bill([slip(1, 'Full Bill'), slip(2, 'Gold Bangles')]))
    const entry = audit.entries.find((e) => e.entity === 'retail_bills')
    expect(entry?.action).toBe('TRANSACTION_POSTED')
    expect(entry?.detail).toContain('RS-00001')
    expect(entry?.detail).toContain('RS-00002')
  })
})

describe('the worked example from the brief', () => {
  it('computes add-on-net as the defaults specify', () => {
    const line = service.calculate(
      draft({ items: [{ ...ITEM, purityDeduction: parseTola('0.570'), labourCharges: Money.ZERO }] }),
    ).lines[0]
    // The deduction is ABSOLUTE: 4.050 less 0.570 is 3.480, not 4.050 less
    // 0.570-per-tola. See the ruling on RetailLineInput.purityDeduction.
    expect(formatTola(line?.netWeight ?? Weight.ZERO)).toBe('3.480')
    expect(formatTola(line?.wastage ?? Weight.ZERO)).toBe('0.487')
    expect(formatTola(line?.fineWeight ?? Weight.ZERO)).toBe('3.967')
    expect(line?.lineAmount.format()).toBe('944,086.40')
  })
})
