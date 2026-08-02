import {
  can,
  toPublicUser,
  type Clock,
  type PublicUser,
  type Role,
} from '@jewellery/domain'
import type { AuditRepository, UserRepository } from '../abstractions/repositories.js'
import type { PasswordHasher } from './PasswordHasher.js'

/**
 * Login and user administration for local accounts on the shop's PC.
 *
 * There is no account server and no email. That shapes two decisions:
 *
 *   - Password reset is an ADMIN action inside the app, not a link. An offline
 *     system has no way to send one.
 *   - There is no lockout after N failed attempts. On a shared shop PC a
 *     lockout is a denial of service against the shop itself — the salesman
 *     mistypes three times at 11am and the counter stops working. Failed
 *     attempts are written to the audit log instead, where they can be seen.
 */

export type LoginResult =
  | { readonly ok: true; readonly user: PublicUser }
  | { readonly ok: false; readonly reason: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' }

export interface AuthDependencies {
  readonly users: UserRepository
  readonly audit: AuditRepository
  readonly hasher: PasswordHasher
  readonly clock: Clock
}

export class AuthService {
  constructor(private readonly deps: AuthDependencies) {}

  login(username: string, password: string): LoginResult {
    const user = this.deps.users.findByUsername(username.trim())

    // Hash even when the user does not exist, so a missing username and a wrong
    // password take the same time. Otherwise the response time tells an
    // attacker which usernames are real.
    if (!user) {
      this.deps.hasher.verify(password, DUMMY_HASH)
      this.deps.audit.append({
        branchId: null,
        userId: null,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: null,
        detail: JSON.stringify({ username: username.trim(), reason: 'NO_SUCH_USER' }),
      })
      return { ok: false, reason: 'INVALID_CREDENTIALS' }
    }

    if (!this.deps.hasher.verify(password, user.passwordHash)) {
      this.deps.audit.append({
        branchId: user.branchId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        detail: JSON.stringify({ reason: 'WRONG_PASSWORD' }),
      })
      return { ok: false, reason: 'INVALID_CREDENTIALS' }
    }

    // Checked after the password, so a disabled account does not reveal itself
    // to someone who does not know the password.
    if (!user.isActive) {
      this.deps.audit.append({
        branchId: user.branchId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        detail: JSON.stringify({ reason: 'ACCOUNT_DISABLED' }),
      })
      return { ok: false, reason: 'ACCOUNT_DISABLED' }
    }

    // Transparent upgrade: if this hash was made with weaker parameters than
    // the current default, re-hash it now, while the plaintext is in hand.
    if (this.deps.hasher.needsRehash(user.passwordHash)) {
      this.deps.users.setPassword(user.id, this.deps.hasher.hash(password), user.mustChangePassword)
    }

    this.deps.users.recordLogin(user.id)
    this.deps.audit.append({
      branchId: user.branchId,
      userId: user.id,
      action: 'LOGIN',
      entity: 'users',
      entityId: user.id,
      detail: null,
    })

    const refreshed = this.deps.users.findById(user.id) ?? user
    return { ok: true, user: toPublicUser(refreshed) }
  }

  changeOwnPassword(userId: string, currentPassword: string, newPassword: string): void {
    const user = this.deps.users.findById(userId)
    if (!user) throw new Error('No such user')

    if (!this.deps.hasher.verify(currentPassword, user.passwordHash)) {
      throw new PermissionError('The current password is not correct')
    }
    assertPasswordAcceptable(newPassword)

    this.deps.users.setPassword(userId, this.deps.hasher.hash(newPassword), false)
    this.deps.audit.append({
      branchId: user.branchId,
      userId,
      action: 'PASSWORD_CHANGED',
      entity: 'users',
      entityId: userId,
      detail: null,
    })
  }

  /**
   * An ADMIN sets another user's password. The user must change it at next
   * login, so the admin does not keep working knowledge of it.
   */
  resetPassword(actor: PublicUser, targetUserId: string, newPassword: string): void {
    this.assertCan(actor, 'canManageUsers')
    assertPasswordAcceptable(newPassword)

    const target = this.deps.users.findById(targetUserId)
    if (!target) throw new Error('No such user')

    this.deps.users.setPassword(targetUserId, this.deps.hasher.hash(newPassword), true)
    this.deps.audit.append({
      branchId: target.branchId,
      userId: actor.id,
      action: 'PASSWORD_RESET',
      entity: 'users',
      entityId: targetUserId,
      detail: JSON.stringify({ targetUsername: target.username }),
    })
  }

  createUser(
    actor: PublicUser,
    details: {
      name: string
      username: string
      password: string
      role: Role
      branchId: string | null
    },
  ): PublicUser {
    this.assertCan(actor, 'canManageUsers')
    assertPasswordAcceptable(details.password)

    const username = details.username.trim()
    if (username.length === 0) throw new ValidationError('A username is required')
    if (this.deps.users.findByUsername(username)) {
      throw new ValidationError(`The username "${username}" is already taken`)
    }

    const created = this.deps.users.create({
      branchId: details.branchId,
      name: details.name.trim(),
      username,
      passwordHash: this.deps.hasher.hash(details.password),
      role: details.role,
      mustChangePassword: true,
    })

    this.deps.audit.append({
      branchId: created.branchId,
      userId: actor.id,
      action: 'USER_CREATED',
      entity: 'users',
      entityId: created.id,
      detail: JSON.stringify({ username: created.username, role: created.role }),
    })
    return toPublicUser(created)
  }

  setUserActive(actor: PublicUser, targetUserId: string, isActive: boolean): PublicUser {
    this.assertCan(actor, 'canManageUsers')

    const target = this.deps.users.findById(targetUserId)
    if (!target) throw new Error('No such user')

    // Locking every admin out of an offline app is unrecoverable — there is no
    // support server to let anyone back in. The last active admin cannot be
    // disabled, and cannot disable themselves.
    if (!isActive && target.role === 'ADMIN' && this.deps.users.countActiveAdmins() <= 1) {
      throw new ValidationError(
        'This is the only active administrator. Disabling it would lock everyone ' +
          'out of the application permanently — there is no server to recover from. ' +
          'Create another administrator first.',
      )
    }

    const updated = this.deps.users.setActive(targetUserId, isActive)
    this.deps.audit.append({
      branchId: updated.branchId,
      userId: actor.id,
      action: isActive ? 'USER_UPDATED' : 'USER_DEACTIVATED',
      entity: 'users',
      entityId: targetUserId,
      detail: JSON.stringify({ isActive }),
    })
    return toPublicUser(updated)
  }

  listUsers(actor: PublicUser): PublicUser[] {
    this.assertCan(actor, 'canManageUsers')
    return this.deps.users.list().map(toPublicUser)
  }

  private assertCan(actor: PublicUser, permission: Parameters<typeof can>[1]): void {
    if (!can(actor.role, permission)) {
      throw new PermissionError(
        `A ${actor.role.toLowerCase()} is not permitted to do this.`,
      )
    }
  }
}

/** Thrown when the actor's role does not allow the action. */
export class PermissionError extends Error {
  override readonly name = 'PermissionError'
}

/** Thrown when input is not acceptable. Message is shown to the user verbatim. */
export class ValidationError extends Error {
  override readonly name = 'ValidationError'
}

export const MINIMUM_PASSWORD_LENGTH = 6

function assertPasswordAcceptable(password: string): void {
  // Deliberately mild. This is a shop counter, not a bank: a rule demanding a
  // symbol and a capital produces a password on a sticky note attached to the
  // monitor, which is strictly worse than a short one the salesman remembers.
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new ValidationError(
      `A password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    )
  }
}

/**
 * A real hash of an unguessable value, used to spend the same time verifying a
 * password for a username that does not exist as for one that does.
 */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'JQm7VwqmB1nrDsPzGZ0hFQZQ0Nx6uPnQF8kZlZ5rWQxT6YgVJqPZ5N7yYRfMxJ2hLpKcE4vW8dQ1rTnBmA0aXg=='
