import { join } from 'node:path'
import { systemClock, type Clock } from '@jewellery/domain'
import {
  AuthService,
  BackupService,
  RateService,
  createPasswordHasher,
  type PasswordHasher,
  type Repositories,
} from '@jewellery/application'
import {
  DatabaseHandle,
  SqliteBackupStore,
  createRepositories,
} from '@jewellery/persistence'
import { seedFirstRun } from './seed.js'

/**
 * The composition root.
 *
 * This is the ONE place allowed to see every layer, because wiring them
 * together is its entire job. It is also the only file in the desktop package
 * that imports persistence — the renderer cannot, by lint and by the sandbox.
 *
 * Everything below is constructed once, at startup, and handed down. No service
 * reaches out for a dependency; they are all injected, which is what lets the
 * same services run in tests against in-memory fakes.
 */

export interface Container {
  readonly handle: DatabaseHandle
  readonly repositories: Repositories
  readonly auth: AuthService
  readonly rates: RateService
  readonly backups: BackupService
  readonly hasher: PasswordHasher
  readonly clock: Clock
  /** Resolved once at startup; the app ships with a single branch. */
  readonly branchId: string
  /** True while the seeded admin password has not been changed. */
  readonly usingDefaultPassword: boolean
  dispose(): void
}

export interface ContainerOptions {
  /** Directory holding the database and the backups folder. */
  readonly dataDirectory: string
  readonly clock?: Clock
}

export function createContainer(options: ContainerOptions): Container {
  const clock = options.clock ?? systemClock

  // The database file lives in the app's own data directory. It is NEVER placed
  // on a Windows file share for several PCs to open — SQLite's locking over SMB
  // is unreliable and that is the most common way to corrupt one. See
  // docs/DECISIONS.md §5.
  const handle = new DatabaseHandle(join(options.dataDirectory, 'shop.sqlite'))
  const repositories = createRepositories(handle, clock)
  const hasher = createPasswordHasher()

  const auth = new AuthService({
    users: repositories.users,
    audit: repositories.audit,
    hasher,
    clock,
  })

  const rates = new RateService({
    goldRates: repositories.goldRates,
    audit: repositories.audit,
    clock,
  })

  const backups = new BackupService({
    store: new SqliteBackupStore(handle, join(options.dataDirectory, 'backups')),
    log: repositories.backupLog,
    audit: repositories.audit,
    clock,
  })

  // Runs on every startup, including after a restore. Idempotent — it does
  // nothing when a branch already exists. It cannot be deferred to a wizard,
  // because without an administrator there is nobody to log in as and no
  // support server to create one from.
  const seed = seedFirstRun(repositories, hasher, clock)

  return {
    handle,
    repositories,
    auth,
    rates,
    backups,
    hasher,
    clock,
    branchId: seed.branchId,
    usingDefaultPassword: seed.usingDefaultPassword,
    dispose: () => handle.close(),
  }
}
