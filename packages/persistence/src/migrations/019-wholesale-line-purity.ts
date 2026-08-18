import type { Migration } from './runner.js'

/**
 * A wholesale line remembers WHICH PURITY it was priced at.
 *
 * Until now the whole slip was priced at one rate, resolved once from the
 * module constant `WHOLESALE_RATE_PURITY` (K22) and stamped onto every row. A
 * party dealing in both 24K and 22K in one visit had no way to say so, and the
 * slip quietly charged the 22K rate for the lot.
 *
 * The column stores the KARAT CODE that was chosen — 'K24', 'K22' — not the
 * rate it resolved to. The rate is already stored beside it in
 * `rate_per_tola_paisa`, and the two answer different questions: the rate is
 * what this line was actually charged, and the purity is why. Keeping both is
 * what lets a reprint show the same figures as the original while still being
 * able to say what the line was.
 *
 * Defaulted to 'K22' rather than left null, and that default is the historical
 * truth rather than a convenience: every row written before this migration WAS
 * priced at the K22 rate, because that was the only rate the module could
 * resolve. Backfilling any other value would put a purity on those rows that
 * the shop never chose.
 */
export const migration019: Migration = {
  version: 19,
  name: 'wholesale-line-purity',
  up: `
    ALTER TABLE wholesale_line_items ADD COLUMN purity TEXT NOT NULL DEFAULT 'K22';
  `,
}
