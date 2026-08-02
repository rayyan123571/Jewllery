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
