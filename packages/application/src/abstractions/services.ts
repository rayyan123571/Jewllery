/**
 * Capabilities the application layer needs but must not implement itself,
 * because implementing them would mean importing a database, a filesystem or a
 * random source — and then no calculation could be tested without one.
 */

/** Generates row identifiers. Tests inject a counter for stable assertions. */
export interface IdGenerator {
  next(): string
}

/**
 * The physical side of backup: copying bytes, checking a file, deleting old
 * ones. Implemented in persistence, where the SQLite online backup API lives.
 *
 * A plain file copy of a live SQLite database is not safe — a copy taken mid
 * write can be torn, and the WAL sidecar may hold committed data the main file
 * does not yet have. The implementation uses SQLite's own backup API, which
 * takes a consistent snapshot of a database that is being written to.
 */
export interface BackupStore {
  /** Consistent snapshot to `destinationPath`. Returns the bytes written. */
  snapshot(destinationPath: string): Promise<number>
  /** `PRAGMA integrity_check` against a file, without opening it as the app db. */
  verify(filePath: string): Promise<boolean>
  /**
   * Replaces the live database with `filePath`.
   *
   * Destructive and irreversible from the app's point of view, so the caller
   * takes a PRE_RESTORE snapshot first. The implementation closes the live
   * connection, swaps the file, and reopens.
   */
  restore(filePath: string): Promise<void>
  /** Files in the backup directory, newest first. */
  list(): Promise<Array<{ path: string; sizeBytes: number; modifiedAt: Date }>>
  remove(filePath: string): Promise<void>
  /** Absolute path the next backup should be written to. */
  pathForNewBackup(kind: string, at: Date): string
}
