import type { Migration } from './runner.js'

/**
 * A line remembers the rate it was PRICED at.
 *
 * The items grid made the Rate cell editable per item, because one bill can
 * hold a piece sold at the board rate and another quoted keenly. The line
 * AMOUNT was stored correctly from the first sale — but the rate that produced
 * it was not, and only the sale's header rate was.
 *
 * So reopening an invoice repriced it. Measured, on a real bill: line 1 of
 * invoice 2 was posted at Rs 341,500/tola for Rs 292,996.58, and came back on
 * screen at the header's Rs 500,000/tola showing Rs 428,218.93 — a figure a
 * customer was never charged, on a document that had already been printed.
 * That is the exact failure `ratePerTolaOverride` was pinned to prevent, and
 * adding a per-item rate reintroduced it one level down.
 *
 * DEFAULT 0 means "not recorded", not "free". Rows written before this column
 * existed genuinely do not know their per-line rate, and the reader falls back
 * to the sale's header rate for them — which is what those sales were actually
 * priced at, because there was no other rate to price them with. Backfilling a
 * number would be inventing history; 0 says plainly that there is none.
 */
export const migration014: Migration = {
  version: 14,
  name: 'item-rate',
  up: `
    ALTER TABLE retail_sale_items
      ADD COLUMN rate_per_tola_paisa INTEGER NOT NULL DEFAULT 0;
  `,
}
