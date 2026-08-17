import { join } from 'node:path'
import {
  systemClock,
  toPublicUser,
  type Clock,
  type PublicUser,
  type User,
} from '@jewellery/domain'
import {
  AuthService,
  BackupService,
  CustomerService,
  InventoryService,
  PartyService,
  PieceService,
  PurchaseService,
  RateService,
  RetailSaleService,
  Settings,
  StockService,
  WholesaleService,
  createPasswordHasher,
  type PasswordHasher,
  type Repositories,
} from '@jewellery/application'
import {
  DatabaseHandle,
  SqliteBackupStore,
  createRepositories,
} from '@jewellery/persistence'
import { DEFAULT_ADMIN_USERNAME, seedFirstRun } from './seed.js'

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
  readonly parties: PartyService
  readonly wholesale: WholesaleService
  readonly purchase: PurchaseService
  readonly stock: StockService
  readonly inventory: InventoryService
  readonly pieces: PieceService
  readonly retail: RetailSaleService
  /**
   * Retail customers, deliberately NOT `parties`.
   *
   * A wholesale party has a standing gold and cash ledger because a wholesale
   * relationship IS a running balance. A retail customer usually walks in, pays
   * and leaves. Folding them together would fill the wholesale ledger with rows
   * that are not wholesale — see migration 005.
   */
  readonly retailCustomers: CustomerService
  readonly hasher: PasswordHasher
  readonly settings: Settings
  readonly clock: Clock
  /** Resolved once at startup; the app ships with a single branch. */
  readonly branchId: string
  /** True while the seeded admin password has not been changed. */
  readonly usingDefaultPassword: boolean
  /**
   * The fallback owner for an entry.
   *
   * No longer the source of the session — the person chosen on the "Who is
   * working?" card is (see `activeUsers`). It survives as the last resort for a
   * database with no usable active user, and it still throws rather than
   * returning null: an application that cannot name the person making an entry
   * must not make entries.
   */
  defaultUser(): PublicUser
  /**
   * Everyone who could be at the counter.
   *
   * One of them means the shell picks silently and shows nothing. More than one
   * means the shell asks, once, with no password — which is what puts a real
   * name on `created_by` in a shop with staff.
   */
  activeUsers(): User[]
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

  const parties = new PartyService({
    parties: repositories.parties,
    audit: repositories.audit,
    clock,
  })

  const settings = new Settings(repositories.settings)

  const wholesale = new WholesaleService({
    wholesale: repositories.wholesale,
    parties: repositories.parties,
    audit: repositories.audit,
    rates,
    settings,
    clock,
  })

  const purchase = new PurchaseService({
    purchases: repositories.purchases,
    parties: repositories.parties,
    audit: repositories.audit,
    rates,
    settings,
    clock,
  })

  const stock = new StockService({
    stockLedger: repositories.stockLedger,
    audit: repositories.audit,
    rates,
    clock,
  })

  const inventory = new InventoryService({
    items: repositories.items,
    itemCategories: repositories.itemCategories,
    locations: repositories.locations,
    parties: repositories.parties,
    audit: repositories.audit,
    clock,
  })

  const pieces = new PieceService({
    pieces: repositories.pieces,
    items: repositories.items,
    itemCategories: repositories.itemCategories,
    locations: repositories.locations,
    parties: repositories.parties,
    audit: repositories.audit,
    rates,
    clock,
  })

  const retail = new RetailSaleService({
    retailSales: repositories.retailSales,
    retailBills: repositories.retailBills,
    retailDrafts: repositories.retailDrafts,
    customers: repositories.customers,
    audit: repositories.audit,
    rates,
    settings,
    clock,
  })

  const retailCustomers = new CustomerService({
    customers: repositories.customers,
    audit: repositories.audit,
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
    parties,
    wholesale,
    purchase,
    stock,
    inventory,
    pieces,
    retail,
    retailCustomers,
    hasher,
    settings,
    clock,
    branchId: seed.branchId,
    usingDefaultPassword: seed.usingDefaultPassword,
    defaultUser: () => {
      const admin = repositories.users.findByUsername(DEFAULT_ADMIN_USERNAME)
      if (!admin) {
        throw new Error(
          'No administrator exists to attribute entries to. The first-run seed ' +
            'should have created one; the database may be from a failed restore.',
        )
      }
      return toPublicUser(admin)
    },
    activeUsers: () => repositories.users.list().filter((user) => user.isActive),
    dispose: () => handle.close(),
  }
}
