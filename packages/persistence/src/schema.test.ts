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

  it('creates the retail tables, including the bill that groups slips', () => {
    const tables = userTables(db)
    for (const expected of [
      // One directory, shared with wholesale. `customers` and `parties` were
      // two tables for one person; see migration 015.
      'contacts',
      'salesmen',
      'retail_sales',
      'retail_sale_items',
      'retail_bills',
      'invoice_sequences',
    ]) {
      expect(tables).toContain(expected)
    }
  })

  it('keeps ONE directory of people, not one per screen', () => {
    const tables = userTables(db)
    // The two it replaced are gone rather than left behind empty: a table
    // nothing writes to is one somebody wires a screen back up to later, and
    // then the shop has two balances for one person again.
    expect(tables).not.toContain('customers')
    expect(tables).not.toContain('parties')
  })

  it('numbers wholesale slips as integers, from its own sequence', () => {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('wholesale_entries')")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(columns).toContain('invoice_number')
    // The text number is gone: a slip number that sorts lexically puts 'WS-10'
    // before 'WS-9', which is how NEXT lands on the wrong slip.
    expect(columns).not.toContain('invoice_no')

    const sequences = db
      .prepare('SELECT key, next_number FROM invoice_sequences ORDER BY key')
      .all() as { key: string; next_number: number }[]
    // Two books beside retail's, each starting at 1 on a shop with no history.
    expect(sequences).toContainEqual({ key: 'wholesale', next_number: 1 })
    expect(sequences).toContainEqual({ key: 'settlement', next_number: 1 })
  })

  it('creates the purchase tables and the stock ledger', () => {
    const tables = userTables(db)
    for (const expected of ['purchase_entries', 'purchase_line_items', 'stock_ledger']) {
      expect(tables).toContain(expected)
    }

    const sequences = db
      .prepare('SELECT key, next_number FROM invoice_sequences ORDER BY key')
      .all() as { key: string; next_number: number }[]
    // The purchase book, starting at 1 on a shop with no history.
    expect(sequences).toContainEqual({ key: 'purchase', next_number: 1 })
  })

  it('keeps stock as a ledger — no balance column anywhere to drift', () => {
    // The failure this prevents: a mutable quantity that disagrees with the
    // movements behind it, with no way to say which of the two is lying.
    const columns = columnsOf(db, 'stock_ledger').map((c) => c.name)
    expect(columns).toContain('gross_mg')
    expect(columns).toContain('khalis_mg')
    expect(columns).not.toContain('balance_mg')
    expect(columns).not.toContain('quantity')

    const tables = userTables(db)
    expect(tables).not.toContain('stock_items')
    expect(tables).not.toContain('stock_balances')
  })

  it('creates the inventory setup tables', () => {
    const tables = userTables(db)
    for (const expected of ['items', 'item_categories', 'locations', 'pieces', 'piece_events']) {
      expect(tables).toContain(expected)
    }
    const sequences = db
      .prepare('SELECT key, next_number FROM invoice_sequences ORDER BY key')
      .all() as { key: string; next_number: number }[]
    expect(sequences).toContainEqual({ key: 'piece_tag', next_number: 1 })
  })

  it('keeps the item master free of weight and quantity — stock is pieces', () => {
    // The failure this prevents: an "on hand" counter that cannot say WHICH
    // 22K ring is on hand, because two of them weigh 4.200 g and 5.800 g.
    // Every physical article gets its own row (pieces, stage 2), and quantity
    // is a COUNT of those rows, never a stored number.
    const columns = columnsOf(db, 'items').map((c) => c.name)
    expect(columns).not.toContain('quantity')
    expect(columns).not.toContain('qty')
    expect(columns).not.toContain('gross_mg')
    expect(columns).not.toContain('weight_mg')
    expect(columns).not.toContain('khalis_mg')
  })

  it('gives retail_sales its place in a bill, all three columns nullable', () => {
    // Nullable is the point: every sale written before migration 009 has no
    // bill, and a single-slip sale is a whole sale rather than a gap to backfill.
    const columns = columnsOf(db, 'retail_sales')
    for (const name of ['bill_id', 'slip_no', 'slip_label']) {
      const column = columns.find((c) => c.name === name)
      expect(column, `retail_sales.${name} is missing`).toBeTruthy()
      expect(column?.notnull).toBe(0)
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
    const rate = columnsOf(db, 'gold_rates').find((c) => c.name === 'rate_per_tola')
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
             (id, branch_id, purity, rate_per_tola, effective_from, created_by_user_id, created_at)
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
             (id, branch_id, purity, rate_per_tola, effective_from, created_by_user_id, created_at)
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
