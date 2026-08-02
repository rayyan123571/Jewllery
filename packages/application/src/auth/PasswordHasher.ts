import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with scrypt from Node's own crypto module.
 *
 * scrypt rather than bcrypt because it is in the standard library — no native
 * module to rebuild against each Electron ABI, and nothing extra to ship. It is
 * also memory-hard, which is the property that matters against an attacker with
 * a GPU and a copy of the shop's database file.
 *
 * The parameters are stored inside each hash rather than as a constant, so
 * raising the cost later does not invalidate existing passwords: an old hash
 * still verifies with the parameters it was created with, and is upgraded the
 * next time that user changes their password.
 */

const ALGORITHM = 'scrypt'
const SALT_BYTES = 16
const KEY_BYTES = 64

/** ~100ms on a shop PC. Deliberately slow — this runs once per login. */
const DEFAULT_COST = 16_384 // N
const DEFAULT_BLOCK_SIZE = 8 // r
const DEFAULT_PARALLELISM = 1 // p

// scryptSync enforces maxmem = 32MB by default, which N=16384 r=8 exceeds.
// 128 * N * r * p, with headroom.
const MAX_MEMORY = 64 * 1024 * 1024

export interface HashParameters {
  readonly cost: number
  readonly blockSize: number
  readonly parallelism: number
}

export const DEFAULT_PARAMETERS: HashParameters = Object.freeze({
  cost: DEFAULT_COST,
  blockSize: DEFAULT_BLOCK_SIZE,
  parallelism: DEFAULT_PARALLELISM,
})

export interface PasswordHasher {
  hash(plaintext: string): string
  /** Constant-time. Returns false for a malformed stored hash, never throws. */
  verify(plaintext: string, storedHash: string): boolean
  /** True when a stored hash was made with weaker parameters than current. */
  needsRehash(storedHash: string): boolean
}

function derive(plaintext: string, salt: Buffer, params: HashParameters): Buffer {
  return scryptSync(plaintext.normalize('NFKC'), salt, KEY_BYTES, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelism,
    maxmem: MAX_MEMORY,
  })
}

function encode(params: HashParameters, salt: Buffer, key: Buffer): string {
  return [
    ALGORITHM,
    params.cost,
    params.blockSize,
    params.parallelism,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$')
}

interface DecodedHash {
  readonly params: HashParameters
  readonly salt: Buffer
  readonly key: Buffer
}

function decode(storedHash: string): DecodedHash | null {
  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return null

  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelism = Number(parts[3])
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return null
  }

  try {
    const salt = Buffer.from(parts[4] as string, 'base64')
    const key = Buffer.from(parts[5] as string, 'base64')
    if (salt.length === 0 || key.length === 0) return null
    return { params: { cost, blockSize, parallelism }, salt, key }
  } catch {
    return null
  }
}

export function createPasswordHasher(
  params: HashParameters = DEFAULT_PARAMETERS,
): PasswordHasher {
  return {
    hash(plaintext: string): string {
      if (plaintext.length === 0) {
        throw new TypeError('A password cannot be empty')
      }
      const salt = randomBytes(SALT_BYTES)
      return encode(params, salt, derive(plaintext, salt, params))
    },

    verify(plaintext: string, storedHash: string): boolean {
      const decoded = decode(storedHash)
      // A malformed or corrupted hash means "no", not a crash that would leak
      // through as a different error than a wrong password.
      if (!decoded) return false

      let candidate: Buffer
      try {
        candidate = derive(plaintext, decoded.salt, decoded.params)
      } catch {
        return false
      }

      // timingSafeEqual throws on a length mismatch, which would itself be a
      // timing signal. Check the length first and compare only when equal.
      if (candidate.length !== decoded.key.length) return false
      return timingSafeEqual(candidate, decoded.key)
    },

    needsRehash(storedHash: string): boolean {
      const decoded = decode(storedHash)
      if (!decoded) return true
      return (
        decoded.params.cost < params.cost ||
        decoded.params.blockSize < params.blockSize ||
        decoded.params.parallelism < params.parallelism
      )
    },
  }
}
