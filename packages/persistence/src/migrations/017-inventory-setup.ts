import type { Migration } from './runner.js'

/**
 * The item master, the category tree, and the locations (M4 stage 1).
 *
 * ── Items are definitions, not stock ──────────────────────────────────────
 * There is deliberately NO weight column and NO quantity column on `items`,
 * and there never will be. Two pieces of "22K ladies ring" are not
 * interchangeable — one is 4.200 g, the other 5.800 g — so a quantity cannot
 * express what the shop holds and every total built on one is wrong.
 * Jewellery is tracked piece by piece: each physical article will be its own
 * row (`pieces`, next migration) with its own weight, and "how many" is a
 * COUNT of those rows. schema.test.ts asserts the absence of both columns,
 * the same way it asserts no balance column on stock_ledger.
 *
 * What an item does carry are the defaults a new piece or a sale line starts
 * from — purity, the usual katt, the making-charge habit — plus directory
 * facts: supplier, design number.
 *
 * ── The two-level tree, and NULL in a unique index ────────────────────────
 * Categories are the shop's own — rings, bangles, whatever it calls them —
 * two levels deep, nothing hardcoded. SQLite treats NULLs as distinct in a
 * plain unique index, so `UNIQUE (branch_id, parent_id, name)` would happily
 * accept two top-level "Rings". Two partial indexes close the hole: one for
 * the top level (parent IS NULL), one for children. The two-level LIMIT is
 * enforced by the service — a CHECK cannot read another row's parent_id.
 *
 * Nothing here deletes. Categories, locations and items deactivate, so an old
 * piece keeps its labels readable forever.
 */
export const migration017: Migration = {
  version: 17,
  name: 'inventory-setup',
  up: `
    CREATE TABLE item_categories (
      id         TEXT    PRIMARY KEY,
      branch_id  TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      -- Null = top level. A child points at a top-level parent; the service
      -- refuses a third level.
      parent_id  TEXT    REFERENCES item_categories (id),
      name       TEXT    NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX ux_item_categories_top
      ON item_categories (branch_id, name COLLATE NOCASE)
      WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX ux_item_categories_sub
      ON item_categories (branch_id, parent_id, name COLLATE NOCASE)
      WHERE parent_id IS NOT NULL;

    -- Where a piece physically sits. Shop-defined; nothing is seeded, because
    -- every shop names its showcases differently. A karigar is NOT a location
    -- — gold with a craftsman is a person with a balance (stage 5).
    CREATE TABLE locations (
      id         TEXT    PRIMARY KEY,
      branch_id  TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX ux_locations_name ON locations (branch_id, name COLLATE NOCASE);

    CREATE TABLE items (
      id                          TEXT    PRIMARY KEY,
      branch_id                   TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      -- Prints on tags, so it is unique per branch, case-insensitive, and the
      -- repository offers no way to change it once created.
      code                        TEXT    NOT NULL,
      name                        TEXT    NOT NULL,
      category_id                 TEXT    REFERENCES item_categories (id),
      purity                      TEXT    NOT NULL CHECK (purity IN ('K24', 'K22', 'K21', 'K18')),
      -- Pre-fills a new piece's katt. A default, never a source of truth:
      -- every piece snapshots its own katt, exactly as purchase lines do.
      default_katt_milli_ratti    INTEGER NOT NULL DEFAULT 0
                                    CHECK (default_katt_milli_ratti BETWEEN 0 AND 96000),
      -- The same pair retail labour uses, so a sale pre-filled from the item
      -- cannot mismatch a unit.
      making_charge_basis         TEXT    NOT NULL CHECK (making_charge_basis IN ('fixed', 'per_tola')),
      default_making_charge_paisa INTEGER NOT NULL DEFAULT 0 CHECK (default_making_charge_paisa >= 0),
      supplier_id                 TEXT    REFERENCES contacts (id),
      design_no                   TEXT,
      notes                       TEXT,
      is_active                   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_by_user_id          TEXT    NOT NULL REFERENCES users (id),
      created_at                  TEXT    NOT NULL,
      updated_at                  TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX ux_items_code ON items (branch_id, code COLLATE NOCASE);
    -- Serves the type-ahead, which searches name and design after code.
    CREATE INDEX idx_items_name     ON items (branch_id, name COLLATE NOCASE);
    CREATE INDEX idx_items_category ON items (category_id);
  `,
}
