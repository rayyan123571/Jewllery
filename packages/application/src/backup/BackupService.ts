import { can, type Clock, type PublicUser } from '@jewellery/domain'
import type {
  AuditRepository,
  BackupKind,
  BackupLogRepository,
  BackupRecord,
} from '../abstractions/repositories.js'
import type { BackupStore } from '../abstractions/services.js'
import { PermissionError, ValidationError } from '../auth/AuthService.js'

/**
 * Backup policy.
 *
 * This is in M0 rather than in a later module for one reason, stated in
 * docs/DECISIONS.md §1: offline means the data exists nowhere else. From the
 * first real day of trading, the shop's books exist in exactly one file on
 * exactly one machine. Backup is not a feature to add once the app is useful —
 * it is the thing that makes the app safe to use at all.
 *
 * The physical work lives behind `BackupStore`, implemented in persistence,
 * so this policy is testable with no database and no filesystem.
 */

export interface BackupDependencies {
  readonly store: BackupStore
  readonly log: BackupLogRepository
  readonly audit: AuditRepository
  readonly clock: Clock
}

export interface RetentionPolicy {
  /** Automatic backups kept before the oldest is deleted. */
  readonly keepAutomatic: number
  /** Manual backups are never deleted automatically — a person asked for them. */
  readonly keepManual: 'all'
}

export const DEFAULT_RETENTION: RetentionPolicy = Object.freeze({
  keepAutomatic: 14,
  keepManual: 'all',
})

export class BackupService {
  constructor(
    private readonly deps: BackupDependencies,
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION,
  ) {}

  /**
   * Takes a backup and verifies it before recording it as good.
   *
   * The verification is the point. A backup nobody has opened is a hope, not a
   * backup — and the failure is silent until the day it is needed, which is
   * always the worst possible day. A snapshot that fails its integrity check is
   * still logged, with integrityOk false, so the failure is visible in the app
   * rather than being thrown away.
   */
  async backup(actor: PublicUser | null, kind: BackupKind = 'MANUAL'): Promise<BackupRecord> {
    // An automatic backup has no actor — the app takes it on a schedule.
    if (actor && kind === 'MANUAL' && !can(actor.role, 'canBackup')) {
      throw new PermissionError(
        `A ${actor.role.toLowerCase()} is not permitted to take a backup.`,
      )
    }

    const path = this.deps.store.pathForNewBackup(kind, this.deps.clock.now())
    const sizeBytes = await this.deps.store.snapshot(path)
    const integrityOk = await this.deps.store.verify(path)

    const record = this.deps.log.append({
      filePath: path,
      sizeBytes,
      kind,
      integrityOk,
      createdByUserId: actor?.id ?? null,
    })

    this.deps.audit.append({
      branchId: actor?.branchId ?? null,
      userId: actor?.id ?? null,
      action: 'BACKUP_CREATED',
      entity: 'backup_log',
      entityId: record.id,
      detail: JSON.stringify({ kind, sizeBytes, integrityOk }),
    })

    if (!integrityOk) {
      throw new BackupVerificationError(
        `The backup was written to ${path} but did not pass an integrity check. ` +
          `Do not rely on it. Check the disk for errors.`,
      )
    }

    if (kind === 'AUTO') await this.applyRetention()
    return record
  }

  /**
   * Restores from a backup file, replacing the shop's current data.
   *
   * ADMIN only, and it takes a PRE_RESTORE snapshot of the current data first.
   * If that snapshot fails, the restore does not happen — an operation that
   * destroys the only copy of the books must not proceed when the safety net
   * could not be put in place.
   */
  async restore(actor: PublicUser, filePath: string): Promise<void> {
    if (!can(actor.role, 'canRestore')) {
      throw new PermissionError(
        `Only an administrator can restore a backup. It replaces all current ` +
          `data, and that cannot be undone.`,
      )
    }

    if (!(await this.deps.store.verify(filePath))) {
      throw new ValidationError(
        `${filePath} is not a valid backup of this application. Nothing has been ` +
          `changed.`,
      )
    }

    // The safety net, before anything destructive happens.
    try {
      await this.backup(actor, 'PRE_RESTORE')
    } catch (cause) {
      throw new BackupVerificationError(
        `Could not take a safety backup of the current data, so the restore was ` +
          `cancelled and nothing has been changed. Free some disk space and try ` +
          `again.`,
        { cause },
      )
    }

    await this.deps.store.restore(filePath)

    // Written after the swap, so it lands in the restored database and the
    // restore is visible in the history the user is now looking at.
    //
    // userId is deliberately null, and branchId too. The restored database is a
    // different dataset: it may predate this user's account, or this branch, in
    // which case a foreign key to either would fail — and it would fail *after*
    // the destructive swap had already happened, leaving the app in a state
    // where the most important audit entry it will ever write is the one it
    // could not. A test caught exactly that. Who performed the restore is
    // preserved in detail, which has no referential constraint.
    this.deps.audit.append({
      branchId: null,
      userId: null,
      action: 'BACKUP_RESTORED',
      entity: 'backup_log',
      entityId: null,
      detail: JSON.stringify({
        restoredFrom: filePath,
        restoredByUserId: actor.id,
        restoredByUsername: actor.username,
      }),
    })
  }

  /** Newest first, for the settings screen. */
  history(limit = 20): BackupRecord[] {
    return this.deps.log.recent(limit)
  }

  /**
   * The answer to "when was the last good backup" — a question the app must be
   * able to answer without the user going to look in a folder.
   */
  lastGoodBackup(): BackupRecord | null {
    return this.deps.log.recent(50).find((r) => r.integrityOk) ?? null
  }

  /** Whole days since the last verified backup, or null if there has never been one. */
  daysSinceLastGoodBackup(): number | null {
    const last = this.lastGoodBackup()
    if (!last) return null
    const elapsed = this.deps.clock.now().getTime() - new Date(last.createdAt).getTime()
    return Math.floor(elapsed / 86_400_000)
  }

  /**
   * Deletes the oldest automatic backups beyond the retention count.
   *
   * Only files this application named. Anything else in the folder is left
   * alone — a user may well have put their own copies there, and deleting a
   * file the shop deliberately kept would be exactly the wrong failure for a
   * backup system to have.
   */
  private async applyRetention(): Promise<void> {
    const files = await this.deps.store.list()
    const automatic = files.filter((f) => f.path.endsWith('_auto.sqlite'))
    for (const stale of automatic.slice(this.retention.keepAutomatic)) {
      await this.deps.store.remove(stale.path)
    }
  }
}

/** The backup was written but could not be verified. Never silently swallowed. */
export class BackupVerificationError extends Error {
  override readonly name = 'BackupVerificationError'
}
