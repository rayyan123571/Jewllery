import { Money, Weight, fixedClock, toIsoTimestamp, type PublicUser } from '@jewellery/domain'
import {
  CustomerService,
  FakeAuditRepository,
  FakeCustomerRepository,
  FakeGoldRateRepository,
  FakeRetailSaleRepository,
  FakeSalesmanRepository,
  FakeSettingsRepository,
  RateService,
  RetailSaleService,
  SETTING_KEYS,
  Settings,
} from '@jewellery/application'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  checkExternalUrl,
  customerCreate,
  customerSearch,
  retailCalculate,
  retailHold,
  retailList,
  retailLoad,
  retailNextInvoiceNo,
  retailReceipt,
  retailRounding,
  retailRoundingSet,
  retailSave,
  retailVoid,
  retailWastageRule,
  retailWastageRuleSet,
  salesmenList,
  type RetailHandlerDeps,
} from './retailHandlers.js'
import type { RetailDraftDto, RetailItemDto } from '../shared/ipc.js'

/**
 * The IPC layer, with no Electron and no window.
 *
 * This is why the handler bodies live in `retailHandlers.ts` rather than inside
 * `ipcMain.handle` calls: every refusal below is a path the renderer can reach,
 * and a refusal that is only exercised by launching the app is a refusal nobody
 * finds out is broken.
 *
 * What is checked here is the BOUNDARY's own contract, not the arithmetic —
 * that is covered with no database at all in the domain and application suites:
 *
 *   1. no session, no write
 *   2. no permission, no void and no rule change
 *   3. nothing throws across the gap; every failure is { ok: false, message }
 *   4. a half-typed draft still answers, because that is the normal state of a
 *      screen that calls this on every keystroke
 */

const clock = fixedClock('2026-08-30T09:00:00.000Z')
const BRANCH = 'branch-1'

