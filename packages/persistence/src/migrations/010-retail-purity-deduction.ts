import type { Migration } from './runner.js'

/**
 * The retail purity deduction becomes an ABSOLUTE weight.
 *
 * ── What changed, and why it needed a column rather than a reinterpretation ──
 * `cut_per_tola_mg` means what its name says: a deduction quoted PER TOLA of
 * gross, which the calculation scaled by the piece's weight. On a 2.000-tola
 * item a 0.090 cut removed 0.180.
 *
 * The shop works the other way round. The shopkeeper reads the deduction off
 * the piece and types it — 0.090 removes 0.090, and two such items deduct 0.180
 * between them, not 0.360. That is a different quantity, not a different
 * opinion about the same one, so it gets its own column. Silently changing what
 * `cut_per_tola_mg` means would have re-priced every invoice already on disk
 * the next time one was reprinted.
 *
 * ── The backfill ────────────────────────────────────────────────────────────
 * Existing rows are converted, not defaulted: the absolute deduction that WAS
 * applied to each of them is `cut_per_tola_mg * gross_weight_mg / 11664`, which
 * is exactly what `computeRetailLine` used to work out. So every stored sale
 * keeps the net weight it was posted with, and a reprint reproduces the paper
 * the customer is holding.
 *
 * The rounding matches `scaleDiv`'s — half away from zero — done in integer SQL:
 * `(a*b + d/2) / d` on non-negative values, and every one of these is
 * non-negative because the schema forbids a negative gross and the service
 * refuses a negative cut.
 *
 * `cut_per_tola_mg` is deliberately LEFT IN PLACE. It is what those rows were
 * actually written with, and dropping it would destroy the evidence that the
 * backfill above is correct. Nothing reads it any more.
 */
export const migration010: Migration = {
  version: 10,
  name: 'retail-purity-deduction',
  up: `
    ALTER TABLE retail_sale_items
      ADD COLUMN purity_deduction_mg INTEGER NOT NULL DEFAULT 0;

    UPDATE retail_sale_items
       SET purity_deduction_mg =
             (cut_per_tola_mg * gross_weight_mg + 5832) / 11664
     WHERE cut_per_tola_mg > 0;
  `,
}
