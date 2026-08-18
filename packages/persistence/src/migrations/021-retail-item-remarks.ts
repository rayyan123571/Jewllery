import type { Migration } from './runner.js'

/**
 * A per-ITEM note on a retail sale, and on the bill still being typed.
 *
 * There is already a remarks field on the SALE (`retail_sales.remarks`, and its
 * draft twin), and this is not that. That one is about the visit; this one is
 * about the piece — a stone to check, which tray it came from, what the
 * customer asked for on this one line. A shop with four items on a bill had one
 * box for all four.
 *
 * It is NOT printed, and that is the point of it rather than an oversight:
 * `RetailReceiptLine` has no field for it and is not to be given one. The
 * customer gets the invoice; the shop keeps its own notes. It is still stored,
 * because a note that vanished when the operator changed tab would be worse
 * than no note at all.
 *
 * Both tables in one migration because it is one field: a note typed on a draft
 * has to survive being posted, and a column added to only half of that path is
 * a note that disappears at the moment it becomes permanent. The draft table
 * takes `NOT NULL DEFAULT ''` like every other text cell on it — a scratchpad
 * for a live screen, where "" is simply what an untouched box holds — and the
 * posted table takes nullable TEXT like the sale-level remarks beside it.
 */
export const migration021: Migration = {
  version: 21,
  name: 'retail-item-remarks',
  up: `
    ALTER TABLE retail_sale_items  ADD COLUMN remarks TEXT;
    ALTER TABLE retail_draft_items ADD COLUMN remarks_text TEXT NOT NULL DEFAULT '';
  `,
}
