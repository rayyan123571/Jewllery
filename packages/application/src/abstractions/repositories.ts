import type {
  AuditEntry,
  Branch,
  GoldRate,
  IsoDate,
  NewAuditEntry,
  NewGoldRate,
  NewParty,
  Party,
  Purity,
  Role,
  ShopProfile,
  User,
} from '@jewellery/domain'

/**
 * The seam between business logic and the database.
 *
 * Everything the application layer knows about storage is declared here as an
 * interface. `@jewellery/persistence` implements these against SQLite, and the
 * composition root in the Electron main process injects the implementations.
 *
 * Two things this buys, both of them load-bearing:
 *
 *   1. Every calculation is testable with no database. Tests pass in-memory
 *      fakes, which is why `npm run test` needs no server and no window.
 *   2. Moving to PostgreSQL later is a provider swap plus a migration rather
 *      than a rewrite, because no SQL string exists outside persistence.
 *
 * Note what is absent: there is no `update` on the gold rate repository, and
 * there will be none on any transaction repository. Posted rows are never
 * edited — a correction is a new row, or a reversing entry (DECISIONS §6).
 * That rule is enforced here by not offering the method, which is a stronger
 * guarantee than a comment asking people not to call it.
 */

export interface ShopRepository {
  get(): ShopProfile | null
  save(profile: Omit<ShopProfile, 'updatedAt'>): ShopProfile
}

export interface BranchRepository {
  findById(id: string): Branch | null
  findDefault(): Branch | null
  listActive(): Branch[]
  create(branch: Omit<Branch, 'createdAt'>): Branch
  rename(id: string, name: string, address: string | null): Branch
}

export interface NewUser {
  readonly branchId: string | null
  readonly name: string
  readonly username: string
  readonly passwordHash: string
  readonly role: Role
  readonly mustChangePassword: boolean
}

export interface UserRepository {
  findById(id: string): User | null
  /** Case-insensitive, matching the unique index on the column. */
  findByUsername(username: string): User | null
  list(): User[]
  countActiveAdmins(): number
  create(user: NewUser): User
  updateProfile(id: string, changes: { name: string; role: Role; branchId: string | null }): User
  setPassword(id: string, passwordHash: string, mustChangePassword: boolean): User
  setActive(id: string, isActive: boolean): User
  recordLogin(id: string): void
}

export interface GoldRateRepository {
  /**
   * The rate in force for a purity on a given business day.
   *
   * "In force" means the latest rate whose effectiveFrom is on or before that
   * day — not the newest row. Valuation must use the rate that applied on the
   * day of the transaction, or reprinting last month's statement silently
   * reprices it and the paper the customer holds stops matching the screen.
   *
   * Null when no rate has ever been recorded on or before that day, which is a
   * real state on a fresh install and must not be treated as zero.
   */
  findEffective(branchId: string, purity: Purity, on: IsoDate): GoldRate | null
  /** The rate in force today for every purity, for the rate panel. */
  findAllEffective(branchId: string, on: IsoDate): Partial<Record<Purity, GoldRate>>
  history(branchId: string, purity: Purity, limit: number): GoldRate[]
  record(rate: NewGoldRate): GoldRate
}

export interface AuditRepository {
  append(entry: NewAuditEntry): AuditEntry
  recent(limit: number): AuditEntry[]
  forEntity(entity: string, entityId: string): AuditEntry[]
}

export interface SettingsRepository {
  get(key: string): string | null
  set(key: string, value: string): void
  all(): Record<string, string>
}

export type BackupKind = 'AUTO' | 'MANUAL' | 'PRE_RESTORE'

export interface BackupRecord {
  readonly id: string
  readonly filePath: string
  readonly sizeBytes: number
  readonly kind: BackupKind
  readonly integrityOk: boolean
  readonly createdByUserId: string | null
  readonly createdAt: string
}

export interface BackupLogRepository {
  append(record: Omit<BackupRecord, 'id' | 'createdAt'>): BackupRecord
  recent(limit: number): BackupRecord[]
  latest(): BackupRecord | null
}

/** Everything the application layer can reach, handed over as one object. */
export interface Repositories {
  readonly shop: ShopRepository
  readonly branches: BranchRepository
  readonly users: UserRepository
  readonly goldRates: GoldRateRepository
  readonly audit: AuditRepository
  readonly settings: SettingsRepository
  readonly backupLog: BackupLogRepository
  readonly parties: PartyRepository
}

// ── parties (M1) ────────────────────────────────────────────────────────────

export interface PartySearchResult {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
}

export interface PartyRepository {
  findById(id: string): Party | null
  /** Case-insensitive, matching the unique index on (branch_id, code). */
  findByCode(branchId: string, code: string): Party | null
  /**
   * Type-ahead for the party selector.
   *
   * Matches code or name, prefix matches first so typing "CH" puts "CHJ" above
   * "ALCH". Inactive parties are excluded: a party nobody trades with any more
   * should not be selectable on a new slip, though their ledger stays readable.
   */
  search(branchId: string, query: string, limit: number): PartySearchResult[]
  list(branchId: string, includeInactive: boolean): Party[]
  create(party: NewParty): Party
  update(
    id: string,
    changes: {
      name: string
      mobile: string | null
      city: string | null
      notes: string | null
    },
  ): Party
  setActive(id: string, isActive: boolean): Party
}
