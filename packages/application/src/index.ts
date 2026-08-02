// Business calculations. Depends on domain only — no SQL, no Electron, no
// React, so every calculation here is testable with no database and no window.

export {
  PartyService,
  type CreatePartyInput,
  type PartyDependencies,
} from './parties/PartyService.js'

export type {
  AuditRepository,
  BackupKind,
  BackupLogRepository,
  BackupRecord,
  BranchRepository,
  GoldRateRepository,
  NewUser,
  Repositories,
  PartyRepository,
  PartySearchResult,
  NewWholesaleEntry,
  NewWholesaleLine,
  SettingsRepository,
  ShopRepository,
  UserRepository,
  WholesaleRepository,
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
export {
  DEFAULT_OVER_RETURN_TOLERANCE_MG,
  SETTING_KEYS,
  SUGGESTED_KATT_MAX_MILLI_RATTI,
  SUGGESTED_KATT_MIN_MILLI_RATTI,
  Settings,
} from './settings/keys.js'
export {
  OverReturnRequiresConfirmationError,
  WHOLESALE_RATE_PURITY,
  WholesaleService,
  type IssueLineInput,
  type KattWarning,
  type PostIssueInput,
  type PostedResult,
  type SettleInput,
  type WholesaleDependencies,
} from './wholesale/WholesaleService.js'
export {
  BackupService,
  BackupVerificationError,
  DEFAULT_RETENTION,
  type BackupDependencies,
  type RetentionPolicy,
} from './backup/BackupService.js'
