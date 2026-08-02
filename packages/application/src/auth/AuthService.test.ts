import { fixedClock, type PublicUser } from '@jewellery/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeAuditRepository, FakeUserRepository } from '../testing/fakes.js'
import { AuthService, PermissionError, ValidationError } from './AuthService.js'
import { createPasswordHasher, type HashParameters } from './PasswordHasher.js'

const clock = fixedClock('2026-08-02T09:00:00.000Z')

// Deliberately weak parameters. The shipped defaults take ~100ms per hash by
// design, which would make this suite take minutes. The algorithm under test is
// identical; only the work factor differs.
const testParameters: HashParameters = { cost: 16, blockSize: 1, parallelism: 1 }
const hasher = createPasswordHasher(testParameters)

let users: FakeUserRepository
let audit: FakeAuditRepository
let auth: AuthService
let admin: PublicUser

beforeEach(() => {
  users = new FakeUserRepository(clock)
  audit = new FakeAuditRepository(clock)
  auth = new AuthService({ users, audit, hasher, clock })

  const created = users.create({
    branchId: 'branch-1',
    name: 'Admin',
    username: 'admin',
    passwordHash: hasher.hash('Admin@123'),
    role: 'ADMIN',
    mustChangePassword: false,
  })
  admin = {
    id: created.id,
    branchId: created.branchId,
    name: created.name,
    username: created.username,
    role: created.role,
    isActive: created.isActive,
    mustChangePassword: created.mustChangePassword,
    lastLoginAt: null,
  }
})

describe('login', () => {
  it('accepts the right password', () => {
    const result = auth.login('admin', 'Admin@123')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.username).toBe('admin')
  })

  it('is case-insensitive on the username, matching the unique index', () => {
    expect(auth.login('ADMIN', 'Admin@123').ok).toBe(true)
  })

  it('rejects the wrong password', () => {
    const result = auth.login('admin', 'wrong')
    expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' })
  })

  it('gives the same answer for an unknown user as for a wrong password', () => {
    // Otherwise the response tells an attacker which usernames exist.
    expect(auth.login('nobody', 'whatever')).toEqual({
      ok: false,
      reason: 'INVALID_CREDENTIALS',
    })
  })

  it('never returns a password hash to the caller', () => {
    const result = auth.login('admin', 'Admin@123')
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.user)).not.toContain('scrypt$')
  })

  it('records the login in the audit trail', () => {
    auth.login('admin', 'Admin@123')
    expect(audit.actions()).toContain('LOGIN')
  })

  it('records a failed attempt, since there is no lockout', () => {
    auth.login('admin', 'wrong')
    const entry = audit.entries.at(-1)
    expect(entry?.action).toBe('LOGIN_FAILED')
    expect(JSON.parse(entry?.detail ?? '{}')).toMatchObject({ reason: 'WRONG_PASSWORD' })
  })

  it('does not lock the account out after repeated failures', () => {
    // A lockout on a shared shop PC is a denial of service against the shop.
    for (let i = 0; i < 10; i++) auth.login('admin', 'wrong')
    expect(auth.login('admin', 'Admin@123').ok).toBe(true)
  })

  it('stamps the last login time', () => {
    auth.login('admin', 'Admin@123')
    expect(users.findById(admin.id)?.lastLoginAt).toBe('2026-08-02T09:00:00.000Z')
  })
})

describe('a disabled account', () => {
  beforeEach(() => {
    users.create({
      branchId: 'branch-1',
      name: 'Old Salesman',
      username: 'oldsales',
      passwordHash: hasher.hash('Sales@123'),
      role: 'SALESMAN',
      mustChangePassword: false,
    })
    const target = users.findByUsername('oldsales')
    users.setActive(target?.id ?? '', false)
  })

  it('cannot log in even with the right password', () => {
    expect(auth.login('oldsales', 'Sales@123')).toEqual({
      ok: false,
      reason: 'ACCOUNT_DISABLED',
    })
  })

  it('does not reveal that it is disabled to someone with the wrong password', () => {
    expect(auth.login('oldsales', 'wrong')).toEqual({
      ok: false,
      reason: 'INVALID_CREDENTIALS',
    })
  })
})

describe('changing your own password', () => {
  it('requires the current password', () => {
    expect(() => auth.changeOwnPassword(admin.id, 'wrong', 'NewPass1')).toThrow(
      PermissionError,
    )
  })

  it('changes it and clears the must-change flag', () => {
    auth.changeOwnPassword(admin.id, 'Admin@123', 'NewPass1')
    expect(auth.login('admin', 'NewPass1').ok).toBe(true)
    expect(users.findById(admin.id)?.mustChangePassword).toBe(false)
  })

  it('rejects a password below the minimum length', () => {
    expect(() => auth.changeOwnPassword(admin.id, 'Admin@123', 'abc')).toThrow(
      ValidationError,
    )
  })

  it('leaves the old password working if the change was rejected', () => {
    expect(() => auth.changeOwnPassword(admin.id, 'Admin@123', 'abc')).toThrow()
    expect(auth.login('admin', 'Admin@123').ok).toBe(true)
  })
})

