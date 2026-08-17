import type { Migration } from './runner.js'

/**
 * Purchases and the stock ledger (M6 / M4).
 *
 * ── Stock is a ledger, not a number ───────────────────────────────────────
 * There is deliberately NO quantity column on any item and no stock table with
 * a balance in it. `stock_ledger` is append-only: every movement of metal is a
 * row, current stock is always SUM(gross_mg) and SUM(khalis_mg) grouped by
 * bucket, and nothing is ever updated in place or deleted. When the shop finds
 * itself three grams short, a ledger answers "which movement" in seconds; a
 * mutable balance answers nothing. This is the same rule the party balance
 * already follows — `wholesale_entries.gold_delta_mg` is summed, never stored.
 *
 * Movements are SIGNED: incoming positive, outgoing negative. Cancelling a
 * posted purchase writes reversing rows with the opposite sign; the originals
 * survive and the pair nets to zero, so the books show what happened AND what
 * corrected it (DECISIONS §6).
 *
 * Both gross and khalis are carried on every row. Gross is the metal on the
 * shelf; khalis is what it is worth. A melt loses gross while preserving
 * khalis, and only a two-column ledger can show that.
 *
 * ── Snapshot everything that moves ────────────────────────────────────────
 * katt_milli_ratti and rate_per_tola_paisa are STORED on the purchase line and
 * on the ledger row, never resolved at read time. If a reader looked the rate
 * up instead, tomorrow's rate would silently rewrite yesterday's invoice, and
 * a customer holding the printed slip would be looking at different numbers
 * than the screen — the worst failure this module can have.
 *
 * ── Held purchases ────────────────────────────────────────────────────────
 * status 'held' is a purchase that has NOT happened: it takes a number (the
 * retail rule — a burned number beats a reused one) but writes no stock rows.
 * Only 'posted' touches stock. A cancelled purchase keeps its row and its
 * number; the status flips and the reversing stock rows carry the record.
 */
export const migration016: Migration = {
  version: 16,
  name: 'purchase-stock',
  up: `
    CREATE TABLE purchase_entries (
      id                  TEXT    PRIMARY KEY,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      party_id            TEXT    NOT NULL REFERENCES contacts (id),
      invoice_number      INTEGER NOT NULL,
      entry_date          TEXT    NOT NULL,
      status              TEXT    NOT NULL CHECK (status IN ('held', 'posted', 'cancelled')),
      -- The header default rate, SNAPSHOT at save time. Paisa per tola.
      rate_per_tola_paisa INTEGER NOT NULL CHECK (rate_per_tola_paisa > 0),
      -- Derived from the lines, but stored, so a reprint adds up byte-for-byte.
      total_gross_mg      INTEGER NOT NULL DEFAULT 0,
      total_khalis_mg     INTEGER NOT NULL DEFAULT 0,
      total_amount_paisa  INTEGER NOT NULL DEFAULT 0,
      notes               TEXT,
      cancelled_at        TEXT,
      cancel_reason       TEXT,
      created_by_user_id  TEXT    NOT NULL REFERENCES users (id),
      created_at          TEXT    NOT NULL,
      updated_at          TEXT    NOT NULL
    );

    -- One row per number per branch. A cancellation flips status on the SAME
    -- row rather than writing a twin, so the number stays unique outright.
    CREATE UNIQUE INDEX ux_purchase_entries_number
      ON purchase_entries (branch_id, invoice_number);
    CREATE INDEX idx_purchase_entries_party
      ON purchase_entries (party_id, entry_date);
    CREATE INDEX idx_purchase_entries_recent
      ON purchase_entries (branch_id, entry_date DESC, created_at DESC);

    CREATE TABLE purchase_line_items (
      id                  TEXT    PRIMARY KEY,
      purchase_id         TEXT    NOT NULL REFERENCES purchase_entries (id) ON DELETE CASCADE,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      line_no             INTEGER NOT NULL,
      item_name           TEXT    NOT NULL,
      gross_mg            INTEGER NOT NULL CHECK (gross_mg >= 0),
      -- The deduction in ratti per tola on the 96-ratti scale, milli-ratti.
      katt_milli_ratti    INTEGER NOT NULL CHECK (katt_milli_ratti BETWEEN 0 AND 96000),
      -- Derived from gross and katt, but stored: khalis = gross × (96000 − katt) / 96000.
      khalis_mg           INTEGER NOT NULL,
      -- The rate THIS line was priced at. Defaults from the header, per line.
      rate_per_tola_paisa INTEGER NOT NULL CHECK (rate_per_tola_paisa > 0),
      amount_paisa        INTEGER NOT NULL,
      -- Where the metal lands when the purchase posts. Most purchases are old
      -- gold headed for the melt, which is why the screen defaults to SCRAP.
      bucket              TEXT    NOT NULL CHECK (bucket IN ('FINISHED', 'SCRAP', 'BULLION')),
      remarks             TEXT,
      UNIQUE (purchase_id, line_no)
    );

    CREATE INDEX idx_purchase_line_items_parent ON purchase_line_items (purchase_id);

    CREATE TABLE stock_ledger (
      id                  TEXT    PRIMARY KEY,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      -- When the movement happened. TEXT UTC ISO, sorts lexicographically.
      at                  TEXT    NOT NULL,
      kind                TEXT    NOT NULL CHECK (kind IN
                            ('OPENING', 'PURCHASE_IN', 'SALE_OUT', 'MELT_IN', 'MELT_OUT', 'ADJUSTMENT')),
      bucket              TEXT    NOT NULL CHECK (bucket IN ('FINISHED', 'SCRAP', 'BULLION')),
      -- SIGNED milligrams. Incoming positive, outgoing negative. No >= 0 CHECK,
      -- deliberately: an outgoing movement is negative, and a bucket below zero
      -- is a fact to show, not an insert to refuse (DECISIONS §7).
      gross_mg            INTEGER NOT NULL,
      khalis_mg           INTEGER NOT NULL,
      -- Snapshots of what the movement was assessed and priced at. Nullable:
      -- an adjustment from a physical count has neither.
      katt_milli_ratti    INTEGER CHECK (katt_milli_ratti IS NULL OR katt_milli_ratti BETWEEN 0 AND 96000),
      rate_per_tola_paisa INTEGER CHECK (rate_per_tola_paisa IS NULL OR rate_per_tola_paisa > 0),
      -- What produced the movement, e.g. ('purchase', <purchase id>). Null for
      -- a manual entry. TEXT rather than an FK because rows outlive their
      -- source's table shape — the reference is a pointer, not a constraint.
      ref_type            TEXT,
      ref_id              TEXT,
      item_name           TEXT,
      note                TEXT,
      created_by_user_id  TEXT    NOT NULL REFERENCES users (id),
      created_at          TEXT    NOT NULL
    );

    CREATE INDEX idx_stock_ledger_time   ON stock_ledger (branch_id, at, created_at);
    CREATE INDEX idx_stock_ledger_bucket ON stock_ledger (branch_id, bucket);
    CREATE INDEX idx_stock_ledger_ref    ON stock_ledger (ref_type, ref_id);

    -- The purchase book's own sequence, from 1, exactly like the others.
    INSERT OR REPLACE INTO invoice_sequences (key, prefix, next_number)
      VALUES ('purchase', '', 1);
  `,
}
