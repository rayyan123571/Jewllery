import type { Migration } from './runner.js'

/**
 * The wastage rule a sale was priced with, stored on the sale.
 *
 * `retail.wastage.direction` and `retail.wastage.basis` are settings the shop
 * owner can change. Without these two columns, changing the setting would
 * silently re-price every past invoice the next time one was reprinted: the
 * paper in the customer's hand would stop matching the screen, and no record
 * anywhere would say why. History would move under the shop's feet.
 *
 * With them, a posted sale always reproduces exactly the figures it was saved
 * with, and the setting governs only sales made after it changed. That is what
 * makes the rule reversible without rewriting history — which is the same
 * principle as storing the gold rate on a wholesale slip rather than looking it
 * up again at read time (DECISIONS §10).
 *
 * Separate from 005 rather than folded into it because 005 has already been
 * applied to development databases, and a migration that is edited after it has
 * run is a migration that never runs again. Numbered, forward-only, append.
 *
 * The defaults match SETTING_KEYS defaults, so the handful of rows that could
 * exist before this migration read back as what they were actually priced with.
 */
export const migration006: Migration = {
  version: 6,
  name: 'retail-wastage-rule',
  up: `
    ALTER TABLE retail_sales
      ADD COLUMN wastage_direction TEXT NOT NULL DEFAULT 'add'
        CHECK (wastage_direction IN ('add','subtract'));

    ALTER TABLE retail_sales
      ADD COLUMN wastage_basis TEXT NOT NULL DEFAULT 'net'
        CHECK (wastage_basis IN ('gross','net'));
  `,
}