describe('administering users', () => {
  it('creates a user who must change their password at first login', () => {
    const created = auth.createUser(admin, {
      name: 'Salesman',
      username: 'sales',
      password: 'Sales@123',
      role: 'SALESMAN',
      branchId: 'branch-1',
    })
    expect(created.mustChangePassword).toBe(true)
    const result = auth.login('sales', 'Sales@123')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.mustChangePassword).toBe(true)
  })

  it('refuses a duplicate username', () => {
    expect(() =>
      auth.createUser(admin, {
        name: 'Another',
        username: 'ADMIN',
        password: 'Other@123',
        role: 'MANAGER',
        branchId: null,
      }),
    ).toThrow(/already taken/)
  })

  it('does not let a salesman create users', () => {
    const salesman = auth.createUser(admin, {
      name: 'Salesman',
      username: 'sales',
      password: 'Sales@123',
      role: 'SALESMAN',
      branchId: null,
    })
    expect(() =>
      auth.createUser(salesman, {
        name: 'Sneaky',
        username: 'sneaky',
        password: 'Sneak@123',
        role: 'ADMIN',
        branchId: null,
      }),
    ).toThrow(PermissionError)
  })

  it('forces a password change after an admin reset', () => {
    const sales = auth.createUser(admin, {
      name: 'Salesman',
      username: 'sales',
      password: 'Sales@123',
      role: 'SALESMAN',
      branchId: null,
    })
    auth.resetPassword(admin, sales.id, 'Reset@123')
    const result = auth.login('sales', 'Reset@123')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.mustChangePassword).toBe(true)
  })

  it('records a reset in the audit trail', () => {
    const sales = auth.createUser(admin, {
      name: 'Salesman',
      username: 'sales',
      password: 'Sales@123',
      role: 'SALESMAN',
      branchId: null,
    })
    auth.resetPassword(admin, sales.id, 'Reset@123')
    expect(audit.actions()).toContain('PASSWORD_RESET')
  })
})

describe('the last administrator cannot be locked out', () => {
  // There is no support server for an offline app. Disabling the only admin is
  // unrecoverable, so it is refused.
  it('refuses to disable the only active admin', () => {
    expect(() => auth.setUserActive(admin, admin.id, false)).toThrow(
      /only active administrator/,
    )
  })

  it('allows it once a second admin exists', () => {
    auth.createUser(admin, {
      name: 'Second Admin',
      username: 'admin2',
      password: 'Admin@456',
      role: 'ADMIN',
      branchId: null,
    })
    expect(() => auth.setUserActive(admin, admin.id, false)).not.toThrow()
  })

  it('still allows disabling a non-admin', () => {
    const sales = auth.createUser(admin, {
      name: 'Salesman',
      username: 'sales',
      password: 'Sales@123',
      role: 'SALESMAN',
      branchId: null,
    })
    expect(() => auth.setUserActive(admin, sales.id, false)).not.toThrow()
  })
})

describe('password hashing', () => {
  it('produces a different hash each time for the same password', () => {
    expect(hasher.hash('same')).not.toBe(hasher.hash('same'))
  })

  it('verifies correctly despite the random salt', () => {
    expect(hasher.verify('same', hasher.hash('same'))).toBe(true)
  })

  it('returns false rather than throwing on a corrupted hash', () => {
    for (const corrupt of ['', 'garbage', 'scrypt$x$y$z$a$b', 'bcrypt$1$2$3$a$b']) {
      expect(hasher.verify('anything', corrupt)).toBe(false)
    }
  })

  it('refuses to hash an empty password', () => {
    expect(() => hasher.hash('')).toThrow()
  })

  it('flags a hash made with weaker parameters for upgrade', () => {
    const weak = createPasswordHasher({ cost: 2, blockSize: 1, parallelism: 1 }).hash('x')
    expect(hasher.needsRehash(weak)).toBe(true)
    expect(hasher.needsRehash(hasher.hash('x'))).toBe(false)
  })

  it('upgrades a weak hash transparently on successful login', () => {
    const weakHasher = createPasswordHasher({ cost: 2, blockSize: 1, parallelism: 1 })
    users.create({
      branchId: null,
      name: 'Legacy',
      username: 'legacy',
      passwordHash: weakHasher.hash('Legacy@1'),
      role: 'MANAGER',
      mustChangePassword: false,
    })

    expect(auth.login('legacy', 'Legacy@1').ok).toBe(true)
    const stored = users.findByUsername('legacy')?.passwordHash ?? ''
    expect(hasher.needsRehash(stored)).toBe(false)
    // And the password still works after the upgrade.
    expect(auth.login('legacy', 'Legacy@1').ok).toBe(true)
  })
})
