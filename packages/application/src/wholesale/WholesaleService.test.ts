import {
  Katt,
  Money,
  Weight,
  describeBalance,
  fixedClock,
  toIsoDate,
  type PublicUser,
} from '@jewellery/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FakeAuditRepository,
  FakeGoldRateRepository,
  FakePartyRepository,
  FakeSettingsRepository,
  FakeWholesaleRepository,
} from '../testing/fakes.js'
import { RateService } from '../rates/RateService.js'
import { Settings } from '../settings/keys.js'
import {
  OverReturnRequiresConfirmationError,
  WholesaleService,
  type IssueLineInput,
} from './WholesaleService.js'

// No database, no window.
const clock = fixedClock('2026-08-30T09:00:00.000Z')
const BRANCH = 'branch-1'
const TODAY = toIsoDate('2026-08-30')

const admin: PublicUser = {
  id: 'user-1',
  branchId: BRANCH,
  name: 'Admin',
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
}

// The three rows from docs/wholesale-receipt.jpg.
const SLIP_LINES: IssueLineInput[] = [
  { itemName: 'SINGAPORI CHAIN 15', gross: Weight.parse('254.200'), katt: Katt.parse('13'), remarks: null },
  { itemName: 'JEWELRY', gross: Weight.parse('10.280'), katt: Katt.parse('13'), remarks: null },
  { itemName: 'OS JEWELARY', gross: Weight.parse('7.030'), katt: Katt.parse('11.5'), remarks: null },
]

let wholesale: FakeWholesaleRepository
let parties: FakePartyRepository
let audit: FakeAuditRepository
let rates: FakeGoldRateRepository
let settingsRepo: FakeSettingsRepository
let service: WholesaleService
let partyId = ''

function seedRate(rupeesPerTola = 358_000, from = '2026-08-01'): void {
  rates.seed(BRANCH, 'K22', rupeesPerTola, from)
}

beforeEach(() => {
  wholesale = new FakeWholesaleRepository(clock)
  parties = new FakePartyRepository(clock)
  audit = new FakeAuditRepository(clock)
  rates = new FakeGoldRateRepository(clock)
  settingsRepo = new FakeSettingsRepository()

  service = new WholesaleService({
    wholesale,
    parties,
    audit,
    rates: new RateService({ goldRates: rates, audit, clock }),
    settings: new Settings(settingsRepo),
    clock,
  })

  partyId = parties.create({
    branchId: BRANCH,
    code: 'CHJ',
    name: 'CHAUDHARY JEWELLER',
    mobile: null,
    city: null,
    openingGold: Weight.ZERO,
    openingCash: Money.ZERO,
    notes: null,
  }).id
})

function postSlip() {
  return service.postIssue(admin, {
    branchId: BRANCH,
    partyId,
    entryDate: TODAY,
    lines: SLIP_LINES,
    notes: null,
  })
}

