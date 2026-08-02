import { randomUUID } from 'node:crypto'
import type { Clock } from '@jewellery/domain'
import type { PasswordHasher, Repositories } from '@jewellery/application'

/**
 * First run.
 *
 * Creates the minimum an offline app needs to be usable at all: one branch and
 * one administrator. Without them there is nobody to log in as, and no support
 * server to create an account from — so this cannot be deferred to a setup
 * wizard that a user might skip.
 *
 * Idempotent. Running it against a database that already has a branch does
 * nothing, so it is safe to call on every startup, including after a restore.
 */

export const DEFAULT_ADMIN_USERNAME = 'admin'

/**
 * The password the shop must change immediately.
 *
 * `mustChangePassword` is set, so the first login forces a change. A known
 * default is still a real risk on a machine someone else can reach, which is why
 * the first-run screen says so plainly rather than burying it.
 */
export const DEFAULT_ADMIN_PASSWORD = 'admin'

export interface SeedResult {
  readonly seeded: boolean
  readonly branchId: string
  /** True when the default password is still in place. Drives the warning. */
  readonly usingDefaultPassword: boolean
}

export function seedFirstRun(
  repositories: Repositories,
  hasher: PasswordHasher,
  _clock: Clock,
): SeedResult {
  const existing = repositories.branches.findDefault()
  if (existing) {
    const admin = repositories.users.findByUsername(DEFAULT_ADMIN_USERNAME)
    return {
      seeded: false,
      branchId: existing.id,
      usingDefaultPassword: admin?.mustChangePassword === true,
    }
  }

  const branch = repositories.branches.create({
    id: randomUUID(),
    name: 'Main Branch',
    address: null,
    isDefault: true,
    isActive: true,
  })

  repositories.users.create({
    branchId: branch.id,
    name: 'Administrator',
    username: DEFAULT_ADMIN_USERNAME,
    passwordHash: hasher.hash(DEFAULT_ADMIN_PASSWORD),
    role: 'ADMIN',
    mustChangePassword: true,
  })

  // Deliberately no shop profile and no gold rates.
  //
  // A seeded shop name would print on every slip until someone noticed, and a
  // seeded gold rate is worse: it would silently value real gold at a made-up
  // price. A missing rate is an explicit error the user must resolve (see
  // RateService.requireRateOn); a wrong one is invisible.

  repositories.audit.append({
    branchId: branch.id,
    userId: null,
    action: 'BRANCH_CREATED',
    entity: 'branches',
    entityId: branch.id,
    detail: JSON.stringify({ reason: 'first run' }),
  })

  return { seeded: true, branchId: branch.id, usingDefaultPassword: true }
}
