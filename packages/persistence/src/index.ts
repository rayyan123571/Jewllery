// The only package that knows SQL exists.

export {
  closeDatabase,
  inTransaction,
  openDatabase,
  openInMemoryDatabase,
  type OpenOptions,
  type SqliteDatabase,
} from './Database.js'
export { currentVersion, latestVersion, type Migration } from './migrations/runner.js'
export { DatabaseHandle } from './DatabaseHandle.js'
export { createRepositories } from './repositories/index.js'
export { SqliteBackupStore } from './backup/SqliteBackupStore.js'
export { SqliteWholesaleRepository } from './repositories/wholesale.js'
export { SqlitePurchaseRepository } from './repositories/purchase.js'
export { SqliteStockLedgerRepository } from './repositories/stock.js'
