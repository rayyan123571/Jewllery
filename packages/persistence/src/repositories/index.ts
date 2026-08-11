import { randomUUID } from 'node:crypto'
import {
  PURITIES,
  systemClock,
  toIsoTimestamp,
  type Clock,
  type Branch,
  type AuditEntry,
  type GoldRate,
  type NewAuditEntry,
  type NewGoldRate,
  type NewParty,
  type Party,
  type IsoDate,
  type Purity,
  type Role,
  type ShopProfile,
  type User,
} from '@jewellery/domain'
import type {
  AuditRepository,
  BackupLogRepository,
  BackupRecord,
  BranchRepository,
  GoldRateRepository,
  NewUser,
  PartyRepository,
  PartySearchResult,
  Repositories,
  SettingsRepository,
  ShopRepository,
  UserRepository,
} from '@jewellery/application'
import type { DatabaseProvider, SqliteDatabase } from '../Database.js'
import { SqliteWholesaleRepository } from './wholesale.js'
import {
  SqliteCustomerRepository,
  SqliteRetailBillRepository,
  SqliteRetailDraftRepository,
  SqliteRetailSaleRepository,
  SqliteSalesmanRepository,
} from './retail.js'
import {
  fromBool,
  toAuditEntry,
  toBranch,
  toGoldRate,
  toParty,
  toShopProfile,
  toUser,
  type AuditRow,
  type BranchRow,
  type GoldRateRow,
  type PartyRow,
  type ShopRow,
  type UserRow,
} from './mappers.js'

/**
 * SQLite implementations of the repository interfaces.
 *
 * This file and its neighbours are the only place in the codebase where SQL
 * appears. Everything above it depends on the interfaces in
 * `@jewellery/application/abstractions`, which is what makes a later move to
 * PostgreSQL a provider swap rather than a rewrite.
 *
 * Every method fetches the connection through a DatabaseProvider rather than
 * capturing one at construction. Restore replaces the database file and reopens
 * the connection, and a repository holding the old object would be left talking
 * to a closed handle — a backup test caught exactly that. Statements are
 * therefore prepared per call; better-sqlite3's prepare is cheap, and at a shop
 * counter's write volume the correctness is worth far more than the microseconds.
 *
 * better-sqlite3 is synchronous by design — no connection pool, no await, because
 * a local file needs neither, and the absence of both removes a whole class of
 * interleaving bug from the ledger.
 */

/**
 * Every timestamp in the database comes from the injected clock.
 *
 * Previously this called `new Date()` directly, so repository timestamps and
 * service timestamps could come from different sources. A test caught it:
 * `daysSinceLastGoodBackup` compared a frozen service clock against a real
 * wall-clock row and returned -1. In a ledger, two disagreeing sources of "now"
 * is not a test artifact — it is a reconciliation bug waiting to happen.
 */
function nowFrom(clock: Clock): string {
  return toIsoTimestamp(clock.now())
}

class SqliteShopRepository implements ShopRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  get(): ShopProfile | null {
    const row = this.conn.get().prepare("SELECT * FROM shop_profile WHERE id = 'shop'").get() as
      | ShopRow
      | undefined
    return row ? toShopProfile(row) : null
  }

  save(profile: Omit<ShopProfile, 'updatedAt'>): ShopProfile {
    // One row, ever — the id is fixed and the schema CHECKs it.
    this.conn.get()
      .prepare(
        `INSERT INTO shop_profile
           (id, name, tagline, owner_name, second_owner_name,
            phone1, phone2, phone3, address, logo_path, updated_at)
         VALUES ('shop', @name, @tagline, @ownerName, @secondOwnerName,
                 @phone1, @phone2, @phone3, @address, @logoPath, @updatedAt)
         ON CONFLICT (id) DO UPDATE SET
           name = @name, tagline = @tagline, owner_name = @ownerName,
           second_owner_name = @secondOwnerName, phone1 = @phone1,
           phone2 = @phone2, phone3 = @phone3, address = @address,
           logo_path = @logoPath, updated_at = @updatedAt`,
      )
      .run({ ...profile, updatedAt: nowFrom(this.clock) })

    const saved = this.get()
    if (!saved) throw new Error('Shop profile vanished immediately after saving')
    return saved
  }
}