describe('posting the real slip', () => {
  beforeEach(() => seedRate())

  it('produces the slip totals', () => {
    const { posted } = postSlip()
    expect(posted.entry.totalGross.format()).toBe('271.510')
    expect(posted.entry.totalKhalis.format()).toBe('234.853')
  })

  it('leaves the party owing the khalis total', () => {
    const { goldBalanceAfter } = postSlip()
    expect(goldBalanceAfter.format()).toBe('234.853')
    expect(describeBalance(goldBalanceAfter).label).toBe('they owe')
  })

  it('stores the rate on the entry', () => {
    const { posted } = postSlip()
    expect(posted.entry.ratePerTola?.paisa).toBe(35_800_000)
  })

  it('refuses when no rate exists for the date', () => {
    rates.rows.length = 0
    expect(() => postSlip()).toThrow(/No gold rate has been recorded/)
  })

  it('prices a line at ITS OWN karat, not the slip default', () => {
    // 24K is dearer than 22K, and a party taking both in one visit must be
    // charged each at its own rate. Before lines could name a karat the whole
    // slip went out at the K22 rate.
    rates.seed(BRANCH, 'K24', 390_000, '2026-08-01')

    const { posted } = service.postIssue(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      lines: [
        { itemName: 'BAR', gross: Weight.parse('11.664'), katt: Katt.ZERO, remarks: null, purity: 'K24' },
        { itemName: 'CHAIN', gross: Weight.parse('11.664'), katt: Katt.ZERO, remarks: null },
      ],
      notes: null,
    })

    expect(posted.lines[0]?.ratePerTola.paisa).toBe(39_000_000)
    expect(posted.lines[0]?.purity).toBe('K24')
    // The one that named nothing keeps the slip rate, exactly as before.
    expect(posted.lines[1]?.ratePerTola.paisa).toBe(35_800_000)
    expect(posted.lines[1]?.purity).toBe('K22')
  })

  it('refuses a line whose karat has no rate, rather than pricing it at K22', () => {
    // Silently charging 24K metal at the 22K rate is invisible on the slip and
    // wrong in the ledger, so it is refused by name.
    expect(() =>
      service.postIssue(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        lines: [
          { itemName: 'BAR', gross: Weight.parse('11.664'), katt: Katt.ZERO, remarks: null, purity: 'K24' },
        ],
        notes: null,
      }),
    ).toThrow(/No 24K gold rate/)
  })

  it('refuses an empty slip', () => {
    expect(() =>
      service.postIssue(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        lines: [],
        notes: null,
      }),
    ).toThrow(/at least one item/)
  })

  it('refuses a zero-weight row rather than posting a meaningless line', () => {
    expect(() =>
      service.postIssue(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        lines: [{ itemName: 'X', gross: Weight.ZERO, katt: Katt.ZERO, remarks: null }],
        notes: null,
      }),
    ).toThrow(/no weight/)
  })

  it('refuses without a party', () => {
    expect(() =>
      service.postIssue(admin, {
        branchId: BRANCH,
        partyId: 'nobody',
        entryDate: TODAY,
        lines: SLIP_LINES,
        notes: null,
      }),
    ).toThrow(/Select a party/)
  })

  it('audits the posting', () => {
    postSlip()
    expect(audit.actions()).toContain('TRANSACTION_POSTED')
  })

  it('uses a back-dated rate for a back-dated slip', () => {
    // History does not move: a slip dated in July is priced at July's rate.
    seedRate(300_000, '2026-07-01')
    const { posted } = service.postIssue(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: toIsoDate('2026-07-15'),
      lines: SLIP_LINES,
      notes: null,
    })
    expect(posted.entry.ratePerTola?.format()).toBe('300,000.00')
  })
})

describe('a. settling in khalis gold', () => {
  beforeEach(() => seedRate())

  it('reduces the gold debt', () => {
    postSlip()
    const { goldBalanceAfter } = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.ZERO,
      notes: null,
    })
    expect(goldBalanceAfter.format()).toBe('134.853')
  })

  it('needs no rate at all', () => {
    rates.rows.length = 0
    postSlipWithOverride()
    expect(() =>
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: Weight.parse('10'),
        cashGiven: Money.ZERO,
        notes: null,
      }),
    ).not.toThrow()
  })

  function postSlipWithOverride() {
    return service.postIssue(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      lines: SLIP_LINES,
      ratePerTolaOverride: Money.parse('358000'),
      notes: null,
    })
  }
})

