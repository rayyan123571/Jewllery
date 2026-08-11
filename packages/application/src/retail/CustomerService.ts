import { Money, Weight, type Customer, type PublicUser } from '@jewellery/domain'
import type {
  AuditRepository,
  CustomerRepository,
  CustomerSearchResult,
} from '../abstractions/repositories.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * Retail customers, and the walk-in path.
 *
 * The distinction this service exists to hold: an ACCOUNT customer has a
 * standing record and can carry a balance; a WALK-IN has a row so the invoice
 * has a name to print, and nothing else. Selling on credit to a walk-in is
 * refused by RetailSaleService for exactly that reason — there is no ledger for
 * the balance to live on.
 *
 * A walk-in is still a row rather than a free-text name on the sale, because
 * the customer's mobile is how a lost receipt gets found again, and because a
 * walk-in who comes back twice should be findable the third time.
 */

export interface CustomerDependencies {
  readonly customers: CustomerRepository
  readonly audit: AuditRepository
}

export interface CreateCustomerInput {
  readonly name: string
  readonly mobile: string | null
  readonly address: string | null
  readonly city: string | null
  readonly cnic: string | null
  readonly openingGold: Weight
  readonly openingCash: Money
}

export class CustomerService {
  constructor(private readonly deps: CustomerDependencies) {}

  /**
   * Prefix on name or code, anywhere in the mobile.
   *
   * An empty term returns nothing rather than everything: a type-ahead that
   * dumps the whole customer list on focus is slower to use than one that waits
   * for a letter.
   */
  search(term: string, limit = 12): CustomerSearchResult[] {
    return this.deps.customers.search(term, limit)
  }

  findById(id: string): Customer | null {
    return this.deps.customers.findById(id)
  }

  create(actor: PublicUser, input: CreateCustomerInput): Customer {
    return this.write(actor, input, false)
  }

  /**
   * A walk-in: a name, optionally a mobile, and no account.
   *
   * Deliberately cannot carry an opening balance. An opening balance is a claim
   * that money or metal was already owed, and a customer with no account has no
   * history for that claim to sit in.
   */
  createWalkIn(actor: PublicUser, name: string, mobile: string | null): Customer {
    return this.write(
      actor,
      {
        name,
        mobile,
        address: null,
        city: null,
        cnic: null,
        openingGold: Weight.ZERO,
        openingCash: Money.ZERO,
      },
      true,
    )
  }

  private write(actor: PublicUser, input: CreateCustomerInput, isWalkIn: boolean): Customer {
    const name = input.name.trim()
    if (name.length === 0) {
      throw new ValidationError('A customer needs a name — it prints on the invoice.')
    }

    const mobile = input.mobile?.trim() || null
    if (mobile !== null && !/^[0-9+\-\s]{7,20}$/.test(mobile)) {
      throw new ValidationError(
        `"${mobile}" does not look like a phone number. Leave it blank if you do not have one.`,
      )
    }

    const code = this.deps.customers.nextCode(isWalkIn ? 'W-' : 'C-')
    const created = this.deps.customers.create(
      {
        code,
        name,
        mobile,
        address: input.address?.trim() || null,
        city: input.city?.trim() || null,
        cnic: input.cnic?.trim() || null,
        isWalkIn,
        openingGold: input.openingGold,
        openingCash: input.openingCash,
      },
      actor.id,
    )

    this.deps.audit.append({
      branchId: actor.branchId,
      userId: actor.id,
      action: 'PARTY_CREATED',
      entity: 'customers',
      entityId: created.id,
      detail: JSON.stringify({ code, name, isWalkIn }),
    })

    return created
  }
}
