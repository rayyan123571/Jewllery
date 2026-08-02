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
}

declare global {
  interface Window {
    readonly api: RendererApi
  }
}