describe('b. settling in cash', () => {
  beforeEach(() => seedRate())

  it('reduces the GOLD debt by what the cash buys', () => {
    postSlip()
    const { posted, goldBalanceAfter } = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      notes: null,
    })
    expect(posted.entry.settledCashAsGold.format()).toBe('32.581')
    expect(goldBalanceAfter.format()).toBe('202.272')
  })

  it('leaves the cash ledger untouched — this is not a cash credit', () => {
    postSlip()
    service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      notes: null,
    })
    expect(service.cashBalance(partyId).isZero).toBe(true)
  })

  it('reads ZERO gold after a full cash settlement', () => {
    // The heart of the shop's model: the debt is settled, not moved.
    postSlip()
    const owed = service.goldBalance(partyId)
    const toClear = Money.valueOfAtTolaRate(owed, Money.parse('358000'))
    const { goldBalanceAfter } = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.ZERO,
      cashGiven: toClear,
      notes: null,
    })
    expect(goldBalanceAfter.isZero).toBe(true)
    expect(describeBalance(goldBalanceAfter).direction).toBe('settled')
  })

  it('refuses a cash settlement when no rate exists for the date', () => {
    postSlip()
    rates.rows.length = 0
    expect(() =>
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: Weight.ZERO,
        cashGiven: Money.parse('1000'),
        notes: null,
      }),
    ).toThrow(/cannot reduce a gold debt without one/)
  })

  it('stores the rate it used on the settlement row', () => {
    postSlip()
    const { posted } = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.ZERO,
      cashGiven: Money.parse('1000000'),
      notes: null,
    })
    expect(posted.entry.ratePerTola?.paisa).toBe(35_800_000)
  })
})

describe('c. settling part gold, part cash', () => {
  beforeEach(() => seedRate())

  it('is one transaction carrying both portions', () => {
    postSlip()
    const { posted, goldBalanceAfter } = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.parse('1000000'),
      notes: null,
    })
    // One row, both portions visible on it.
    expect(posted.entry.settledGold.format()).toBe('100.000')
    expect(posted.entry.settledCash.format()).toBe('1,000,000.00')
    expect(posted.entry.settledCashAsGold.format()).toBe('32.581')
    expect(goldBalanceAfter.format()).toBe('102.272')
  })

  it('records one entry, not two', () => {
    postSlip()
    service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.parse('1000000'),
      notes: null,
    })
    expect(wholesale.entries.filter((e) => e.entry.kind === 'SETTLEMENT')).toHaveLength(1)
  })

  it('refuses an empty settlement', () => {
    postSlip()
    expect(() =>
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: Weight.ZERO,
        cashGiven: Money.ZERO,
        notes: null,
      }),
    ).toThrow(/Enter gold, cash, or both/)
  })

  it('refuses a negative portion, pointing at reversal instead', () => {
    postSlip()
    expect(() =>
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: Weight.parse('-5'),
        cashGiven: Money.ZERO,
        notes: null,
      }),
    ).toThrow(/reverse it/)
  })
})

describe('over-return: warn and allow', () => {
  beforeEach(() => seedRate())

  it('refuses without confirmation when the balance would go negative', () => {
    postSlip()
    expect(() =>
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: Weight.parse('300'),
        cashGiven: Money.ZERO,
        notes: null,
      }),
    ).toThrow(OverReturnRequiresConfirmationError)
  })

  it('states the consequence in plain words, not a validation message', () => {
    postSlip()
    try {
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: Weight.parse('300'),
        cashGiven: Money.ZERO,
        notes: null,
      })
      expect.unreachable('should have required confirmation')
    } catch (error) {
      expect((error as Error).message).toBe(
        'This leaves CHAUDHARY JEWELLER with 65.147 g that you owe them. Continue?',
      )
    }
  })

  it('goes through once confirmed, flagged and audited', () => {
    postSlip()
    const { posted, goldBalanceAfter } = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.parse('300'),
      cashGiven: Money.ZERO,
      confirmedOverReturn: true,
      notes: null,
    })
    expect(posted.entry.isOverReturn).toBe(true)
    expect(posted.entry.confirmedByUserId).toBe(admin.id)
    expect(audit.actions()).toContain('OVER_RETURN_CONFIRMED')
    expect(describeBalance(goldBalanceAfter).text).toBe('65.147 g (we owe)')
  })

  it('passes quietly within the 0.050 g tolerance', () => {
    // Two scales genuinely disagree at the third decimal; a modal every time
    // trains people to click through it.
    postSlip()
    const owed = service.goldBalance(partyId)
    const result = service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: owed.plus(Weight.parse('0.040')),
      cashGiven: Money.ZERO,
      notes: null,
    })
    expect(result.posted.entry.isOverReturn).toBe(false)
    expect(result.goldBalanceAfter.milligrams).toBe(-40)
  })

  it('honours a tolerance the shop has changed', () => {
    settingsRepo.set('wholesale.overReturnToleranceMg', '0')
    postSlip()
    const owed = service.goldBalance(partyId)
    expect(() =>
      service.settle(admin, {
        branchId: BRANCH,
        partyId,
        entryDate: TODAY,
        goldGiven: owed.plus(Weight.parse('0.001')),
        cashGiven: Money.ZERO,
        notes: null,
      }),
    ).toThrow(OverReturnRequiresConfirmationError)
  })
})

