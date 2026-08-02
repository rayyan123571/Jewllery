import { closeDatabase, openDatabase, type SqliteDatabase } from './Database.js'

/**
 * Owns the live connection so it can be closed and reopened underneath the
 * application.
 *
 * Restore needs this. Replacing the database file means closing the connection,
 * swapping the file, and opening again — and every repository holds a reference
 * to the connection it was built with. Rather than rebuilding every repository,
 * they go through this handle, so a restore is invisible to them.
 */
export class DatabaseHandle {
  private db: SqliteDatabase

  constructor(readonly file: string) {
    this.db = openDatabase({ file })
  }

  get(): SqliteDatabase {
    return this.db
  }

  /** Closes and reopens the connection against the file at the same path. */
  reopen(): void {
    closeDatabase(this.db)
    this.db = openDatabase({ file: this.file })
  }

  close(): void {
    closeDatabase(this.db)
  }
}
