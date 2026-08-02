/**
 * Who can do what.
 *
 * These are local accounts on the shop's own PC — there is no account server,
 * no email, and no password reset by mail. An offline system cannot send a
 * reset link, so an ADMIN resets another user's password from inside the app.
 * That is a deliberate consequence of being offline, not a missing feature.
 */
export const ROLES = ['ADMIN', 'MANAGER', 'SALESMAN', 'ACCOUNTANT'] as const

export type Role = (typeof ROLES)[number]

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

export function parseRole(value: string): Role {
  if (!isRole(value)) {
    throw new TypeError(
      `"${value}" is not a recognised role. Expected one of: ${ROLES.join(', ')}.`,
    )
  }
  return value
}

/**
 * The permissions each role carries.
 *
 * Deliberately coarse for M0. The distinctions that matter to a shop are: who
 * may change the gold rate (it revalues everything), who may reverse a posted
 * transaction, and who may manage users and restore a backup. Finer-grained
 * rules belong with the modules that need them, not here.
 */
export interface Permissions {
  /** Change the gold rate. It revalues every open position, so it is restricted. */
  readonly canSetGoldRate: boolean
  /** Post a reversing entry. Posted transactions are never edited (DECISIONS §6). */
  readonly canReverseTransactions: boolean
  /** Create, disable and reset the password of other users. */
  readonly canManageUsers: boolean
  /** Edit the shop profile that appears on every printed slip. */
  readonly canEditShopProfile: boolean
  /** Take a backup on demand. */
  readonly canBackup: boolean
  /** Restore a backup — destructive, and therefore ADMIN only. */
  readonly canRestore: boolean
  /** Read the audit log. */
  readonly canViewAuditLog: boolean
}

const PERMISSIONS: Readonly<Record<Role, Permissions>> = Object.freeze({
  ADMIN: {
    canSetGoldRate: true,
    canReverseTransactions: true,
    canManageUsers: true,
    canEditShopProfile: true,
    canBackup: true,
    canRestore: true,
    canViewAuditLog: true,
  },
  MANAGER: {
    canSetGoldRate: true,
    canReverseTransactions: true,
    canManageUsers: false,
    canEditShopProfile: false,
    canBackup: true,
    canRestore: false,
    canViewAuditLog: true,
  },
  ACCOUNTANT: {
    canSetGoldRate: false,
    canReverseTransactions: true,
    canManageUsers: false,
    canEditShopProfile: false,
    canBackup: true,
    canRestore: false,
    canViewAuditLog: true,
  },
  SALESMAN: {
    canSetGoldRate: false,
    canReverseTransactions: false,
    canManageUsers: false,
    canEditShopProfile: false,
    canBackup: false,
    canRestore: false,
    canViewAuditLog: false,
  },
})

export function permissionsFor(role: Role): Permissions {
  return PERMISSIONS[role]
}

export function can(role: Role, permission: keyof Permissions): boolean {
  return PERMISSIONS[role][permission]
}
