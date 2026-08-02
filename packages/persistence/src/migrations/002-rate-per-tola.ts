import type { Migration } from './runner.js'

/**
 * Gold rates move from paisa-per-gram to paisa-per-tola.
 *
 * The original column stored the rate the shop entered after converting it to
 * per-gram. That conversion is lossy and cannot be undone: the trade quotes per
 * tola, and Rs 358,000 per tola is 3,069,341.56… paisa per gram — not an
 * integer. Rounding it at storage time discards a fraction of a paisa on every
 * gram, which is about a rupee across a single 235 g slip and compounds on every
 * transaction after that. Exactly the loss the integer-paisa rule exists to
 * prevent, introduced by the storage format itself.
 *
 * A tola is 11,664 mg — an exact integer — so holding the rate per tola and
 * dividing at the point of valuation keeps the whole chain exact.
 *
 * Existing rows are converted rather than dropped. In practice there are none
 * yet (the first-run seed deliberately plants no rate), but a migration that
 * silently mangles data it did not expect to find is not one worth writing. The
 * conversion is integer-only — `(v * 11664 + 500) / 1000` is round-half-up under
 * SQLite's integer division, and rates are always positive.
 */
export const migration002: Migration = {
  version: 2,
  name: 'rate-per-tola',
  up: `
    ALTER TABLE gold_rates RENAME COLUMN rate_per_gram TO rate_per_tola;

    UPDATE gold_rates
       SET rate_per_tola = (rate_per_tola * 11664 + 500) / 1000;
  `,
}