const admin: PublicUser = {
  id: 'user-1',
  branchId: BRANCH,
  name: 'Administrator',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

const salesman: PublicUser = { ...admin, id: 'user-2', name: 'Bilal', role: 'SALESMAN' }

let deps: RetailHandlerDeps
let rates: FakeGoldRateRepository
let customers: FakeCustomerRepository
let salesmen: FakeSalesmanRepository
let settingsRepo: FakeSettingsRepository

function build(user: PublicUser | null): RetailHandlerDeps {
  const audit = new FakeAuditRepository(clock)
  rates = new FakeGoldRateRepository(clock)
  customers = new FakeCustomerRepository()
  salesmen = new FakeSalesmanRepository()
  settingsRepo = new FakeSettingsRepository()
  const settings = new Settings(settingsRepo)
  const rateService = new RateService({ goldRates: rates, audit, clock })
  rates.seed(BRANCH, 'K22', 237_970, '2026-08-01')

  return {
    branchId: BRANCH,
    retail: new RetailSaleService({
      retailSales: new FakeRetailSaleRepository(),
      customers,
      salesmen,
      audit,
      rates: rateService,
      settings,
      clock,
    }),
    customers: new CustomerService({ customers, audit }),
    settings,
    shopProfile: () => ({
      name: 'AL-HARAM GOLD JEWELLERS',
      tagline: 'Trust in Purity',
      ownerName: 'Haji Abdul Rehman',
      secondOwnerName: null,
      phone1: '0300-7779999',
      phone2: null,
      phone3: null,
      address: 'Sona Bazaar, Lahore',
      logoPath: null,
      updatedAt: toIsoTimestamp(new Date('2026-08-01T00:00:00.000Z')),
    }),
    session: { user },
  }
}

beforeEach(() => {
  deps = build(admin)
})

function weightField(text: string) {
  return { text, exactMg: null }
}

function item(overrides: Partial<RetailItemDto> = {}): RetailItemDto {
  return {
    itemName: 'GOLD BANGLE',
    purity: 'K22',
    grossWeight: weightField('47.240'),
    stoneWeight: weightField(''),
    cutPerTola: weightField(''),
    wastagePercent: '14.00',
    labourCharges: '4500',
    labourMode: 'fixed',
    stoneCharges: '',
    ...overrides,
  }
}

function draft(overrides: Partial<RetailDraftDto> = {}): RetailDraftDto {
  return {
    draftId: 'draft-1',
    saleDate: '2026-08-30',
    saleTime: '12:48',
    customerId: null,
    customerName: 'IMRAN SAHIB',
    customerMobile: '03001234567',
    salesmanId: null,
    ratePurity: 'K22',
    ratePerTolaOverride: '',
    weightUnit: 'gram',
    items: [item()],
    customerGold: weightField(''),
    customerGoldPurity: 'K22',
    hallmarkCharges: '',
    otherCharges: '',
    discount: '',
    amountPaid: '',
    paymentMethod: 'cash',
    remarks: null,
    ...overrides,
  }
}

/** Paid in full, which is what a walk-in has to be. */
function payable(): RetailDraftDto {
  const computed = retailCalculate(deps, { draft: draft(), entry: null })
  return draft({ amountPaid: computed.grandTotal.rupees })
}

describe('a handler refuses without a session', () => {
  beforeEach(() => {
    deps = build(null)
  })

  it('refuses to save, rather than writing a row it cannot attribute', () => {
    const result = retailSave(deps, { draft: payable() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('attributed')
  })

  it('refuses to hold', () => {
    expect(retailHold(deps, { draft: draft() }).ok).toBe(false)
  })

  it('refuses to void', () => {
    expect(retailVoid(deps, 'sale-1', 'wrong item').ok).toBe(false)
  })

  it('refuses to create a customer', () => {
    expect(customerCreate(deps, newCustomer()).ok).toBe(false)
  })

  it('returns nothing rather than leaking a customer list', () => {
    expect(customerSearch(deps, 'IM')).toEqual([])
    expect(salesmenList(deps)).toEqual([])
    expect(retailList(deps, {})).toEqual([])
    expect(retailLoad(deps, { saleId: 'sale-1' })).toBeNull()
    expect(retailReceipt(deps, 'sale-1')).toBeNull()
  })

  it('still calculates, because a calculation writes nothing and owns nothing', () => {
    // Deliberately NOT gated. `calculate` is pure, and a screen that cannot
    // show a total until somebody is signed in is a screen that shows nothing
    // at all while the session is being established at startup.
    const result = retailCalculate(deps, { draft: draft(), entry: null })
    expect(result.grandTotal.paisa).toBeGreaterThan(0)
  })
})

function newCustomer() {
  return {
    name: 'IMRAN SAHIB',
    mobile: '03001234567',
    address: '',
    city: 'Lahore',
    cnic: '',
    isWalkIn: false,
    openingGoldGrams: '',
    openingCashRupees: '',
  }
}

describe('role permissions are enforced, not merely declared', () => {
  it('refuses a void by a salesman — selling all day is not unselling', () => {
    const posted = retailSave(deps, { draft: payable() })
    expect(posted.ok).toBe(true)
    if (!posted.ok) return

    const asSalesman: RetailHandlerDeps = { ...deps, session: { user: salesman } }
    const result = retailVoid(asSalesman, posted.saleId, 'wrong item')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not allowed')
  })

  it('allows a void by an administrator, with a reason', () => {
    const posted = retailSave(deps, { draft: payable() })
    expect(posted.ok).toBe(true)
    if (!posted.ok) return
    expect(retailVoid(deps, posted.saleId, 'wrong item').ok).toBe(true)
  })

  it('refuses a void with no reason — it stays on the record', () => {
    const posted = retailSave(deps, { draft: payable() })
    expect(posted.ok).toBe(true)
    if (!posted.ok) return
    const result = retailVoid(deps, posted.saleId, '   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('reason')
  })

  it('refuses a wastage rule change by a salesman', () => {
    const asSalesman: RetailHandlerDeps = { ...deps, session: { user: salesman } }
    const result = retailWastageRuleSet(asSalesman, { direction: 'subtract', basis: 'gross' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not allowed')
    // And nothing was written.
    expect(settingsRepo.get(SETTING_KEYS.retailWastageDirection)).toBeNull()
  })

  it('allows an administrator to set the rule, and refuses a nonsense one', () => {
    expect(retailWastageRuleSet(deps, { direction: 'subtract', basis: 'gross' }).ok).toBe(true)
    expect(settingsRepo.get(SETTING_KEYS.retailWastageBasis)).toBe('gross')

    const bad = retailWastageRuleSet(deps, { direction: 'sideways', basis: 'gross' })
    expect(bad.ok).toBe(false)
    // The stored value is untouched by the refused write.
    expect(settingsRepo.get(SETTING_KEYS.retailWastageDirection)).toBe('subtract')
  })
})

describe('nothing throws across the boundary', () => {
  it('turns a validation failure into a message, not a rejected promise', () => {
    const result = retailSave(deps, { draft: draft({ items: [] }) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('at least one item')
  })

  it('refuses a save with no draft id, because a retry could not be deduplicated', () => {
    const result = retailSave(deps, { draft: draft({ draftId: '' }) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('draft id')
  })

  it('reports high wastage as a question, not as a plain failure', () => {
    const result = retailSave(deps, {
      draft: draft({ items: [item({ wastagePercent: '30.00' })] }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok && 'needsConfirmation' in result) {
      expect(result.needsConfirmation).toBe(true)
      expect(result.message).toContain('30.00%')
    } else {
      throw new Error('expected a confirmation, got a plain refusal')
    }
  })

  it('goes through once the confirmation comes back', () => {
    const high = draft({ items: [item({ wastagePercent: '30.00' })] })
    const priced = retailCalculate(deps, { draft: high, entry: null })
    const result = retailSave(deps, {
      draft: { ...high, amountPaid: priced.grandTotal.rupees, confirmedHighWastage: true },
    })
    expect(result.ok).toBe(true)
  })

  it('turns an unparseable amount into a message rather than an exception', () => {
    const result = retailSave(deps, { draft: draft({ discount: '1,2.3.4' }) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0)
  })

  it('refuses a customer with a mobile that is not a phone number', () => {
    const result = customerCreate(deps, { ...newCustomer(), mobile: 'ring me' })
    expect(result.ok).toBe(false)
  })
})

describe('calculate is tolerant, because it runs on every keystroke', () => {
  it('answers for an empty draft rather than throwing', () => {
    const result = retailCalculate(deps, { draft: draft({ items: [] }), entry: null })
    expect(result.grandTotal.rupees).toBe('0.00')
    expect(result.amountInWords).toBe('Rupees Zero Only')
  })

  it('reports an unparseable line as an error and leaves it out of the totals', () => {
    const result = retailCalculate(deps, {
      // "12." is deliberately NOT used here: Weight.parse accepts a trailing
      // point, which is what makes typing "12.5" one character at a time work.
      // This is text that can never become a weight.
      draft: draft({ items: [item(), item({ grossWeight: weightField('1.2.3') })] }),
      entry: null,
    })
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]?.error).toBeNull()
    expect(result.lines[1]?.error).not.toBeNull()
    // The good line alone is the total.
    const alone = retailCalculate(deps, { draft: draft(), entry: null })
    expect(result.grandTotal.paisa).toBe(alone.grandTotal.paisa)
  })

  it('computes the row being typed WITHOUT putting it in the totals', () => {
    const empty = retailCalculate(deps, { draft: draft({ items: [] }), entry: item() })
    expect(empty.entry?.fine.mg).toBeGreaterThan(0)
    // Nothing has been added to the sale yet.
    expect(empty.grandTotal.paisa).toBe(0)
    expect(empty.lines).toHaveLength(0)
  })

  it('says a rate is MISSING rather than reporting it as zero', () => {
    const result = retailCalculate(deps, {
      draft: draft({ ratePurity: 'K18' }),
      entry: null,
    })
    expect(result.rateMissing).toBe(true)
    expect(result.rateDisplay).toBeNull()
    expect(result.warnings.join(' ')).toContain('No 18K rate')
  })

  it('gives every weight in both units, so a unit toggle converts nothing', () => {
    const result = retailCalculate(deps, { draft: draft(), entry: null })
    const gross = result.lines[0]?.gross
    expect(gross?.mg).toBe(47_240)
    expect(gross?.gram).toBe('47.240')
    expect(gross?.tola).toBe('4.050')
  })

  it('reads a weight typed in tola as tola', () => {
    const result = retailCalculate(deps, {
      draft: draft({
        weightUnit: 'tola',
        items: [item({ grossWeight: weightField('4.050') })],
      }),
      entry: null,
    })
    // 4.050 tola is 47,239 mg — one milligram off the gram figure, which is
    // exactly why a toggle must not re-parse displayed text.
    expect(result.lines[0]?.gross.mg).toBe(47_239)
  })

  it('honours the exact milligram over the text, which is what makes the toggle safe', () => {
    const result = retailCalculate(deps, {
      draft: draft({
        weightUnit: 'tola',
        items: [item({ grossWeight: { text: '4.050', exactMg: 47_240 } })],
      }),
      entry: null,
    })
    expect(result.lines[0]?.gross.mg).toBe(47_240)
  })
})

describe('reading sales back', () => {
  it('previews the next invoice number without reserving it', () => {
    const first = retailNextInvoiceNo(deps)
    expect(first).toBe('RS-00001')
    expect(retailNextInvoiceNo(deps)).toBe(first)
  })

  it('loads a posted sale by id and by invoice number', () => {
    const posted = retailSave(deps, { draft: payable() })
    expect(posted.ok).toBe(true)
    if (!posted.ok) return

    const byId = retailLoad(deps, { saleId: posted.saleId })
    const byNumber = retailLoad(deps, { invoiceNo: posted.invoiceNo })
    expect(byId?.summary.invoiceNo).toBe(posted.invoiceNo)
    expect(byNumber?.summary.saleId).toBe(posted.saleId)
    expect(byId?.lines).toHaveLength(1)
  })

  it('returns null for a sale that does not exist', () => {
    expect(retailLoad(deps, { saleId: 'nope' })).toBeNull()
    expect(retailLoad(deps, {})).toBeNull()
  })

  it('filters the list by status', () => {
    retailSave(deps, { draft: payable() })
    retailHold(deps, { draft: draft({ draftId: 'draft-2' }) })

    expect(retailList(deps, {}).length).toBe(2)
    expect(retailList(deps, { status: 'held' }).map((row) => row.status)).toEqual(['held'])
    expect(retailList(deps, { status: 'posted' }).map((row) => row.status)).toEqual(['posted'])
  })

  it('builds the printed document for a posted sale', () => {
    const posted = retailSave(deps, { draft: payable() })
    expect(posted.ok).toBe(true)
    if (!posted.ok) return

    const html = retailReceipt(deps, posted.saleId)
    expect(html).not.toBeNull()
    expect(html).toContain('AL-HARAM GOLD JEWELLERS')
    expect(html).toContain(posted.invoiceNo)
    expect(html).toContain('IMRAN SAHIB')
    // The words stored on the row, not re-rendered on the way out.
    expect(html).toContain(posted.amountInWords)
  })
})

describe('holding a sale', () => {
  it('parks it without asking the payment questions', () => {
    // Nothing is paid, and the customer is a walk-in — a POST would be refused
    // for exactly that reason, which is the situation a hold exists for.
    const result = retailHold(deps, { draft: draft() })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status).toBe('held')
  })

  it('still refuses to park a sale with nothing on it', () => {
    expect(retailHold(deps, { draft: draft({ items: [] }) }).ok).toBe(false)
  })

  it('is idempotent on the draft id, exactly as posting is', () => {
    const first = retailHold(deps, { draft: draft() })
    const second = retailHold(deps, { draft: draft() })
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.invoiceNo).toBe(first.invoiceNo)
  })
})

describe('the wastage rule card', () => {
  it('works all four combinations through the real calculation core', () => {
    const rule = retailWastageRule(deps, null)
    for (const example of rule.examples) {
      expect(example.options).toHaveLength(4)
    }
  })

  it('keeps the sample from the brief as the first example', () => {
    const first = retailWastageRule(deps, null).examples[0]
    expect(first?.sample.grossTola).toBe('4.050')
    expect(first?.sample.stoneTola).toBe('0.000')
    expect(first?.sample.cutTola).toBe('0.000')
    expect(first?.sample.wastagePercent).toBe('14.00')
    expect(first?.sample.rateDisplay).toBe('Rs 237,970/tola')
  })

  it('shows that the brief’s sample cannot tell gross from net', () => {
    // With no stone and no cut, gross weight IS net weight, so two of the four
    // rules are the same invoice. This is not a rounding coincidence — it is
    // arithmetic — and a card that pretended otherwise would be lying.
    const first = retailWastageRule(deps, null).examples[0]
    const amounts = new Set(first?.options.map((option) => option.amountDisplay))
    expect(amounts.size).toBe(2)
  })

  it('adds a stone-set example, which is what separates all four', () => {
    const second = retailWastageRule(deps, null).examples[1]
    expect(second?.sample.stoneTola).toBe('0.250')
    const amounts = new Set(second?.options.map((option) => option.amountDisplay))
    expect(amounts.size).toBe(4)
  })

  it('marks the saved rule, and previews a different one without saving it', () => {
    const preview = retailWastageRule(deps, { direction: 'subtract', basis: 'gross' })
    expect(preview.savedDirection).toBe('add')
    expect(preview.savedBasis).toBe('net')
    const selected = preview.examples[0]?.options.find((option) => option.isSelected)
    expect(selected?.direction).toBe('subtract')
    expect(selected?.basis).toBe('gross')
    expect(preview.examples[0]?.options.find((option) => option.isSaved)?.direction).toBe('add')
    // Nothing was written by a preview.
    expect(settingsRepo.get(SETTING_KEYS.retailWastageDirection)).toBeNull()
  })
})

describe('the rounding card', () => {
  it('offers exactly the three steps, with the exact one saved by default', () => {
    const rounding = retailRounding(deps)
    expect(rounding.savedStep).toBe(1)
    expect(rounding.options.map((option) => option.step)).toEqual([1, 100, 1000])
    expect(rounding.options.find((option) => option.isSaved)?.step).toBe(1)
  })

  it('shows the exact total unchanged under the default step', () => {
    const rounding = retailRounding(deps)
    expect(rounding.options[0]?.totalDisplay).toBe(rounding.exactDisplay)
  })

  it('shows each step landing where it says it does', () => {
    const rounding = retailRounding(deps)
    // "Rs 1,234,500.00" → the rupee part must end in the right run of zeroes.
    const rupeesOf = (display: string): number =>
      Number(display.replace(/[^\d.]/g, '').split('.')[0])
    expect(rupeesOf(rounding.options[1]?.totalDisplay ?? '') % 100).toBe(0)
    expect(rupeesOf(rounding.options[2]?.totalDisplay ?? '') % 1000).toBe(0)
  })

  it('refuses a rounding change by a salesman, and writes nothing', () => {
    const asSalesman: RetailHandlerDeps = { ...deps, session: { user: salesman } }
    const result = retailRoundingSet(asSalesman, 100)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not allowed')
    expect(settingsRepo.get(SETTING_KEYS.retailRoundingNearest)).toBeNull()
  })

  it('allows an administrator to set a step, and refuses one that is not offered', () => {
    expect(retailRoundingSet(deps, 100).ok).toBe(true)
    expect(settingsRepo.get(SETTING_KEYS.retailRoundingNearest)).toBe('100')
    expect(retailRounding(deps).savedStep).toBe(100)

    const bad = retailRoundingSet(deps, 250)
    expect(bad.ok).toBe(false)
    // The refused write left the shop's real choice alone.
    expect(settingsRepo.get(SETTING_KEYS.retailRoundingNearest)).toBe('100')
  })

  it('carries the saved step into a live calculation, on the total only', () => {
    const exact = retailCalculate(deps, { draft: draft(), entry: null })
    expect(retailRoundingSet(deps, 100).ok).toBe(true)
    const rounded = retailCalculate(deps, { draft: draft(), entry: null })

    expect(rounded.invoiceTotal.paisa % 10_000).toBe(0)
    expect(rounded.invoiceTotal.paisa).not.toBe(exact.invoiceTotal.paisa)
    // The LINE is untouched. Rounding is a property of the total, and a line
    // that moved with it would stop summing to the figure printed beneath it.
    expect(rounded.lines[0]?.amount.paisa).toBe(exact.lines[0]?.amount.paisa)
    expect(rounded.itemsTotal.paisa).toBe(exact.itemsTotal.paisa)
  })

  it('keeps the balance derived from the rounded total, never the exact one', () => {
    expect(retailRoundingSet(deps, 1000).ok).toBe(true)
    const calc = retailCalculate(deps, {
      draft: draft({ amountPaid: '100000.00' }),
      entry: null,
    })
    expect(calc.balance.paisa).toBe(
      calc.invoiceTotal.paisa - calc.amountPaid.paisa - calc.customerGoldValue.paisa,
    )
  })
})

describe('customers', () => {
  it('creates an account customer and finds it again', () => {
    const created = customerCreate(deps, newCustomer())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.customer.isWalkIn).toBe(false)
    expect(customerSearch(deps, 'IMR').map((c) => c.id)).toContain(created.customer.id)
  })

  it('creates a walk-in with no opening balance, whatever was typed', () => {
    const created = customerCreate(deps, {
      ...newCustomer(),
      isWalkIn: true,
      openingGoldGrams: '10.000',
      openingCashRupees: '5000',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const stored = customers.findById(created.customer.id)
    expect(stored?.isWalkIn).toBe(true)
    // A customer with no account has no history for an opening claim to sit in.
    expect(stored?.openingGold.milligrams).toBe(Weight.ZERO.milligrams)
    expect(stored?.openingCash.paisa).toBe(Money.ZERO.paisa)
  })

  it('returns nothing for an empty search rather than the whole book', () => {
    customerCreate(deps, newCustomer())
    expect(customerSearch(deps, '   ')).toEqual([])
  })

  it('lists only active salesmen', () => {
    salesmen.rows.push({ id: 's1', name: 'BILAL', isActive: true })
    salesmen.rows.push({ id: 's2', name: 'RETIRED', isActive: false })
    expect(salesmenList(deps).map((s) => s.name)).toEqual(['BILAL'])
  })
})

describe('the one link that leaves the application', () => {
  it('allows a wa.me link', () => {
    expect(checkExternalUrl('https://wa.me/923001234567?text=hi').ok).toBe(true)
  })

  it('refuses any other host, however plausible', () => {
    for (const url of [
      'https://example.com/',
      'https://wa.me.evil.test/',
      'https://whatsapp.com/',
    ]) {
      expect(checkExternalUrl(url).ok).toBe(false)
    }
  })

  it('refuses anything that is not https', () => {
    expect(checkExternalUrl('http://wa.me/92300').ok).toBe(false)
    expect(checkExternalUrl('file:///C:/Windows/System32/cmd.exe').ok).toBe(false)
    expect(checkExternalUrl('javascript:alert(1)').ok).toBe(false)
  })

  it('refuses text that is not a URL at all', () => {
    expect(checkExternalUrl('wa.me/923001234567').ok).toBe(false)
    expect(checkExternalUrl('').ok).toBe(false)
  })
})

describe('a sale keeps the rate and the rule it was priced with', () => {
  it('reprints the same figures after the wastage rule is changed underneath it', () => {
    const posted = retailSave(deps, { draft: payable() })
    expect(posted.ok).toBe(true)
    if (!posted.ok) return
    const before = retailLoad(deps, { saleId: posted.saleId })

    // The shop changes its mind about how wastage works.
    expect(retailWastageRuleSet(deps, { direction: 'subtract', basis: 'gross' }).ok).toBe(true)

    const after = retailLoad(deps, { saleId: posted.saleId })
    expect(after?.lines[0]?.fine.mg).toBe(before?.lines[0]?.fine.mg)
    expect(after?.summary.grandTotal).toBe(before?.summary.grandTotal)
    expect(after?.wastageRuleLabel).toBe(before?.wastageRuleLabel)

    // And the NEXT sale is priced by the new rule.
    const next = retailCalculate(deps, { draft: draft({ draftId: 'draft-9' }), entry: null })
    expect(next.wastageRuleLabel).toBe(
      'Wastage taken out of net weight, calculated on gross weight',
    )
  })
})
