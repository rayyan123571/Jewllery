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
  currentRates: 'rates:current',
  backupRun: 'backup:run',
  backupRestore: 'backup:restore',
  backupHistory: 'backup:history',
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
  readonly ratePerTolaPaisa: number
  readonly effectiveFrom: string
  /** Preformatted for display, so the renderer never does money arithmetic. */
  readonly display: string
}

export interface UserDto {
  readonly id: string
  readonly name: string
  readonly username: string
  readonly role: string
  readonly mustChangePassword: boolean
}

export interface ShopDto {
  readonly name: string
  readonly ownerName: string
  readonly address: string
}

export interface BackupStatusDto {
  readonly lastBackupAt: string | null
  readonly lastBackupDisplay: string
  readonly daysSince: number | null
  readonly integrityOk: boolean
}

/** Everything the shell needs to draw itself on startup. */
export interface BootstrapDto {
  readonly shop: ShopDto | null
  readonly branchId: string
  readonly branchName: string
  readonly user: UserDto | null
  readonly rates: readonly RateDto[]
  readonly backup: BackupStatusDto
  readonly databaseConnected: boolean
  readonly financialYear: string
  readonly appVersion: string
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
  changePassword(
    current: string,
    next: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>
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
  changePassword: 'auth:changePassword',
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
