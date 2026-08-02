import {
  Money,
  toIsoDate,
  toIsoTimestamp,
  type AuditEntry,
  type Clock,
  type GoldRate,
  type IsoDate,
  type NewAuditEntry,
  type NewGoldRate,
  type Purity,
  type NewParty,
  type Party,
  type Role,
  type User,
  type WholesaleEntry,
  type WholesaleEntryWithLines,
} from '@jewellery/domain'
import type {
  AuditRepository,
  GoldRateRepository,
  NewUser,
  NewWholesaleEntry,
  PartyRepository,
  PartySearchResult,
  SettingsRepository,
  UserRepository,
  WholesaleRepository,
} from '../abstractions/repositories.js'

/**
 * In-memory repositories.
 *
 * These exist so that every calculation can be tested with no database and no
 * window (docs/DECISIONS.md §9). If a service could only be exercised by
 * starting SQLite, the layering would not be doing its job.
 *
 * They are deliberately simple and slow — correctness over speed. Where
 * behaviour must match the real thing, it is noted.
 */

export function counterIds(prefix = 'id'): { next(): string } {
  let n = 0
  return { next: () => `${prefix}-${++n}` }
}

export class FakeUserRepository implements UserRepository {
  private readonly rows = new Map<string, User>()
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): User | null {
    return this.rows.get(id) ?? null
  }

  /** Case-insensitive, matching the real unique index on the column. */
  findByUsername(username: string): User | null {
    const target = username.toLowerCase()
    for (const user of this.rows.values()) {
      if (user.username.toLowerCase() === target) return user
    }
    return null
  }

  list(): User[] {
    return [...this.rows.values()]
  }

  countActiveAdmins(): number {
    return this.list().filter((u) => u.role === 'ADMIN' && u.isActive).length
  }

  create(user: NewUser): User {
    const now = toIsoTimestamp(this.clock.now())
    const created: User = {
      id: `user-${++this.sequence}`,
      branchId: user.branchId,
      name: user.name,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      isActive: true,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(created.id, created)
    return created
  }

  updateProfile(
    id: string,
    changes: { name: string; role: Role; branchId: string | null },
  ): User {
    return this.mutate(id, (u) => ({ ...u, ...changes }))
  }

  setPassword(id: string, passwordHash: string, mustChangePassword: boolean): User {
    return this.mutate(id, (u) => ({ ...u, passwordHash, mustChangePassword }))
  }

  setActive(id: string, isActive: boolean): User {
    return this.mutate(id, (u) => ({ ...u, isActive }))
  }

  recordLogin(id: string): void {
    this.mutate(id, (u) => ({ ...u, lastLoginAt: toIsoTimestamp(this.clock.now()) }))
  }

  private mutate(id: string, change: (user: User) => User): User {
    const existing = this.rows.get(id)
    if (!existing) throw new Error(`No such user: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows.set(id, updated)
    return updated
  }
}

export class FakeAuditRepository implements AuditRepository {
  readonly entries: AuditEntry[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  append(entry: NewAuditEntry): AuditEntry {
    const created: AuditEntry = {
      ...entry,
      id: `audit-${++this.sequence}`,
      createdAt: toIsoTimestamp(this.clock.now()),
    }
    this.entries.push(created)
    return created
  }

  recent(limit: number): AuditEntry[] {
    return [...this.entries].reverse().slice(0, limit)
  }

  forEntity(entity: string, entityId: string): AuditEntry[] {
    return this.entries.filter((e) => e.entity === entity && e.entityId === entityId)
  }

  /** Test helper — the actions recorded, in order. */
  actions(): string[] {
    return this.entries.map((e) => e.action)
  }
}

export class FakeGoldRateRepository implements GoldRateRepository {
  readonly rows: GoldRate[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  /**
   * The latest rate whose effectiveFrom is on or before `on` — not the newest
   * row. Ties on the same day are broken by insertion order, so a correction
   * recorded later the same day wins, matching the real index's
   * `ORDER BY effective_from DESC, created_at DESC`.
   */
  findEffective(branchId: string, purity: Purity, on: IsoDate): GoldRate | null {
    const candidates = this.rows
      .filter((r) => r.branchId === branchId && r.purity === purity && r.effectiveFrom <= on)
      .sort((a, b) =>
        a.effectiveFrom === b.effectiveFrom
          ? a.createdAt.localeCompare(b.createdAt)
          : a.effectiveFrom.localeCompare(b.effectiveFrom),
      )
    return candidates.at(-1) ?? null
  }

  findAllEffective(branchId: string, on: IsoDate): Partial<Record<Purity, GoldRate>> {
    const result: Partial<Record<Purity, GoldRate>> = {}
    for (const purity of new Set(this.rows.map((r) => r.purity))) {
      const rate = this.findEffective(branchId, purity, on)
      if (rate) result[purity] = rate
    }
    return result
  }

  history(branchId: string, purity: Purity, limit: number): GoldRate[] {
    return this.rows
      .filter((r) => r.branchId === branchId && r.purity === purity)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
      .slice(0, limit)
  }

  record(rate: NewGoldRate): GoldRate {
    // Distinct, increasing createdAt values even under a frozen clock, so
    // same-day ordering is deterministic in tests.
    const stamp = new Date(this.clock.now().getTime() + this.sequence)
    const created: GoldRate = {
      ...rate,
      id: `rate-${++this.sequence}`,
      createdAt: toIsoTimestamp(stamp),
    }
    this.rows.push(created)
    return created
  }

  /** Test helper — seed a rate without going through the service. */
  seed(
    branchId: string,
    purity: Purity,
    rupeesPerTola: number,
    effectiveFrom: string,
  ): GoldRate {
    return this.record({
      branchId,
      purity,
      ratePerTola: Money.fromRupees(rupeesPerTola),
      effectiveFrom: toIsoDate(effectiveFrom),
      createdByUserId: 'seed',
      note: null,
    })
  }
}

export class FakePartyRepository implements PartyRepository {
  private readonly rows = new Map<string, Party>()
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  findById(id: string): Party | null {
    return this.rows.get(id) ?? null
  }

  findByCode(branchId: string, code: string): Party | null {
    const target = code.toLowerCase()
    for (const p of this.rows.values()) {
      if (p.branchId === branchId && p.code.toLowerCase() === target) return p
    }
    return null
  }

  /** Prefix matches first, mirroring the real index's ORDER BY. */
  search(branchId: string, query: string, limit: number): PartySearchResult[] {
    const q = query.toLowerCase()
    return [...this.rows.values()]
      .filter((p) => p.branchId === branchId && p.isActive)
      .filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => rank(a, q) - rank(b, q) || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((p) => ({ id: p.id, code: p.code, name: p.name, mobile: p.mobile, city: p.city }))
  }

  list(branchId: string, includeInactive: boolean): Party[] {
    return [...this.rows.values()]
      .filter((p) => p.branchId === branchId && (includeInactive || p.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  create(party: NewParty): Party {
    const now = toIsoTimestamp(this.clock.now())
    const created: Party = {
      ...party,
      id: `party-${++this.sequence}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(created.id, created)
    return created
  }

  update(
    id: string,
    changes: { name: string; mobile: string | null; city: string | null; notes: string | null },
  ): Party {
    return this.mutate(id, (p) => ({ ...p, ...changes }))
  }

  setActive(id: string, isActive: boolean): Party {
    return this.mutate(id, (p) => ({ ...p, isActive }))
  }

  private mutate(id: string, change: (p: Party) => Party): Party {
    const existing = this.rows.get(id)
    if (!existing) throw new Error(`No such party: ${id}`)
    const updated = { ...change(existing), updatedAt: toIsoTimestamp(this.clock.now()) }
    this.rows.set(id, updated)
    return updated
  }
}

function rank(p: Party, q: string): number {
  if (p.code.toLowerCase().startsWith(q)) return 0
  if (p.name.toLowerCase().startsWith(q)) return 1
  return 2
}

export class FakeSettingsRepository implements SettingsRepository {
  private readonly rows = new Map<string, string>()
  get(key: string): string | null {
    return this.rows.get(key) ?? null
  }
  set(key: string, value: string): void {
    this.rows.set(key, value)
  }
  all(): Record<string, string> {
    return Object.fromEntries(this.rows)
  }
}

/** In-memory wholesale ledger. Same delta-summing rule as the SQLite one. */
export class FakeWholesaleRepository implements WholesaleRepository {
  readonly entries: WholesaleEntryWithLines[] = []
  private sequence = 0

  constructor(private readonly clock: Clock) {}

  post(entry: NewWholesaleEntry): WholesaleEntryWithLines {
    if (this.entries.some((e) => e.entry.invoiceNo === entry.invoiceNo)) {
      throw new Error(`Duplicate invoice number: ${entry.invoiceNo}`)
    }
    const id = `entry-${++this.sequence}`
    const stored: WholesaleEntryWithLines = {
      entry: {
        ...entry,
        id,
        reversedByEntryId: null,
        createdAt: toIsoTimestamp(this.clock.now()),
      },
      lines: entry.lines.map((line, index) => ({ ...line, id: `line-${id}-${index}` })),
    }
    this.entries.push(stored)
    return stored
  }

  findById(id: string): WholesaleEntryWithLines | null {
    return this.entries.find((e) => e.entry.id === id) ?? null
  }

  findByInvoiceNo(branchId: string, invoiceNo: string): WholesaleEntryWithLines | null {
    return (
      this.entries.find(
        (e) =>
          e.entry.branchId === branchId &&
          e.entry.invoiceNo.toLowerCase() === invoiceNo.toLowerCase(),
      ) ?? null
    )
  }

  nextInvoiceNo(branchId: string, prefix: string): string {
    const numbers = this.entries
      .filter((e) => e.entry.branchId === branchId && e.entry.invoiceNo.startsWith(prefix))
      .map((e) => Number(/(\d+)\s*$/.exec(e.entry.invoiceNo)?.[1] ?? 0))
    return `${prefix}${numbers.length === 0 ? 10_001 : Math.max(...numbers) + 1}`
  }

  balances(partyId: string): { goldMg: number; cashPaisa: number } {
    const mine = this.entries.filter((e) => e.entry.partyId === partyId)
    return {
      goldMg: mine.reduce((sum, e) => sum + e.entry.goldDelta.milligrams, 0),
      cashPaisa: mine.reduce((sum, e) => sum + e.entry.cashDelta.paisa, 0),
    }
  }

  listForParty(partyId: string, limit: number): WholesaleEntry[] {
    return this.entries
      .filter((e) => e.entry.partyId === partyId)
      .map((e) => e.entry)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id))
      .slice(0, limit)
  }

  listRecent(branchId: string, limit: number): WholesaleEntry[] {
    return this.entries
      .filter((e) => e.entry.branchId === branchId)
      .map((e) => e.entry)
      .reverse()
      .slice(0, limit)
  }

  markReversed(originalId: string, reversalId: string): void {
    const index = this.entries.findIndex((e) => e.entry.id === originalId)
    const found = this.entries[index]
    if (!found) throw new Error(`No such entry: ${originalId}`)
    this.entries[index] = {
      ...found,
      entry: { ...found.entry, reversedByEntryId: reversalId },
    }
  }
}
