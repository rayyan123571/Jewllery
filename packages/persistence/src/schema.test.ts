import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, openInMemoryDatabase } from './Database.js'
import { currentVersion, latestVersion } from './migrations/runner.js'
import type { SqliteDatabase } from './Database.js'

/**
 * These tests open a real database, but in a temp directory the test creates
 * and destroys. There is still no server to start and no window to render.
 */

interface ColumnInfo {
  name: string
  type: string
  notnull: number
}

function columnsOf(db: SqliteDatabase, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}

function userTables(db: SqliteDatabase): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name)
}

describe('the schema', () => {
  let db: SqliteDatabase

  beforeEach(() => {
    db = openInMemoryDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('migrates to the latest version', () => {
    expect(currentVersion(db)).toBe(latestVersion())
  })

  it('creates every M0 table', () => {
    const tables = userTables(db)
    for (const expected of [
      'branches',
      'shop_profile',
      'users',
      'gold_rates',
      'audit_log',
      'app_settings',
      'backup_log',
      'schema_migrations',
    ]) {
      expect(tables).toContain(expected)
    }
  })

  // The hard rule from docs/DECISIONS.md §2, asserted rather than trusted.
  it('has no REAL column anywhere — money and weight are integers', () => {
    const offenders: string[] = []
    for (const table of userTables(db)) {
      for (const column of columnsOf(db, table)) {
        const type = column.type.toUpperCase()
        if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE')) {
          offenders.push(`${table}.${column.name} (${column.type})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('stores the gold rate as an integer number of paisa', () => {
    const rate = columnsOf(db, 'gold_rates').find((c) => c.name === 'rate_per_gram')
    expect(rate?.type).toBe('INTEGER')
    expect(rate?.notnull).toBe(1)
  })

  it('puts branch_id on the tables that will carry transactions', () => {
    for (const table of ['gold_rates', 'audit_log']) {
      const names = columnsOf(db, table).map((c) => c.name)
      expect(names).toContain('branch_id')
    }
  })

  it('allows exactly one shop profile row', () => {
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO shop_profile (id, name, owner_name, phone1, address, updated_at)
       VALUES (?, 'A', 'B', '1', 'C', ?)`,
    )
    insert.run('shop', now)
    expect(() => insert.run('shop2', now)).toThrow()
  })

  it('allows only one default branch', () => {
    const now = new Date().toISOString()
    const insert = db.prepare(
      'INSERT INTO branches (id, name, is_default, created_at) VALUES (?, ?, 1, ?)',
    )
    insert.run('b1', 'Main', now)
    expect(() => insert.run('b2', 'Second', now)).toThrow()
  })

  it('rejects an unknown role rather than storing it', () => {
    const now = new Date().toISOString()
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (id, name, username, password_hash, role, created_at, updated_at)
           VALUES ('u1', 'X', 'x', 'h', 'SUPERUSER', ?, ?)`,
        )
        .run(now, now),
    ).toThrow()
  })

  it('rejects a duplicate username differing only in case', () => {
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO users (id, name, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'X', ?, 'h', 'ADMIN', ?, ?)`,
    )
    insert.run('u1', 'admin', now, now)
    expect(() => insert.run('u2', 'Admin', now, now)).toThrow()
  })

  it('enforces foreign keys', () => {
    const now = new Date().toISOString()
    expect(() =>
      db
        .prepare(
          `INSERT INTO gold_rates
             (id, branch_id, purity, rate_per_gram, effective_from, created_by_user_id, created_at)
           VALUES ('r1', 'no-such-branch', 'K22', 895000, '2026-08-02', 'no-such-user', ?)`,
        )
        .run(now),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('rejects a non-positive gold rate', () => {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO branches (id, name, created_at) VALUES (?, ?, ?)').run(
      'b1',
      'Main',
      now,
    )
    db.prepare(
      `INSERT INTO users (id, name, username, password_hash, role, created_at, updated_at)
       VALUES ('u1', 'X', 'x', 'h', 'ADMIN', ?, ?)`,
    ).run(now, now)
    expect(() =>
      db
        .prepare(
          `INSERT INTO gold_rates
             (id, branch_id, purity, rate_per_gram, effective_from, created_by_user_id, created_at)
           VALUES ('r1', 'b1', 'K22', 0, '2026-08-02', 'u1', ?)`,
        )
        .run(now),
    ).toThrow()
  })
})

describe('durability settings', () => {
  let dir: string
  let db: SqliteDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jewellery-test-'))
    db = openDatabase({ file: join(dir, 'nested', 'shop.sqlite') })
  })

  afterEach(() => {
    try {
      closeDatabase(db)
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs in WAL mode, so a crash mid-write is recoverable', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  })

  it('fsyncs on every commit, so a power cut cannot lose a saved entry', () => {
    // synchronous = FULL is 2. The WAL default of NORMAL (1) can lose recently
    // committed transactions on power loss, after the user was told it saved.
    expect(db.pragma('synchronous', { simple: true })).toBe(2)
  })

  it('enforces foreign keys', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('creates the database directory if it does not exist', () => {
    expect(currentVersion(db)).toBe(latestVersion())
  })

  it('is idempotent — reopening does not re-run migrations', () => {
    const file = db.name
    closeDatabase(db)
    const reopened = openDatabase({ file })
    expect(currentVersion(reopened)).toBe(latestVersion())
    const count = reopened
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get() as { n: number }
    expect(count.n).toBe(latestVersion())
    closeDatabase(reopened)
    db = openDatabase({ file })
  })

  it('survives a close and reopen with data intact', () => {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO branches (id, name, created_at) VALUES (?, ?, ?)').run(
      'b1',
      'Main Branch',
      now,
    )
    const file = db.name
    closeDatabase(db)

    db = openDatabase({ file })
    const row = db.prepare('SELECT name FROM branches WHERE id = ?').get('b1') as
      | { name: string }
      | undefined
    expect(row?.name).toBe('Main Branch')
  })
})
