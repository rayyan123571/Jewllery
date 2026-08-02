import { randomUUID } from 'node:crypto'
import {
  PURITIES,
  toIsoTimestamp,
  type Branch,
  type AuditEntry,
  type GoldRate,
  type NewAuditEntry,
  type NewGoldRate,
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
  Repositories,
  SettingsRepository,
  ShopRepository,
  UserRepository,
} from '@jewellery/application'
import type { SqliteDatabase } from '../Database.js'
import {
  fromBool,
  toAuditEntry,
  toBranch,
  toGoldRate,
  toShopProfile,
  toUser,
  type AuditRow,
  type BranchRow,
  type GoldRateRow,
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
 * Statements are prepared once per repository instance and reused. better-sqlite3
 * is synchronous by design — there is no connection pool and no await, because a
 * local file needs neither, and the absence of both removes a whole class of
 * interleaving bug from the ledger.
 */

function now(): string {
  return toIsoTimestamp(new Date())
}

class SqliteShopRepository implements ShopRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(): ShopProfile | null {
    const row = this.db.prepare("SELECT * FROM shop_profile WHERE id = 'shop'").get() as
      | ShopRow
      | undefined
    return row ? toShopProfile(row) : null
  }

  save(profile: Omit<ShopProfile, 'updatedAt'>): ShopProfile {
    // One row, ever — the id is fixed and the schema CHECKs it.
    this.db
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
      .run({ ...profile, updatedAt: now() })

    const saved = this.get()
    if (!saved) throw new Error('Shop profile vanished immediately after saving')
    return saved
  }
}

class SqliteBranchRepository implements BranchRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findById(id: string): Branch | null {
    const row = this.db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as
      | BranchRow
      | undefined
    return row ? toBranch(row) : null
  }

  findDefault(): Branch | null {
    const row = this.db.prepare('SELECT * FROM branches WHERE is_default = 1').get() as
      | BranchRow
      | undefined
    return row ? toBranch(row) : null
  }

  listActive(): Branch[] {
    const rows = this.db
      .prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY is_default DESC, name')
      .all() as BranchRow[]
    return rows.map(toBranch)
  }

  create(branch: Omit<Branch, 'createdAt'>): Branch {
    this.db
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
        now(),
      )
    const created = this.findById(branch.id)
    if (!created) throw new Error(`Branch ${branch.id} vanished immediately after insert`)
    return created
  }

  rename(id: string, name: string, address: string | null): Branch {
    this.db
      .prepare('UPDATE branches SET name = ?, address = ? WHERE id = ?')
      .run(name, address, id)
    const updated = this.findById(id)
    if (!updated) throw new Error(`No such branch: ${id}`)
    return updated
  }
}

class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined
    return row ? toUser(row) : null
  }

  findByUsername(username: string): User | null {
    // COLLATE NOCASE matches the unique index, so lookup and uniqueness agree.
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRow | undefined
    return row ? toUser(row) : null
  }

  list(): User[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY is_active DESC, name')
      .all() as UserRow[]
    return rows.map(toUser)
  }

  countActiveAdmins(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1")
      .get() as { n: number }
    return row.n
  }

  create(user: NewUser): User {
    const id = randomUUID()
    const stamp = now()
    this.db
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
    this.db
      .prepare('UPDATE users SET name = ?, role = ?, branch_id = ?, updated_at = ? WHERE id = ?')
      .run(changes.name, changes.role, changes.branchId, now(), id)
    return this.require(id)
  }

  setPassword(id: string, passwordHash: string, mustChangePassword: boolean): User {
    this.db
      .prepare(
        `UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(passwordHash, fromBool(mustChangePassword), now(), id)
    return this.require(id)
  }

  setActive(id: string, isActive: boolean): User {
    this.db
      .prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
      .run(fromBool(isActive), now(), id)
    return this.require(id)
  }

  recordLogin(id: string): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id)
  }

  private require(id: string): User {
    const user = this.findById(id)
    if (!user) throw new Error(`No such user: ${id}`)
    return user
  }
}

class SqliteGoldRateRepository implements GoldRateRepository {
  constructor(private readonly db: SqliteDatabase) {}

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
    const row = this.db
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
    const rows = this.db
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
    this.db
      .prepare(
        `INSERT INTO gold_rates
           (id, branch_id, purity, rate_per_gram, effective_from,
            created_by_user_id, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        rate.branchId,
        rate.purity,
        // Money crosses into the database as an integer count of paisa.
        rate.ratePerGram.paisa,
        rate.effectiveFrom,
        rate.createdByUserId,
        now(),
        rate.note,
      )
    const row = this.db.prepare('SELECT * FROM gold_rates WHERE id = ?').get(id) as GoldRateRow
    return toGoldRate(row)
  }
}

class SqliteAuditRepository implements AuditRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(entry: NewAuditEntry): AuditEntry {
    const id = randomUUID()
    this.db
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
        now(),
      )
    const row = this.db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditRow
    return toAuditEntry(row)
  }

  recent(limit: number): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as AuditRow[]
    return rows.map(toAuditEntry)
  }

  forEntity(entity: string, entityId: string): AuditEntry[] {
    const rows = this.db
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
  constructor(private readonly db: SqliteDatabase) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                        updated_at = excluded.updated_at`,
      )
      .run(key, value, now())
  }

  all(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as {
      key: string
      value: string
    }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }
}

class SqliteBackupLogRepository implements BackupLogRepository {
  constructor(private readonly db: SqliteDatabase) {}

  append(record: Omit<BackupRecord, 'id' | 'createdAt'>): BackupRecord {
    const id = randomUUID()
    const createdAt = now()
    this.db
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
    const rows = this.db
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

/** Builds every repository over one database connection. */
export function createRepositories(db: SqliteDatabase): Repositories {
  return {
    shop: new SqliteShopRepository(db),
    branches: new SqliteBranchRepository(db),
    users: new SqliteUserRepository(db),
    goldRates: new SqliteGoldRateRepository(db),
    audit: new SqliteAuditRepository(db),
    settings: new SqliteSettingsRepository(db),
    backupLog: new SqliteBackupLogRepository(db),
  }
}
