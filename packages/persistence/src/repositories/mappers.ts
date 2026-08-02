import {
  Money,
  toIsoDate,
  toIsoTimestamp,
  parsePurity,
  parseRole,
  type Branch,
  type GoldRate,
  type ShopProfile,
  type User,
  type AuditEntry,
  type AuditAction,
} from '@jewellery/domain'

/**
 * Row shapes and the conversion between them and domain objects.
 *
 * This is the only place integers become Money and Weight. SQLite stores paisa
 * and milligrams; the domain gets value objects. Nothing in between ever sees a
 * decimal, so there is no point at which a float could be introduced.
 *
 * SQLite has no boolean type, so 0/1 integers become real booleans here rather
 * than leaking `0` into a `if (user.isActive)` somewhere and working by accident.
 */

export function toBool(value: number): boolean {
  return value === 1
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0
}

export interface BranchRow {
  id: string
  name: string
  address: string | null
  is_default: number
  is_active: number
  created_at: string
}

export function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    isDefault: toBool(row.is_default),
    isActive: toBool(row.is_active),
    createdAt: toIsoTimestamp(row.created_at),
  }
}

export interface ShopRow {
  id: string
  name: string
  tagline: string | null
  owner_name: string
  second_owner_name: string | null
  phone1: string
  phone2: string | null
  phone3: string | null
  address: string
  logo_path: string | null
  updated_at: string
}

export function toShopProfile(row: ShopRow): ShopProfile {
  return {
    name: row.name,
    tagline: row.tagline,
    ownerName: row.owner_name,
    secondOwnerName: row.second_owner_name,
    phone1: row.phone1,
    phone2: row.phone2,
    phone3: row.phone3,
    address: row.address,
    logoPath: row.logo_path,
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

export interface UserRow {
  id: string
  branch_id: string | null
  name: string
  username: string
  password_hash: string
  role: string
  is_active: number
  must_change_password: number
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    username: row.username,
    passwordHash: row.password_hash,
    role: parseRole(row.role),
    isActive: toBool(row.is_active),
    mustChangePassword: toBool(row.must_change_password),
    lastLoginAt: row.last_login_at === null ? null : toIsoTimestamp(row.last_login_at),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

export interface GoldRateRow {
  id: string
  branch_id: string
  purity: string
  rate_per_tola: number
  effective_from: string
  created_by_user_id: string
  created_at: string
  note: string | null
}

export function toGoldRate(row: GoldRateRow): GoldRate {
  return {
    id: row.id,
    branchId: row.branch_id,
    purity: parsePurity(row.purity),
    // The one conversion that matters: an integer count of paisa becomes Money.
    // Per TOLA, exactly as entered — never divided down to per-gram here.
    ratePerTola: Money.fromPaisa(row.rate_per_tola),
    effectiveFrom: toIsoDate(row.effective_from),
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
    note: row.note,
  }
}

export interface AuditRow {
  id: string
  branch_id: string | null
  user_id: string | null
  action: string
  entity: string
  entity_id: string | null
  detail: string | null
  created_at: string
}

export function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    branchId: row.branch_id,
    userId: row.user_id,
    // Not validated against the union: the audit log is append-only history,
    // and a row written by an older version with an action this build does not
    // know about must still be readable rather than throwing on display.
    action: row.action as AuditAction,
    entity: row.entity,
    entityId: row.entity_id,
    detail: row.detail,
    createdAt: toIsoTimestamp(row.created_at),
  }
}
