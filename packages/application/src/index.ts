// Business calculations. Depends on domain only — no SQL, no Electron, no
// React, so every calculation here is testable with no database and no window.

export type {
  AuditRepository,
  BackupKind,
  BackupLogRepository,
  BackupRecord,
  BranchRepository,
  GoldRateRepository,
  NewUser,
  Repositories,
  SettingsRepository,
  ShopRepository,
  UserRepository,
} from './abstractions/repositories.js'
export type { BackupStore, IdGenerator } from './abstractions/services.js'

export {
  AuthService,
  MINIMUM_PASSWORD_LENGTH,
  PermissionError,
  ValidationError,
  type AuthDependencies,
  type LoginResult,
} from './auth/AuthService.js'
export {
  DEFAULT_PARAMETERS,
  createPasswordHasher,
  type HashParameters,
  type PasswordHasher,
} from './auth/PasswordHasher.js'

export { NoRateError, RateService, type RateDependencies } from './rates/RateService.js'
