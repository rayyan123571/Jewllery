import type {
  Clock,
  Money,
  NewParty,
  Party,
  PublicUser,
  Weight,
} from '@jewellery/domain'
import type {
  AuditRepository,
  PartyRepository,
  PartySearchResult,
} from '../abstractions/repositories.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * Parties — the shops and karigars on the other side of a wholesale slip.
 *
 * The rules here are mostly about not letting two parties become confusable,
 * because the cost of posting a slip against the wrong party is a wrong balance
 * on two accounts at once, and it is not obvious from the paper.
 */

export interface PartyDependencies {
  readonly parties: PartyRepository
  readonly audit: AuditRepository
  readonly clock: Clock
}

export interface CreatePartyInput {
  readonly branchId: string
  readonly code: string
  readonly name: string
  readonly mobile: string | null
  readonly city: string | null
  /** Gold the party already owed when the shop started using this system. */
  readonly openingGold: Weight
  readonly openingCash: Money
  readonly notes: string | null
}

export class PartyService {
  constructor(private readonly deps: PartyDependencies) {}

  /**
   * Codes are normalised to upper case with surrounding whitespace removed.
   *
   * The index is case-insensitive, so "chj" and "CHJ" already cannot coexist;
   * normalising on the way in means the *stored* value is predictable too, and
   * a printed slip does not show a code in whatever case somebody happened to
   * type it.
   */
  static normaliseCode(code: string): string {
    return code.trim().toUpperCase()
  }

  create(actor: PublicUser, input: CreatePartyInput): Party {
    const code = PartyService.normaliseCode(input.code)
    const name = input.name.trim()

    if (code.length === 0) throw new ValidationError('A party code is required.')
    if (name.length === 0) throw new ValidationError('A party name is required.')

    if (this.deps.parties.findByCode(input.branchId, code)) {
      throw new ValidationError(
        `The code "${code}" is already used by another party. Codes must be ` +
          `unique so a slip can never be posted against the wrong account.`,
      )
    }

    const party: NewParty = {
      branchId: input.branchId,
      code,
      name,
      mobile: emptyToNull(input.mobile),
      city: emptyToNull(input.city),
      openingGold: input.openingGold,
      openingCash: input.openingCash,
      notes: emptyToNull(input.notes),
    }

    const created = this.deps.parties.create(party, actor.id)

    this.deps.audit.append({
      branchId: created.branchId,
      userId: actor.id,
      action: 'PARTY_CREATED',
      entity: 'parties',
      entityId: created.id,
      detail: JSON.stringify({
        code: created.code,
        name: created.name,
        // Opening balances are recorded in the audit trail because they are the
        // one balance nobody can derive from a transaction — if they are ever
        // questioned, this is the only record of what was entered and by whom.
        openingGoldMg: created.openingGold.milligrams,
        openingCashPaisa: created.openingCash.paisa,
      }),
    })

    return created
  }

  /** Type-ahead for the selector. An empty query returns nothing, not everything. */
  search(branchId: string, query: string, limit = 20): PartySearchResult[] {
    const trimmed = query.trim()
    if (trimmed.length === 0) return []
    return this.deps.parties.search(branchId, trimmed, limit)
  }

  findById(id: string): Party | null {
    return this.deps.parties.findById(id)
  }

  findByCode(branchId: string, code: string): Party | null {
    return this.deps.parties.findByCode(branchId, PartyService.normaliseCode(code))
  }

  list(branchId: string, includeInactive = false): Party[] {
    return this.deps.parties.list(branchId, includeInactive)
  }

  update(
    actor: PublicUser,
    id: string,
    changes: {
      name: string
      mobile: string | null
      city: string | null
      notes: string | null
    },
  ): Party {
    const existing = this.deps.parties.findById(id)
    if (!existing) throw new ValidationError('No such party.')

    const name = changes.name.trim()
    if (name.length === 0) throw new ValidationError('A party name is required.')

    // The code is deliberately not editable, and neither are the opening
    // balances. Both appear on slips that have already been printed and posted;
    // changing either would silently rewrite what those slips meant. Correcting
    // an opening balance is an adjusting entry in the ledger, not an edit here.
    const updated = this.deps.parties.update(id, {
      name,
      mobile: emptyToNull(changes.mobile),
      city: emptyToNull(changes.city),
      notes: emptyToNull(changes.notes),
    })

    this.deps.audit.append({
      branchId: updated.branchId,
      userId: actor.id,
      action: 'PARTY_UPDATED',
      entity: 'parties',
      entityId: id,
      detail: JSON.stringify({ from: existing.name, to: updated.name }),
    })
    return updated
  }

  /**
   * Deactivating hides a party from the selector without touching their ledger.
   *
   * It is not a delete, and there is no delete: a party with history cannot be
   * removed without removing the transactions that reference them, which would
   * put the books out of balance. Their history stays fully readable.
   */
  setActive(actor: PublicUser, id: string, isActive: boolean): Party {
    const updated = this.deps.parties.setActive(id, isActive)
    this.deps.audit.append({
      branchId: updated.branchId,
      userId: actor.id,
      action: isActive ? 'PARTY_UPDATED' : 'PARTY_DEACTIVATED',
      entity: 'parties',
      entityId: id,
      detail: JSON.stringify({ isActive }),
    })
    return updated
  }
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
