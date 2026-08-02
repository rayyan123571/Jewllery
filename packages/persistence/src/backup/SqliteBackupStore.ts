import BetterSqlite3 from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupStore } from '@jewellery/application'
import type { DatabaseHandle } from '../DatabaseHandle.js'

/**
 * The physical side of backup and restore.
 *
 * The important thing here is what it does **not** do: it never plain-copies
 * the live database file. A copy taken while SQLite is mid-write can be torn,
 * and in WAL mode the sidecar can hold committed transactions the main file
 * does not have yet — so a naive `copyFile` of a busy database can produce a
 * backup that is either corrupt or silently missing the last few entries. Both
 * failures are invisible until the day someone tries to restore it.
 *
 * `db.backup()` is SQLite's own online backup API. It takes a consistent
 * snapshot of a database that is being written to, and it is the only correct
 * way to do this.
 */
export class SqliteBackupStore implements BackupStore {
  constructor(
    private readonly handle: DatabaseHandle,
    private readonly backupDirectory: string,
  ) {
    mkdirSync(this.backupDirectory, { recursive: true })
  }

  async snapshot(destinationPath: string): Promise<number> {
    await this.handle.get().backup(destinationPath)
    return statSync(destinationPath).size
  }

  /**
   * Opens the file as a separate read-only connection and runs SQLite's own
   * integrity check.
   *
   * A backup nobody has verified is a hope, not a backup. This runs on every
   * backup so a corrupt one is discovered on the day it is written, not on the
   * day it is needed.
   */
  async verify(filePath: string): Promise<boolean> {
    let db: BetterSqlite3.Database | null = null
    try {
      db = new BetterSqlite3(filePath, { readonly: true, fileMustExist: true })
      const result = db.pragma('integrity_check', { simple: true })
      if (result !== 'ok') return false

      // integrity_check validates the file's structure but says nothing about
      // whether it is *this* application's database. A structurally perfect
      // SQLite file from another program would pass, and restoring it would
      // wipe the shop's books.
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
            WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get() as { n: number }
      return row.n === 1
    } catch {
      return false
    } finally {
      db?.close()
    }
  }

  /**
   * Replaces the live database with `filePath`.
   *
   * Destructive. The caller is responsible for taking a PRE_RESTORE snapshot
   * first — BackupService does, and refuses to proceed if that snapshot fails.
   *
   * The WAL and shared-memory sidecars are removed along with the main file. If
   * they were left behind, SQLite would replay the *old* database's WAL over
   * the newly restored file on next open, which would corrupt it.
   */
  async restore(filePath: string): Promise<void> {
    if (!(await this.verify(filePath))) {
      throw new Error(
        `${filePath} did not pass an integrity check, or is not a database from ` +
          `this application. It has not been restored, and the current data is ` +
          `untouched.`,
      )
    }

    const live = this.handle.file
    this.handle.close()

    for (const sidecar of [`${live}-wal`, `${live}-shm`]) {
      rmSync(sidecar, { force: true })
    }
    copyFileSync(filePath, live)

    this.handle.reopen()
  }

  async list(): Promise<Array<{ path: string; sizeBytes: number; modifiedAt: Date }>> {
    return readdirSync(this.backupDirectory)
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => {
        const path = join(this.backupDirectory, name)
        const stat = statSync(path)
        return { path, sizeBytes: stat.size, modifiedAt: stat.mtime }
      })
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
  }

  async remove(filePath: string): Promise<void> {
    rmSync(filePath, { force: true })
  }

  /**
   * A sortable, human-readable filename. Sorting by name and by date give the
   * same order, which matters when someone is looking at the folder in Explorer
   * rather than in the app.
   */
  pathForNewBackup(kind: string, at: Date): string {
    const pad = (n: number, width = 2): string => n.toString().padStart(width, '0')
    const stamp =
      `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
      `_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
    const base = join(this.backupDirectory, `backup_${stamp}_${kind.toLowerCase()}`)

    // The stamp has second granularity, so two backups of the same kind within
    // one second would land on the same filename and the second would silently
    // overwrite the first. For most files that is a shrug; for the only copy of
    // a shop's books it is data loss, and it is exactly what happens when
    // someone double-clicks Backup. Suffix until the name is free.
    let candidate = `${base}.sqlite`
    let attempt = 1
    while (existsSync(candidate)) {
      candidate = `${base}_${++attempt}.sqlite`
    }
    return candidate
  }
}
