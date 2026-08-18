import type { Migration } from './runner.js'

/**
 * The shop's own per-line note on a wholesale slip, beside `remarks`.
 *
 * Free text, and deliberately so: it is written on the counter's instruction as
 * a second working column with no meaning to any calculation. Nothing reads it
 * back except the screen that wrote it, and it is not on the printed slip —
 * `ReceiptLine` in the thermal builder has no field for it.
 *
 * Nullable TEXT with no default, matching `remarks` on this same table exactly
 * rather than the `NOT NULL DEFAULT ''` the draft tables use. The distinction is
 * real: on a posted line, "nothing was written here" and "an empty string was
 * written here" are the same fact, and null is how this table already says it.
 */
export const migration020: Migration = {
  version: 20,
  name: 'wholesale-line-male',
  up: `
    ALTER TABLE wholesale_line_items ADD COLUMN male TEXT;
  `,
}