class SqliteBranchRepository implements BranchRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  findById(id: string): Branch | null {
    const row = this.conn.get().prepare('SELECT * FROM branches WHERE id = ?').get(id) as
      | BranchRow
      | undefined
    return row ? toBranch(row) : null
  }

  findDefault(): Branch | null {
    const row = this.conn.get().prepare('SELECT * FROM branches WHERE is_default = 1').get() as
      | BranchRow
      | undefined
    return row ? toBranch(row) : null
  }

  listActive(): Branch[] {
    const rows = this.conn.get()
      .prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY is_default DESC, name')
      .all() as BranchRow[]
    return rows.map(toBranch)
  }

  create(branch: Omit<Branch, 'createdAt'>): Branch {
    this.conn.get()
      .prepare(
        `INSERT INTO branches (id, name, address, is_default, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        branch.id,
        branch.name,
        branch.address,
        fromBool(branch.isDefault),
        fromBool(branch.isActive),
        nowFrom(this.clock),
      )
    const created = this.findById(branch.id)
    if (!created) throw new Error(`Branch ${branch.id} vanished immediately after insert`)
    return created
  }

  rename(id: string, name: string, address: string | null): Branch {
    this.conn.get()
      .prepare('UPDATE branches SET name = ?, address = ? WHERE id = ?')
      .run(name, address, id)
    const updated = this.findById(id)
    if (!updated) throw new Error(`No such branch: ${id}`)
    return updated
  }
}

class SqliteUserRepository implements UserRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  findById(id: string): User | null {
    const row = this.conn.get().prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined
    return row ? toUser(row) : null
  }

  findByUsername(username: string): User | null {
    // COLLATE NOCASE matches the unique index, so lookup and uniqueness agree.
    const row = this.conn.get()
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRow | undefined
    return row ? toUser(row) : null
  }

  list(): User[] {
    const rows = this.conn.get()
      .prepare('SELECT * FROM users ORDER BY is_active DESC, name')
      .all() as UserRow[]
    return rows.map(toUser)
  }

  countActiveAdmins(): number {
    const row = this.conn.get()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1")
      .get() as { n: number }
    return row.n
  }

  create(user: NewUser): User {
    const id = randomUUID()
    const stamp = nowFrom(this.clock)
    this.conn.get()
      .prepare(
        `INSERT INTO users
           (id, branch_id, name, username, password_hash, role,
            is_active, must_change_password, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        user.branchId,
        user.name,
        user.username,
        user.passwordHash,
        user.role,
        fromBool(user.mustChangePassword),
        stamp,
        stamp,
      )
    return this.require(id)
  }

  updateProfile(
    id: string,
    changes: { name: string; role: Role; branchId: string | null },
  ): User {
    this.conn.get()
      .prepare('UPDATE users SET name = ?, role = ?, branch_id = ?, updated_at = ? WHERE id = ?')
      .run(changes.name, changes.role, changes.branchId, nowFrom(this.clock), id)
    return this.require(id)
  }

  setPassword(id: string, passwordHash: string, mustChangePassword: boolean): User {
    this.conn.get()
      .prepare(
        `UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(passwordHash, fromBool(mustChangePassword), nowFrom(this.clock), id)
    return this.require(id)
  }

  setActive(id: string, isActive: boolean): User {
    this.conn.get()
      .prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(fromBool(isActive), nowFrom(this.clock), id)
    return this.require(id)
  }

  recordLogin(id: string): void {
    this.conn.get().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowFrom(this.clock), id)
  }

  private require(id: string): User {
    const user = this.findById(id)
    if (!user) throw new Error(`No such user: ${id}`)
    return user
  }
}

class SqliteGoldRateRepository implements GoldRateRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  /**
   * The latest rate whose effective_from is on or before `on`.
   *
   * Three levels of ordering, and all three are needed:
   *
   *   effective_from DESC   the rate in force, not the newest row
   *   created_at DESC       a correction recorded later wins
   *   rowid DESC            the tie-break that makes it deterministic
   *
   * The rowid is not decoration. created_at has millisecond precision, so two
   * rates recorded in the same millisecond — a double-clicked Save, or a script
   * — have identical timestamps and SQLite is then free to return either row.
   * A test caught exactly that. rowid is monotonically increasing per insert,
   * so it settles the order in insertion sequence, which is what "recorded
   * later" means.
   *
   * effective_from and created_at are TEXT and sort lexicographically, which is
   * why no date parsing is needed in SQL.
   */
  findEffective(branchId: string, purity: Purity, on: IsoDate): GoldRate | null {
    const row = this.conn.get()
      .prepare(
        `SELECT * FROM gold_rates
          WHERE branch_id = ? AND purity = ? AND effective_from <= ?
          ORDER BY effective_from DESC, created_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(branchId, purity, on) as GoldRateRow | undefined
    return row ? toGoldRate(row) : null
  }

  /**
   * Deliberately one indexed lookup per purity rather than one clever query.
   *
   * There are four purities, the index serves each lookup directly, and this
   * shares the exact ordering rules above instead of restating them in a form
   * that could drift. A single-query version using string concatenation to
   * emulate the composite sort was tried and was both harder to read and wrong
   * on the same-millisecond tie.
   */
  findAllEffective(branchId: string, on: IsoDate): Partial<Record<Purity, GoldRate>> {
    const result: Partial<Record<Purity, GoldRate>> = {}
    for (const purity of PURITIES) {
      const rate = this.findEffective(branchId, purity, on)
      if (rate) result[purity] = rate
    }
    return result
  }

  history(branchId: string, purity: Purity, limit: number): GoldRate[] {
    const rows = this.conn.get()
      .prepare(
        `SELECT * FROM gold_rates
          WHERE branch_id = ? AND purity = ?
          ORDER BY effective_from DESC, created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(branchId, purity, limit) as GoldRateRow[]
    return rows.map(toGoldRate)
  }

  /** Insert only. There is deliberately no update — a rate is history. */
  record(rate: NewGoldRate): GoldRate {
    const id = randomUUID()
    this.conn.get()
      .prepare(
        `INSERT INTO gold_rates
           (id, branch_id, purity, rate_per_tola, effective_from,
            created_by_user_id, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        rate.branchId,
        rate.purity,
        // Money crosses into the database as an integer count of paisa,
        // per tola — the unit it was entered in.
        rate.ratePerTola.paisa,
        rate.effectiveFrom,
        rate.createdByUserId,
        nowFrom(this.clock),
        rate.note,
      )
    const row = this.conn.get().prepare('SELECT * FROM gold_rates WHERE id = ?').get(id) as GoldRateRow
    return toGoldRate(row)
  }
}

class SqliteAuditRepository implements AuditRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  append(entry: NewAuditEntry): AuditEntry {
    const id = randomUUID()
    this.conn.get()
      .prepare(
        `INSERT INTO audit_log
           (id, branch_id, user_id, action, entity, entity_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.branchId,
        entry.userId,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.detail,
        nowFrom(this.clock),
      )
    const row = this.conn.get().prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditRow
    return toAuditEntry(row)
  }

  recent(limit: number): AuditEntry[] {
    const rows = this.conn.get()
      .prepare('SELECT * FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as AuditRow[]
    return rows.map(toAuditEntry)
  }

  forEntity(entity: string, entityId: string): AuditEntry[] {
    const rows = this.conn.get()
      .prepare(
        `SELECT * FROM audit_log
          WHERE entity = ? AND entity_id = ?
          ORDER BY created_at DESC, rowid DESC`,
      )
      .all(entity, entityId) as AuditRow[]
    return rows.map(toAuditEntry)
  }
}

class SqliteSettingsRepository implements SettingsRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  get(key: string): string | null {
    const row = this.conn.get().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.conn.get()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                        updated_at = excluded.updated_at`,
      )
      .run(key, value, nowFrom(this.clock))
  }

  all(): Record<string, string> {
    const rows = this.conn.get().prepare('SELECT key, value FROM app_settings').all() as {
      key: string
      value: string
    }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }
}

class SqliteBackupLogRepository implements BackupLogRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  append(record: Omit<BackupRecord, 'id' | 'createdAt'>): BackupRecord {
    const id = randomUUID()
    const createdAt = nowFrom(this.clock)
    this.conn.get()
      .prepare(
        `INSERT INTO backup_log
           (id, file_path, size_bytes, kind, integrity_ok, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        record.filePath,
        record.sizeBytes,
        record.kind,
        fromBool(record.integrityOk),
        record.createdByUserId,
        createdAt,
      )
    return { ...record, id, createdAt }
  }

  recent(limit: number): BackupRecord[] {
    const rows = this.conn.get()
      .prepare('SELECT * FROM backup_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<{
      id: string
      file_path: string
      size_bytes: number
      kind: string
      integrity_ok: number
      created_by_user_id: string | null
      created_at: string
    }>
    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      sizeBytes: r.size_bytes,
      kind: r.kind as BackupRecord['kind'],
      integrityOk: r.integrity_ok === 1,
      createdByUserId: r.created_by_user_id,
      createdAt: r.created_at,
    }))
  }

  latest(): BackupRecord | null {
    return this.recent(1)[0] ?? null
  }
}

class SqlitePartyRepository implements PartyRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  findById(id: string): Party | null {
    const row = this.conn.get().prepare('SELECT * FROM parties WHERE id = ?').get(id) as
      | PartyRow
      | undefined
    return row ? toParty(row) : null
  }

  findByCode(branchId: string, code: string): Party | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM parties WHERE branch_id = ? AND code = ? COLLATE NOCASE')
      .get(branchId, code) as PartyRow | undefined
    return row ? toParty(row) : null
  }

  /**
   * Type-ahead. Prefix matches rank above contains-matches, so typing "CH"
   * offers "CHAUDHARY" before "AL-CHISHTI" — which is what someone typing a
   * code expects, and what makes the first suggestion safe to accept blind.
   */
  search(branchId: string, query: string, limit: number): PartySearchResult[] {
    const like = `%${query}%`
    const prefix = `${query}%`
    const rows = this.conn
      .get()
      .prepare(
        `SELECT id, code, name, mobile, city
           FROM parties
          WHERE branch_id = ? AND is_active = 1
            AND (code LIKE ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE)
          ORDER BY
            CASE WHEN code LIKE ? COLLATE NOCASE THEN 0
                 WHEN name LIKE ? COLLATE NOCASE THEN 1
                 ELSE 2 END,
            name COLLATE NOCASE
          LIMIT ?`,
      )
      .all(branchId, like, like, prefix, prefix, limit) as PartySearchResult[]
    return rows
  }

  list(branchId: string, includeInactive: boolean): Party[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM parties
          WHERE branch_id = ?${includeInactive ? '' : ' AND is_active = 1'}
          ORDER BY name COLLATE NOCASE`,
      )
      .all(branchId) as PartyRow[]
    return rows.map(toParty)
  }

  create(party: NewParty): Party {
    const id = randomUUID()
    const stamp = nowFrom(this.clock)
    this.conn
      .get()
      .prepare(
        `INSERT INTO parties
           (id, branch_id, code, name, mobile, city,
            opening_gold_mg, opening_cash_paisa, is_active, notes,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        party.branchId,
        party.code,
        party.name,
        party.mobile,
        party.city,
        // Value objects become integers here and nowhere else.
        party.openingGold.milligrams,
        party.openingCash.paisa,
        party.notes,
        stamp,
        stamp,
      )
    return this.require(id)
  }

  update(
    id: string,
    changes: { name: string; mobile: string | null; city: string | null; notes: string | null },
  ): Party {
    // No code and no opening balances in this statement, on purpose — both
    // appear on slips that have already been printed, and changing either would
    // silently rewrite what those slips meant.
    this.conn
      .get()
      .prepare(
        `UPDATE parties SET name = ?, mobile = ?, city = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(changes.name, changes.mobile, changes.city, changes.notes, nowFrom(this.clock), id)
    return this.require(id)
  }

  setActive(id: string, isActive: boolean): Party {
    this.conn
      .get()
      .prepare('UPDATE parties SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(fromBool(isActive), nowFrom(this.clock), id)
    return this.require(id)
  }

  private require(id: string): Party {
    const party = this.findById(id)
    if (!party) throw new Error(`No such party: ${id}`)
    return party
  }
}

/**
 * Builds every repository over a connection source.
 *
 * Accepts a DatabaseHandle (production, survives restore) or a bare connection
 * (tests that never restore). Passing a bare connection is safe only because
 * such a database is never swapped underneath.
 */
export function createRepositories(
  source: SqliteDatabase | DatabaseProvider,
  clock: Clock = systemClock,
): Repositories {
  const conn: DatabaseProvider = 'get' in source ? source : { get: () => source }
  return {
    shop: new SqliteShopRepository(conn, clock),
    branches: new SqliteBranchRepository(conn, clock),
    users: new SqliteUserRepository(conn, clock),
    goldRates: new SqliteGoldRateRepository(conn, clock),
    audit: new SqliteAuditRepository(conn, clock),
    settings: new SqliteSettingsRepository(conn, clock),
    backupLog: new SqliteBackupLogRepository(conn, clock),
    parties: new SqlitePartyRepository(conn, clock),
    wholesale: new SqliteWholesaleRepository(conn, clock),
    customers: new SqliteCustomerRepository(conn, clock),
    salesmen: new SqliteSalesmanRepository(conn),
    retailSales: new SqliteRetailSaleRepository(conn, clock),
    retailBills: new SqliteRetailBillRepository(conn, clock),
    retailDrafts: new SqliteRetailDraftRepository(conn, clock),
  }
}
