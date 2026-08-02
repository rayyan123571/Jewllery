import type { IsoTimestamp } from '../common/time.js'
import type { Role } from './Role.js'

/**
 * A local user account on the shop's PC.
 *
 * `passwordHash` never leaves the main process. The renderer receives
 * `PublicUser`, which has no credential material on it at all — so a hash
 * cannot leak into a React devtools inspection or a window title.
 */
export interface User {
  readonly id: string
  readonly branchId: string | null
  readonly name: string
  /** Unique login name. Not an email — an offline shop has no mail server. */
  readonly username: string
  readonly passwordHash: string
  readonly role: Role
  readonly isActive: boolean
  /** Forces a password change at next login, after an admin reset. */
  readonly mustChangePassword: boolean
  readonly lastLoginAt: IsoTimestamp | null
  readonly createdAt: IsoTimestamp
  readonly updatedAt: IsoTimestamp
}

/** What crosses the IPC boundary. Deliberately has no hash field to omit. */
export interface PublicUser {
  readonly id: string
  readonly branchId: string | null
  readonly name: string
  readonly username: string
  readonly role: Role
  readonly isActive: boolean
  readonly mustChangePassword: boolean
  readonly lastLoginAt: IsoTimestamp | null
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    branchId: user.branchId,
    name: user.name,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  }
}
