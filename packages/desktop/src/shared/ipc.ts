/**
 * The contract across the IPC gap.
 *
 * These are plain serializable types, and that is deliberate. Money and Weight
 * cross as integers — paisa and milligrams — exactly as they are stored, and are
 * rebuilt into value objects on whichever side needs to do arithmetic. A
 * `Weight` instance would not survive structured cloning anyway, and sending a
 * decimal would reintroduce the floating point the whole system avoids.
 *
 * The renderer never receives a repository, a connection or a database handle,
 * because none of those can cross this boundary. That is the runtime half of the
 * rule that a screen cannot open a database connection.
 */

export const IPC = {
  bootstrap: 'app:bootstrap',
  login: 'auth:login',
  logout: 'auth:logout',
  /** Picks who is working, by id. No password — see selectUser below. */
  userSelect: 'auth:selectUser',
  currentRates: 'rates:current',
  backupRun: 'backup:run',
  backupRestore: 'backup:restore',
  backupHistory: 'backup:history',
  /** The shell's own state, kept in the settings store so it survives a restart. */
  setSidebarCollapsed: 'ui:setSidebarCollapsed',
  quit: 'app:quit',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/**
 * A gold rate as it crosses the boundary.
 *
 * Per TOLA, in integer paisa — the unit the trade quotes and the unit it is
 * stored in. Never converted to per-gram, here or anywhere else.
 */
export interface RateDto {
  readonly purity: string
  /**
   * Null when no rate has ever been recorded for this purity.
   *
   * Null, not zero. Zero is a price — it says gold is free — and it is invisible
   * on an invoice. Every purity the shop deals in appears in this list so the
   * rate card can show all four; the ones without a rate show as unset.
   */
  readonly ratePerTolaPaisa: number | null
  readonly effectiveFrom: string | null
  /** Preformatted for display, so the renderer never does money arithmetic. */
  readonly display: string | null
}

/**
 * One recorded rate row.
 *
 * A rate is never updated in place — a correction is a new row (DECISIONS §6),
 * which is exactly why this history is worth showing: it is the record of what
 * the shop was quoting and when, and it is the only place a mistyped rate that
 * has since been corrected is still visible.
 */
export interface RateHistoryDto {
  readonly id: string
  readonly purity: string
  readonly effectiveFrom: string
  readonly display: string
  readonly note: string | null
}

export interface UserDto {
  readonly id: string
  readonly name: string
  readonly username: string
  readonly role: string
  readonly mustChangePassword: boolean
}

export interface BackupStatusDto {
  readonly lastBackupAt: string | null
  readonly lastBackupDisplay: string
  readonly daysSince: number | null
  readonly integrityOk: boolean
}

/**
 * Everything the shell needs to draw itself on startup.
 *
 * Two fields left with the status bar. `shop` was here to print the company
 * name in that strip — it is on every printed slip already, and the receipt
 * builder reads the profile straight from the repository on the main side, so
 * nothing needed it across this boundary. `appVersion` was there for the same
 * reason and had no second reader. A DTO field that exists to fill one label is
 * a field that outlives the label.
 *
 * `databaseConnected` and `backup` stay: they moved to the Settings card and the
 * account popover rather than being deleted, because they are the two facts an
 * operator actually goes looking for.
 */
export interface BootstrapDto {
  readonly branchId: string
  readonly branchName: string
  /**
   * Who is working. Null when the shop has more than one active user and
   * nobody has said which one yet — the shell then shows the "Who is working?"
   * card. With a single active user the main process picks it silently and this
   * is never null, so nothing is put in front of a one-person counter.
   */
  readonly user: UserDto | null
  /** Active users, for that card. Never carries credential material. */
  readonly users: readonly UserDto[]
  readonly rates: readonly RateDto[]
  readonly backup: BackupStatusDto
  readonly databaseConnected: boolean
  /** The stored manual choice, or null for "follow the window width". */
  readonly sidebarCollapsed: boolean | null
}

export interface LoginRequest {
  readonly username: string
  readonly password: string
}

export type LoginResponse =
  | { readonly ok: true; readonly user: UserDto }
  | { readonly ok: false; readonly message: string }

/** The surface the preload bridge exposes on `window.api`. */
export interface RendererApi {
  bootstrap(): Promise<BootstrapDto>
  login(request: LoginRequest): Promise<LoginResponse>
  logout(): Promise<void>
  /**
   * Says who is working. Deliberately takes no password.
   *
   * This is identification, not authentication. The PC is behind the counter
   * and the person using it unlocked the building; what the shop needs is for
   * `created_by` to name the right person, not for the right person to prove
   * they are themselves forty times a day. The role permissions still apply to
   * whoever is chosen.
   */
  selectUser(userId: string): Promise<LoginResponse>
  setSidebarCollapsed(collapsed: boolean): Promise<void>
  currentRates(): Promise<readonly RateDto[]>
  runBackup(): Promise<BackupStatusDto>
  restoreBackup(filePath: string): Promise<BackupStatusDto>
  quit(): Promise<void>

  // M1/M2
  searchParties(query: string): Promise<readonly PartyDto[]>
  createParty(party: NewPartyDto): Promise<{ ok: true; party: PartyDto } | { ok: false; message: string }>
  partyBalance(partyId: string): Promise<PartyBalanceDto | null>
  rateFor(date: string): Promise<{ display: string; rupees: string } | null>
  nextInvoiceNo(): Promise<string>
  previewWholesale(request: PostIssueRequest): Promise<PreviewDto>
  postIssue(request: PostIssueRequest): Promise<PostResult>
  settle(request: SettleRequest): Promise<PostResult>
  partyLedger(partyId: string): Promise<readonly LedgerRowDto[]>
  setRate(request: SetRateRequest): Promise<{ ok: true } | { ok: false; message: string }>
  rateHistory(): Promise<readonly RateHistoryDto[]>
  changePassword(
    current: string,
    next: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>

  // M5 — Sale (Retail). See the block at the foot of this file.
  retailCalculate(request: RetailCalculateRequest): Promise<RetailCalculationDto>
  retailSave(request: RetailPostRequest): Promise<RetailPostResult>
  retailHold(request: RetailPostRequest): Promise<RetailPostResult>
  retailLoad(reference: RetailLoadRequest): Promise<RetailSaleDto | null>
  retailList(filter: RetailListRequest): Promise<readonly RetailSaleSummaryDto[]>
  retailVoid(
    saleId: string,
    reason: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>
  retailNextInvoiceNo(): Promise<string>
  /**
   * Where the four navigation controls can go from `current`.
   *
   * `current` null means the screen is holding a bill that has not been posted.
   * Every answer comes back preformatted, so the renderer never builds an
   * invoice number out of a prefix and an integer of its own.
   */
  retailNeighbours(
    current: number | null,
    includeVoid: boolean,
  ): Promise<RetailNeighboursDto>
  /**
   * A stored invoice, in the shape the screen edits — not the shape it prints.
   *
   * `retailLoad` returns a sale as COMPUTED output: net weight, wastage, fine
   * weight and formatted amounts, all already worked out. The screen edits
   * INPUT: typed gross, stone, purity deduction and a wastage percentage.
   * Turning one into the other in the renderer would mean deriving the operator's
   * typed figures back out of the results — arithmetic, in the one place that is
   * not allowed to do any.
   *
   * So main does it, from the raw stored rows, where the typed values are still
   * exactly what was typed: `labour_charges_paisa` and `labour_mode` are the
   * input pair, not the resolved amount, so a per-tola line comes back per-tola.
   */
  retailLoadAsDraft(invoiceNumber: number): Promise<RetailInvoiceDto | null>
  /** The 80mm thermal document for a posted sale, as HTML. */
  retailReceipt(saleId: string): Promise<string | null>
  /** Every slip in the bill, computed. Pure — writes nothing. */
  retailBillCalculate(
    request: RetailBillCalculateRequest,
  ): Promise<RetailBillCalculationDto>
  /** Posts every draft slip in ONE transaction. All of it, or none of it. */
  retailBillSave(request: { draft: RetailBillDraftDto }): Promise<RetailBillPostResult>
  retailBillNextNo(): Promise<string>
  /** Every slip in a posted bill, as one print job. */
  retailBillReceipt(billId: string): Promise<string | null>
  /** Writes the bill in progress. Debounced by the screen; never validates. */
  retailDraftSave(
    request: RetailDraftSaveRequest,
  ): Promise<{ ok: true } | { ok: false; message: string }>
  /** The branch's open draft, or null. Read once, on launch. */
  retailDraftFind(): Promise<RetailDraftFoundDto | null>
  retailDraftDiscard(): Promise<{ ok: true } | { ok: false; message: string }>
  searchCustomers(query: string): Promise<readonly CustomerDto[]>
  createCustomer(
    input: NewCustomerDto,
  ): Promise<{ ok: true; customer: CustomerDto } | { ok: false; message: string }>
  /**
   * The saved rule plus the worked example for all four combinations.
   * `selection` previews a rule without saving it.
   */
  retailWastageRule(selection: WastageRuleChoice | null): Promise<WastageRuleDto>
  setRetailWastageRule(
    rule: WastageRuleChoice,
  ): Promise<{ ok: true } | { ok: false; message: string }>
  /** The saved rounding step, plus what each step does to one worked total. */
  retailRounding(): Promise<RetailRoundingDto>
  setRetailRounding(step: number): Promise<{ ok: true } | { ok: false; message: string }>
  /**
   * Hands a URL to the operating system's browser.
   *
   * The one place this application deliberately leaves itself. It is not a
   * network call — nothing is fetched here — and main refuses anything that is
   * not an https link to a host on its own allowlist.
   */
  openExternal(url: string): Promise<{ ok: true } | { ok: false; message: string }>

  /**
   * The window buttons for the frameless title bar.
   *
   * The renderer is sandboxed and cannot touch the BrowserWindow, so these
   * forward to main like every other capability — the same narrow bridge, not a
   * special case.
   *
   * The middle button is FULLSCREEN, not maximise, and these names say so. It
   * is a deliberate departure from the Windows convention: the shop wants the
   * whole display at the counter, taskbar included. The window still OPENS
   * maximised — filling the work area with the taskbar visible — because that
   * is the state a till should be in when nobody has asked for anything.
   */
  readonly windowControls: {
    minimize(): Promise<void>
    toggleFullscreen(): Promise<boolean>
    close(): Promise<void>
    isFullscreen(): Promise<boolean>
    /** Returns an unsubscribe function. */
    onFullscreenChange(listener: (fullscreen: boolean) => void): () => void
  }
}

declare global {
  interface Window {
    readonly api: RendererApi
  }
}

// ── parties and wholesale (M1/M2) ───────────────────────────────────────────
//
// Everything below crosses as plain integers plus PREFORMATTED display strings.
// The renderer never does money or weight arithmetic — it cannot even import the
// application layer — so any figure it shows is formatted on this side by the
// same domain code that formats the printed slip. That is what stops the screen
// and the paper ever disagreeing.

export const IPC_M2 = {
  partySearch: 'party:search',
  partyCreate: 'party:create',
  partyGet: 'party:get',
  wholesaleRateFor: 'wholesale:rateFor',
  wholesaleNextInvoice: 'wholesale:nextInvoice',
  wholesalePreview: 'wholesale:preview',
  wholesalePostIssue: 'wholesale:postIssue',
  wholesaleSettle: 'wholesale:settle',
  wholesaleLedger: 'wholesale:ledger',
  wholesaleFind: 'wholesale:find',
  wholesaleRecent: 'wholesale:recent',
  wholesaleReverse: 'wholesale:reverse',
  rateSet: 'rates:set',
  /** Read-only. Every recorded rate, newest first, for the Gold Rate screen. */
  rateHistory: 'rates:history',
  changePassword: 'auth:changePassword',
  windowMinimize: 'window:minimize',
  windowToggleFullscreen: 'window:toggleFullscreen',
  windowClose: 'window:close',
  windowIsFullscreen: 'window:isFullscreen',
  /**
   * Main -> renderer, driven by the WINDOW's own enter/leave-full-screen
   * events rather than by our button. F11 and Esc change the same state, and a
   * glyph that only updates when its own button was pressed is a glyph that
   * lies as soon as the keyboard is used.
   */
  windowFullscreenChanged: 'window:fullscreenChanged',
} as const

export interface PartyDto {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
}

export interface NewPartyDto {
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
  /** Typed decimal strings, parsed exactly on the main side. */
  readonly openingGoldGrams: string
  readonly openingCashRupees: string
}

/** A balance as both a signed integer and the label-bearing text to show. */
export interface BalanceDto {
  readonly milligramsOrPaisa: number
  /** e.g. "0.500 g (we owe)". Never a bare minus sign. */
  readonly text: string
  readonly direction: 'party-owes-shop' | 'shop-owes-party' | 'settled'
  /** "DR", "CR" or "" — the slip's own labels, mapped in DECISIONS §4. */
  readonly drCr: string
}

export interface PartyBalanceDto {
  readonly party: PartyDto
  readonly gold: BalanceDto
  readonly cash: BalanceDto
}

/** One grid row, as typed. Parsed and computed on the main side. */
export interface LineInputDto {
  readonly itemName: string
  readonly grossGrams: string
  readonly kattRatti: string
  readonly remarks: string | null
}

export interface LinePreviewDto {
  readonly itemName: string
  readonly grossDisplay: string
  readonly kattDisplay: string
  readonly khalisDisplay: string
  readonly rateDisplay: string
  readonly amountDisplay: string
  readonly purityDisplay: string
  readonly error: string | null
}

/** Live totals for the grid footer and the invoice preview. */
export interface PreviewDto {
  readonly lines: readonly LinePreviewDto[]
  readonly grossTotalDisplay: string
  readonly khalisTotalDisplay: string
  readonly amountTotalDisplay: string
  readonly rateDisplay: string | null
  readonly rateMissing: boolean
  readonly previousBalance: BalanceDto | null
  readonly endBalance: BalanceDto | null
}

export interface PostIssueRequest {
  readonly partyId: string
  readonly entryDate: string
  readonly lines: readonly LineInputDto[]
  readonly notes: string | null
  /**
   * A rate typed on the slip itself, overriding the one recorded for the date.
   *
   * Shops do quote a party a different rate from the day's board rate, and the
   * service has always supported this — the screen simply never offered it, so
   * the field sat read-only and the feature was unreachable. Whatever is used
   * is still stored on the entry, so history stays fixed either way.
   */
  readonly ratePerTolaOverride?: string
}

export interface SettleRequest {
  readonly partyId: string
  readonly entryDate: string
  readonly goldGrams: string
  readonly cashRupees: string
  readonly notes: string | null
  readonly confirmedOverReturn?: boolean
}

export type PostResult =
  | {
      readonly ok: true
      readonly invoiceNo: string
      readonly entryId: string
      readonly balanceAfter: BalanceDto
      readonly warnings: readonly string[]
    }
  | { readonly ok: false; readonly message: string }
  /**
   * The over-return case. Distinct from a plain failure because the UI must show
   * a confirmation and offer to continue, not an error the user can only dismiss.
   */
  | { readonly ok: false; readonly needsConfirmation: true; readonly message: string }

export interface LedgerRowDto {
  readonly entryId: string
  readonly date: string
  readonly invoiceNo: string
  readonly kind: string
  readonly grossDisplay: string
  readonly khalisDisplay: string
  readonly settledGoldDisplay: string
  readonly settledCashDisplay: string
  readonly previousDisplay: string
  readonly endDisplay: string
  readonly endDrCr: string
  readonly isOverReturn: boolean
  readonly isReversed: boolean
}

export interface SetRateRequest {
  readonly purity: string
  readonly ratePerTolaRupees: string
  readonly effectiveFrom: string
  readonly note: string | null
}

// ── retail (M5) ─────────────────────────────────────────────────────────────
//
// The retail screen is the strictest application of the rule this whole file
// exists for: **the renderer computes nothing at all.** Every figure it shows —
// net weight, wastage, fine weight, a line amount, the grand total, the amount
// in words — is produced by RetailSaleService in the main process and arrives
// preformatted. `retail:calculate` is called on every keystroke for exactly
// that reason: it is cheaper to ask than to duplicate the arithmetic, and a
// duplicate is a second implementation that will eventually disagree.

export const IPC_RETAIL = {
  /** Draft in, fully computed DTO out. Pure: no writes, no side effects. */
  calculate: 'retail:calculate',
  save: 'retail:save',
  hold: 'retail:hold',
  load: 'retail:load',
  list: 'retail:list',
  void: 'retail:void',
  /** A PREVIEW of the next number. Reserves nothing. */
  nextInvoiceNo: 'retail:nextInvoiceNo',
  /** Where FIRST / PREV / NEXT / LAST can go from the invoice on screen. */
  neighbours: 'retail:neighbours',
  /** A posted invoice, read back in the shape the SCREEN edits. */
  loadAsDraft: 'retail:loadAsDraft',
  receipt: 'retail:receipt',
  customerSearch: 'customers:search',
  customerCreate: 'customers:create',
  wastageRule: 'settings:retailWastageRule',
  wastageRuleSet: 'settings:retailWastageRule:set',
  /** The rounding step applied to the invoice total. See RetailRoundingDto. */
  rounding: 'settings:retailRounding',
  roundingSet: 'settings:retailRounding:set',
  // ── bills, which group slips ──────────────────────────────────────────────
  /** Every slip in the bill, computed. Pure: no writes. */
  billCalculate: 'retail:bill:calculate',
  /** Posts every draft slip in ONE transaction. All or nothing. */
  billSave: 'retail:bill:save',
  /** A PREVIEW of the next bill number. Reserves nothing. */
  billNextNo: 'retail:bill:nextNo',
  /** The 80mm document for every slip in a bill, as one print job. */
  billReceipt: 'retail:bill:receipt',
  // ── the bill in progress ────────────────────────────────────────────────
  draftSave: 'retail:draft:save',
  draftFind: 'retail:draft:find',
  draftDiscard: 'retail:draft:discard',
  openExternal: 'app:openExternal',
} as const

/** Which unit the operator is currently reading and typing weights in. */
export type WeightUnit = 'gram' | 'tola'

/**
 * A weight as the operator is currently holding it.
 *
 * `text` is what is in the box. `exactMg` is set ONLY when that text was
 * produced by flipping the Gram ⇄ Tola toggle rather than typed — and when it
 * is set, it wins.
 *
 * That second field is not belt-and-braces, it is the whole reason the toggle
 * is safe. Three decimals of a tola cannot represent a milligram: 0.001 tola is
 * 11.664 mg, so 47.240 g displays as 4.050 tola and 4.050 tola parses back to
 * 47.239 g. Re-parsing the displayed text on every flip would walk a stored
 * weight by up to 6 mg per toggle, silently, on a screen whose whole job is to
 * price metal by weight. Carrying the exact milligram means a toggle is a
 * change of units and nothing else.
 */
export interface WeightFieldDto {
  readonly text: string
  readonly exactMg: number | null
}

/** A computed weight, ready to render in either unit. Never recomputed here. */
export interface WeightDto {
  /** The stored integer. The renderer displays it; it never does arithmetic. */
  readonly mg: number
  readonly gram: string
  readonly tola: string
}

/** A computed amount. `rupees` carries paisa, `whole` is the slip's form. */
export interface MoneyDto {
  readonly paisa: number
  readonly rupees: string
  readonly whole: string
}

/** One item as typed, in whichever unit the toggle is currently showing. */
export interface RetailItemDto {
  readonly itemName: string
  readonly purity: string
  readonly grossWeight: WeightFieldDto
  readonly stoneWeight: WeightFieldDto
  /**
   * The purity deduction for this item, as an ABSOLUTE weight.
   *
   * Typed as read off the piece: 0.090 on a 2.000-tola item removes 0.090, not
   * 0.090 per tola. See RetailLineInput.purityDeduction and migration 010.
   */
  readonly purityDeduction: WeightFieldDto
  /** Per cent to two places, e.g. "14.00". Converted to basis points on main. */
  readonly wastagePercent: string
  readonly labourCharges: string
  readonly labourMode: string
  readonly stoneCharges: string
  /** Typed on this line. Empty means "use this item's purity rate". */
  readonly ratePerTola: string
}

export interface RetailDraftDto {
  /** Minted by the screen when the sale is started. Carries the idempotency. */
  readonly draftId: string
  readonly saleDate: string
  readonly saleTime: string
  readonly customerId: string | null
  readonly customerName: string
  readonly customerMobile: string | null
  readonly ratePurity: string
  /** Empty means "use the rate recorded for this purity and date". */
  readonly ratePerTolaOverride: string
  readonly weightUnit: WeightUnit
  readonly items: readonly RetailItemDto[]
  readonly customerGold: WeightFieldDto
  readonly customerGoldPurity: string | null
  readonly hallmarkCharges: string
  readonly otherCharges: string
  readonly discount: string
  readonly amountPaid: string
  readonly paymentMethod: string
  readonly remarks: string | null
  readonly confirmedHighWastage?: boolean
}

export interface RetailCalculateRequest {
  readonly draft: RetailDraftDto
}

export interface RetailLineDto {
  readonly itemName: string
  /** Display form, e.g. "22K". */
  readonly purity: string
  readonly purityCode: string
  readonly gross: WeightDto
  readonly stone: WeightDto
  readonly purityDeduction: WeightDto
  /** The deduction as a share of gross, e.g. "4.50" — computed on main. */
  readonly purityDeductionPercent: string
  readonly net: WeightDto
  readonly wastagePercent: string
  readonly wastage: WeightDto
  readonly fine: WeightDto
  /** What is actually charged, after the fixed / per-tola mode is resolved. */
  readonly labour: MoneyDto
  readonly labourMode: string
  readonly stoneCharges: MoneyDto
  readonly amount: MoneyDto
  /** The rate THIS line was priced at — its own purity's. Preformatted. */
  readonly rateDisplay: string | null
  /** Half-typed input is normal. A row that cannot parse says so and is skipped. */
  readonly error: string | null
}

export interface RetailCalculationDto {
  readonly lines: readonly RetailLineDto[]
  readonly totalFine: WeightDto
  readonly customerGold: WeightDto
  readonly remainingGold: WeightDto
  readonly goldValue: MoneyDto
  readonly totalLabour: MoneyDto
  readonly totalStone: MoneyDto
  /** The sum of the ROUNDED line amounts, before charges and discount. */
  readonly itemsTotal: MoneyDto
  readonly hallmarkCharges: MoneyDto
  readonly otherCharges: MoneyDto
  readonly discount: MoneyDto
  readonly customerGoldValue: MoneyDto
  /**
   * Items and charges less the discount, rounded by the shop's rounding step.
   * This is the slip's GRAND TOTAL AMOUNT, and it deliberately does NOT have the
   * customer's old gold taken off it — see `balance`.
   */
  readonly invoiceTotal: MoneyDto
  /** The invoice total less the old gold. What is payable in cash, and stored. */
  readonly grandTotal: MoneyDto
  readonly amountPaid: MoneyDto
  /**
   * `invoiceTotal − amountPaid − customerGoldValue`, computed on the main side.
   *
   * The renderer shows this figure and never derives it. That is the whole of
   * the rule the reference mockup broke: it printed a balance 400,000 away from
   * its own total with both payment fields at zero.
   */
  readonly balance: MoneyDto
  readonly amountInWords: string
  readonly ratePerTola: MoneyDto
  readonly rateDisplay: string | null
  /** True when no rate exists for that purity on that date. Never a zero. */
  readonly rateMissing: boolean
  readonly wastageRuleLabel: string
  readonly warnings: readonly string[]
}

export interface RetailPostRequest {
  readonly draft: RetailDraftDto
}

// ── bills, which group slips ────────────────────────────────────────────────
//
// One customer visit, several slips, each its own printable document. The split
// mirrors migration 009 exactly: what belongs to the VISIT is on the bill, what
// belongs to the DOCUMENT is on the slip. The screen holds the shared facts once
// so two slips from one visit cannot disagree about who bought them.

/** One slip as the operator is holding it. Its own items, charges and payment. */
export interface RetailSlipDto {
  readonly slipNo: number
  readonly slipLabel: string
  /** Minted per slip: each slip is its own document in the invoice sequence. */
  readonly draftId: string
  readonly items: readonly RetailItemDto[]
  readonly customerGold: WeightFieldDto
  readonly customerGoldPurity: string | null
  readonly hallmarkCharges: string
  readonly otherCharges: string
  readonly discount: string
  readonly amountPaid: string
  readonly paymentMethod: string
  readonly remarks: string | null
}

/** The visit. Customer, mobile, salesman, date, time and rate — shared. */
export interface RetailBillDraftDto {
  readonly saleDate: string
  readonly saleTime: string
  readonly customerId: string | null
  readonly customerName: string
  readonly customerMobile: string | null
  readonly ratePurity: string
  readonly ratePerTolaOverride: string
  readonly weightUnit: WeightUnit
  readonly slips: readonly RetailSlipDto[]
  readonly confirmedHighWastage?: boolean
}

export interface RetailBillCalculateRequest {
  readonly draft: RetailBillDraftDto
  /** Which slip the screen is showing. */
  readonly activeSlipNo: number
}

/** One slip, computed. The tab shows `total`; the screen shows the rest. */
export interface RetailSlipCalculationDto {
  readonly slipNo: number
  readonly slipLabel: string
  readonly calculation: RetailCalculationDto
  /** The slip's own invoice total, for its tab. Preformatted. */
  readonly total: string
}

export interface RetailBillCalculationDto {
  readonly slips: readonly RetailSlipCalculationDto[]
  /** The active slip's, lifted out so the screen never searches for it. */
  readonly active: RetailCalculationDto
  /** Every slip's invoice total added up. What the visit comes to. */
  readonly billTotal: MoneyDto
  readonly rateDisplay: string | null
  readonly rateMissing: boolean
}

export type RetailBillPostResult =
  | {
      readonly ok: true
      readonly billId: string
      readonly billNo: string
      /** One per slip, in slip order. Each is a real document. */
      readonly slips: readonly {
        readonly slipNo: number
        readonly slipLabel: string
        readonly saleId: string
        readonly invoiceNo: string
      }[]
      readonly billTotal: string
    }
  | { readonly ok: false; readonly message: string }
  | { readonly ok: false; readonly needsConfirmation: true; readonly message: string }

export type RetailPostResult =
  | {
      readonly ok: true
      readonly saleId: string
      readonly invoiceNo: string
      readonly status: string
      readonly grandTotal: string
      readonly balance: string
      readonly amountInWords: string
    }
  | { readonly ok: false; readonly message: string }
  /** High wastage. A question with a Continue button, not an error to dismiss. */
  | { readonly ok: false; readonly needsConfirmation: true; readonly message: string }

/** One reachable invoice: the number to navigate by, and the text to show. */
export interface InvoiceRefDto {
  readonly number: number
  readonly display: string
}

/** Null means "nowhere to go", which is what disables an arrow. */
export interface RetailNeighboursDto {
  readonly first: InvoiceRefDto | null
  readonly previous: InvoiceRefDto | null
  readonly next: InvoiceRefDto | null
  readonly last: InvoiceRefDto | null
}

/**
 * A stored invoice, ready to be shown and — if the role allows — unlocked.
 *
 * Carries its own status rather than leaving the screen to infer one: an
 * invoice that is `void` is shown, and shown as void, because the operator
 * navigated to it deliberately or typed its number.
 */
export interface RetailInvoiceDto {
  readonly saleId: string
  readonly invoiceNumber: number
  /** Preformatted, prefix already applied. */
  readonly invoiceNo: string
  readonly status: string
  readonly voidReason: string | null
  /**
   * How many slips the BILL this invoice belongs to holds.
   *
   * 1 for everything written since the tab strip came off. More than 1 means an
   * older multi-slip bill, and the screen shows it read-only with a note rather
   * than presenting its first slip as though that were the whole visit.
   */
  readonly slipCount: number
  readonly draft: RetailBillDraftDto
}

export interface RetailLoadRequest {
  readonly saleId?: string
  readonly invoiceNo?: string
}

export interface RetailListRequest {
  readonly fromDate?: string
  readonly toDate?: string
  readonly customerId?: string
  readonly status?: string
  readonly limit?: number
}

export interface RetailSaleSummaryDto {
  readonly saleId: string
  /** The integer, for navigating from here. `invoiceNo` is what is SHOWN. */
  readonly invoiceNumber: number
  readonly invoiceNo: string
  readonly date: string
  readonly time: string
  readonly customerName: string
  readonly grandTotal: string
  readonly balance: string
  readonly status: string
}

/** A posted or held sale, read back. */
export interface RetailSaleDto {
  readonly summary: RetailSaleSummaryDto
  readonly lines: readonly RetailLineDto[]
  readonly totalFine: WeightDto
  readonly amountInWords: string
  readonly ratePurity: string
  readonly ratePerTola: MoneyDto
  readonly customerMobile: string | null
  readonly paymentMethod: string
  readonly amountPaid: MoneyDto
  readonly remarks: string | null
  readonly wastageRuleLabel: string
}

export interface CustomerDto {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
  readonly isWalkIn: boolean
}

export interface NewCustomerDto {
  readonly name: string
  readonly mobile: string
  readonly address: string
  readonly city: string
  readonly cnic: string
  readonly isWalkIn: boolean
  /** Typed decimal strings, parsed exactly on the main side. */
  readonly openingGoldGrams: string
  readonly openingCashRupees: string
}

export interface WastageRuleChoice {
  readonly direction: string
  readonly basis: string
}

/**
 * One of the four rules, worked through the SAME calculation core a real sale
 * uses. There is no second copy of the arithmetic anywhere for this card.
 */
export interface WastageRuleOptionDto {
  readonly direction: string
  readonly basis: string
  readonly label: string
  readonly wastageDisplay: string
  readonly fineDisplay: string
  readonly amountDisplay: string
  readonly isSaved: boolean
  readonly isSelected: boolean
}

export interface WastageRuleExampleDto {
  readonly title: string
  readonly note: string | null
  readonly sample: {
    readonly grossTola: string
    readonly stoneTola: string
    readonly cutTola: string
    readonly wastagePercent: string
    readonly rateDisplay: string
  }
  readonly options: readonly WastageRuleOptionDto[]
}

/**
 * One rounding step, worked through the SAME invoice arithmetic a real sale
 * uses — so the card cannot show one answer while the till charges another.
 */
export interface RoundingStepOptionDto {
  readonly step: number
  readonly label: string
  readonly note: string
  /** The sample invoice total under this step. */
  readonly totalDisplay: string
  readonly isSaved: boolean
}

export interface RetailRoundingDto {
  readonly savedStep: number
  /** The exact, unrounded total of the sample, for comparison. */
  readonly exactDisplay: string
  readonly options: readonly RoundingStepOptionDto[]
}

export interface WastageRuleDto {
  /** What is stored, and therefore what the next sale will be priced with. */
  readonly savedDirection: string
  readonly savedBasis: string
  /**
   * TWO worked examples, and the second one is not decoration.
   *
   * On a piece with no stone and no cut, gross weight and net weight are the
   * same number — so "calculated on gross" and "calculated on net" give
   * identical answers and the card cannot help anybody tell them apart. The
   * second example puts a stone on the same piece, which is what separates
   * them. Without it, half of this card's purpose does not work.
   */
  readonly examples: readonly WastageRuleExampleDto[]
}

/**
 * The bill in progress, across the boundary.
 *
 * The screen sends its whole state on a debounce; main writes it. There is no
 * per-keystroke diffing and no partial update, because a draft that is half
 * applied is worse than one that is 400ms stale.
 */
export interface RetailDraftSaveRequest {
  readonly draft: RetailBillDraftDto
  readonly activeSlipNo: number
}

/** The screen's state, exactly as it was left. */
export interface RetailDraftStateDto {
  readonly draft: RetailBillDraftDto
  readonly activeSlipNo: number
}

/**
 * A recovered draft, plus enough of a summary to decide on it.
 *
 * The total is computed by the same calculate path the screen uses, so the card
 * offering to resume names a figure the resumed bill will actually come to.
 */
export interface RetailDraftFoundDto {
  readonly state: RetailDraftStateDto
  readonly customerName: string
  readonly slipCount: number
  readonly itemCount: number
  readonly total: string
  readonly savedAt: string
}