describe('the katt sanity check', () => {
  beforeEach(() => seedRate())

  it('is off by default, so the real slip warns about nothing', () => {
    expect(postSlip().kattWarnings).toEqual([])
  })

  it('stays silent on the real slip even once enabled', () => {
    // Katt 11.5 and 13 sit inside the suggested 4–24 band.
    settingsRepo.set('wholesale.kattCheckEnabled', 'true')
    expect(postSlip().kattWarnings).toEqual([])
  })

  it('warns on an implausible katt once enabled, without blocking', () => {
    settingsRepo.set('wholesale.kattCheckEnabled', 'true')
    const { posted, kattWarnings } = service.postIssue(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      lines: [{ itemName: 'ODD', gross: Weight.parse('10'), katt: Katt.parse('40'), remarks: null }],
      notes: null,
    })
    expect(kattWarnings).toHaveLength(1)
    expect(kattWarnings[0]?.message).toContain('outside the expected 4–24')
    // Warned, not blocked — the slip is posted.
    expect(posted.entry.id).toBeTruthy()
  })
})

describe('reversal, never edit', () => {
  beforeEach(() => seedRate())

  it('nets the balance back to where it was', () => {
    const { posted } = postSlip()
    service.reverse(admin, posted.entry.id, 'wrong party')
    expect(service.goldBalance(partyId).isZero).toBe(true)
  })

  it('keeps both rows, so the books show the correction', () => {
    const { posted } = postSlip()
    service.reverse(admin, posted.entry.id, 'wrong party')
    expect(service.ledger(partyId)).toHaveLength(2)
    expect(service.findById(posted.entry.id)?.entry.reversedByEntryId).toBeTruthy()
  })

  it('will not reverse the same entry twice', () => {
    const { posted } = postSlip()
    service.reverse(admin, posted.entry.id, 'wrong party')
    expect(() => service.reverse(admin, posted.entry.id, 'again')).toThrow(
      /already been reversed/,
    )
  })

  it('requires a reason, which stays on the record', () => {
    const { posted } = postSlip()
    expect(() => service.reverse(admin, posted.entry.id, '   ')).toThrow(/needs a reason/)
  })
})

describe('the party ledger', () => {
  beforeEach(() => seedRate())

  it('accumulates a running balance in the slip shape', () => {
    postSlip()
    service.settle(admin, {
      branchId: BRANCH,
      partyId,
      entryDate: TODAY,
      goldGiven: Weight.parse('100'),
      cashGiven: Money.ZERO,
      notes: null,
    })

    const ledger = service.ledger(partyId)
    expect(ledger).toHaveLength(2)
    expect(ledger[0]?.previousGold.format()).toBe('0.000')
    expect(ledger[0]?.endGold.format()).toBe('234.853')
    expect(ledger[1]?.previousGold.format()).toBe('234.853')
    expect(ledger[1]?.endGold.format()).toBe('134.853')
  })

  it('starts from the party opening balance, not from zero', () => {
    const opened = parties.create({
      branchId: BRANCH,
      code: 'OPN',
      name: 'Opening Party',
      mobile: null,
      city: null,
      openingGold: Weight.parse('227.550'),
      openingCash: Money.ZERO,
      notes: null,
    })
    expect(service.goldBalance(opened.id).format()).toBe('227.550')
  })
})
