import BetterSqlite3 from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { runMigrations } from './migrations/runner.js'

export type SqliteDatabase = BetterSqlite3.Database

export interface OpenOptions {
  /** Absolute path to the .sqlite file. Its directory is created if missing. */
  readonly file: string
  /** Statement logger. Matches better-sqlite3's own signature. */
  readonly verbose?: ((message?: unknown, ...args: unknown[]) => void) | undefined
}

/**
 * Opens the shop's database and brings its schema up to date.
 *
 * The pragmas below are the durability contract. This is a gold ledger held on
 * one PC with no copy anywhere else, so the settings are chosen for "never lose
 * a committed transaction" rather than for throughput. A jewellery shop writes
 * a few hundred rows a day; there is nothing to optimise for.
 */
export function openDatabase(options: OpenOptions): SqliteDatabase {
  mkdirSync(dirname(options.file), { recursive: true })

  const db = new BetterSqlite3(options.file, {
    ...(options.verbose ? { verbose: options.verbose } : {}),
  })

  applyPragmas(db)
  runMigrations(db)
  return db
}

/** Opens an in-memory database with the full schema. Tests only. */
export function openInMemoryDatabase(): SqliteDatabase {
  const db = new BetterSqlite3(':memory:')
  applyPragmas(db, { walOnDisk: false })
  runMigrations(db)
  return db
}

function applyPragmas(db: SqliteDatabase, opts: { walOnDisk?: boolean } = {}): void {
  // Write-ahead logging. A reader never blocks a writer, and — the part that
  // matters here — a crash mid-write leaves a recoverable log rather than a
  // half-written database file. This is the specific failure the previous
  // project's sql.js approach could not survive: it held the whole database in
  // memory and rewrote the entire file on every flush, so a power cut during
  // the write could destroy the lot.
  if (opts.walOnDisk !== false) {
    db.pragma('journal_mode = WAL')
  }

  // FULL, not the WAL default of NORMAL.
  //
  // Under NORMAL, SQLite does not fsync the WAL on every commit, so a power cut
  // can lose the most recent transactions even though they were committed and
  // the shopkeeper was told the entry was saved. That is precisely the
  // situation this system must not create. FULL costs an fsync per commit,
  // which at a few hundred writes a day is invisible.
  db.pragma('synchronous = FULL')

  // Referential integrity is off by default in SQLite, which surprises people.
  // Without this, a gold rate can reference a deleted user.
  db.pragma('foreign_keys = ON')

  // If a second connection (a backup, say) holds a lock, wait rather than
  // failing immediately.
  db.pragma('busy_timeout = 5000')

  // Keeps the WAL from growing without bound during a long session.
  db.pragma('wal_autocheckpoint = 1000')
}

/**
 * Runs `fn` inside a transaction, rolling back if it throws.
 *
 * Repositories use this for any write that spans more than one statement, so a
 * partially applied change cannot survive an error.
 */
export function inTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  return db.transaction(fn)()
}

export function closeDatabase(db: SqliteDatabase): void {
  // Fold the WAL back into the main file on a clean shutdown, so the .sqlite is
  // self-contained for anyone copying it, and so a restore never has to reason
  // about a stale sidecar.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A checkpoint can fail if another connection is mid-read. Closing is still
    // correct — the WAL stays on disk and SQLite recovers from it on next open.
  }
  db.close()
}
