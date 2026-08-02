import type BetterSqlite3 from 'better-sqlite3'
import { migration001 } from './001-initial.js'

export interface Migration {
  /** Applied in ascending order. Never renumber a released migration. */
  readonly version: number
  readonly name: string
  readonly up: string
}

/**
 * Every migration, in order. Append only.
 *
 * There is no `down`. A shop's database is the only copy of its books, and a
 * rollback that drops a column drops the trading history in it. The safe
 * reverse of a bad migration is a forward migration that corrects it, plus the
 * pre-restore backup that `restore` takes automatically.
 */
const MIGRATIONS: readonly Migration[] = [migration001]

/**
 * Brings the schema up to date, one migration per transaction.
 *
 * Each migration and its version row commit together, so an interrupted
 * upgrade leaves the database at a known version rather than half-migrated.
 * SQLite supports transactional DDL, which is what makes this possible — the
 * same guarantee is not available on every engine.
 */
export function runMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue

    const apply = db.transaction(() => {
      db.exec(migration.up)
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString())
    })

    try {
      apply()
    } catch (cause) {
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed and was rolled ` +
          `back. The database is still at version ${currentVersion(db)}.`,
        { cause },
      )
    }
  }
}

export function currentVersion(db: BetterSqlite3.Database): number {
  const row = db
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null } | undefined
  return row?.version ?? 0
}

export function latestVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)
}
