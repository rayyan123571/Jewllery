import type { Migration } from './runner.js'

/**
 * The bill in progress remembers a rate typed on a line.
 *
 * The items grid became directly editable, and its Rate cell is per item: one
 * bill can hold a piece sold at the board rate and another the shop has quoted
 * keenly, and before this the only rate a draft could carry was the bill's.
 *
 * Stored as the TEXT that was typed, like every other cell in this table.
 * `retail_draft_items` is a scratchpad for a half-finished screen, not a
 * record — the operator may be mid-way through "23" on the way to "237970",
 * and a numeric column would have to decide what that means. The parse happens
 * once, on the way to a real sale, where a refusal can be reported.
 *
 * Empty is NOT zero, and that distinction is the whole reason the column has a
 * default of '' rather than '0'. Empty means "price this line at its purity's
 * rate"; zero would mean the shop is giving the metal away.
 */
export const migration013: Migration = {
  version: 13,
  name: 'draft-item-rate',
  up: `
    ALTER TABLE retail_draft_items ADD COLUMN rate_text TEXT NOT NULL DEFAULT '';
  `,
}
