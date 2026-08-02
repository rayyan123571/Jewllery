import type { Migration } from './runner.js'

/**
 * Wholesale (M2): entries, their lines, and settlements.
 *
 * The shape follows the real slip in docs/wholesale-receipt.jpg, not the
 * original mockup. In particular there is **no per-row remaining weight** and no
 * purity column: a line is item, gross, katt and the rate, and khalis and amount
 * are derived. Remaining exists only as a ledger balance.
 *
 * Every weight is INTEGER milligrams, every amount INTEGER paisa, and katt
 * INTEGER milli-ratti. There is no REAL column here, and schema.test.ts fails
 * the build if one appears.
 *
 * Posted rows are never edited (DECISIONS §6). A correction is a reversing
 * entry: `reverses_entry_id` points at what it cancels, and `reversed_by_entry_id`
 * is stamped on the original so a reader sees at once that it no longer stands.
 */
export const migration004: Migration = {
  version: 4,
  name: 'wholesale',
  up: `
    -- ── entries ───────────────────────────────────────────────────────────
    -- One slip. ISSUE hands gold to the party; SETTLEMENT takes it back, in
    -- gold, in cash, or in both.
    CREATE TABLE wholesale_entries (
      id                  TEXT    PRIMARY KEY,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      party_id            TEXT    NOT NULL REFERENCES parties (id),
      kind                TEXT    NOT NULL CHECK (kind IN ('ISSUE','SETTLEMENT')),
      -- Human-facing number printed on the slip, e.g. WS-10025. Unique per branch.
      invoice_no          TEXT    NOT NULL,
      -- The business day the slip belongs to, 'YYYY-MM-DD'. Not a timestamp:
      -- the rate that applies is chosen by this date, in the shop's own
      -- reckoning, regardless of what UTC instant the row was written at.
      entry_date          TEXT    NOT NULL,

      -- The rate STORED ON THE TRANSACTION, in paisa per tola. Never looked up
      -- again at read time: if it were, every past entry would silently
      -- revalue itself the next time the gold rate moved, and a party's
      -- history would change under them. Null only for a gold-only settlement,
      -- which needs no rate at all.
      rate_per_tola_paisa INTEGER CHECK (rate_per_tola_paisa IS NULL
                                         OR rate_per_tola_paisa > 0),

      -- Totals, stored as posted so a reprint is identical to the original and
      -- never re-derives from code that may since have changed.
      total_gross_mg      INTEGER NOT NULL DEFAULT 0,
      total_khalis_mg     INTEGER NOT NULL DEFAULT 0,
      total_amount_paisa  INTEGER NOT NULL DEFAULT 0,

      -- Settlement portions. Both zero on an ISSUE.
      settled_gold_mg     INTEGER NOT NULL DEFAULT 0,
      settled_cash_paisa  INTEGER NOT NULL DEFAULT 0,
      -- The gold the cash portion bought at rate_per_tola_paisa, stored rather
      -- than recomputed for the same reason the rate is stored.
      settled_cash_as_gold_mg INTEGER NOT NULL DEFAULT 0,

      -- The signed effect on the party's GOLD ledger. Positive = the party owes
      -- the shop more after this entry. An ISSUE is positive; a SETTLEMENT is
      -- negative. This one column is what the running balance sums.
      gold_delta_mg       INTEGER NOT NULL,
      -- The signed effect on the CASH ledger, for ordinary cash movements that
      -- are not settling a gold debt. Zero for both kinds above.
      cash_delta_paisa    INTEGER NOT NULL DEFAULT 0,

      -- Over-return flag and its confirmation (DECISIONS §7).
      is_over_return      INTEGER NOT NULL DEFAULT 0 CHECK (is_over_return IN (0,1)),
      confirmed_by_user_id TEXT REFERENCES users (id),

      -- Reversal, never edit.
      reverses_entry_id     TEXT REFERENCES wholesale_entries (id),
      reversed_by_entry_id  TEXT REFERENCES wholesale_entries (id),

      notes               TEXT,
      created_by_user_id  TEXT    NOT NULL REFERENCES users (id),
      created_at          TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX idx_wholesale_invoice
      ON wholesale_entries (branch_id, invoice_no COLLATE NOCASE);

    -- Serves the party ledger, which reads every entry for one party in date
    -- order and accumulates a running balance.
    CREATE INDEX idx_wholesale_party_date
      ON wholesale_entries (party_id, entry_date, created_at);

    CREATE INDEX idx_wholesale_branch_date
      ON wholesale_entries (branch_id, entry_date DESC);

    -- ── line items ────────────────────────────────────────────────────────
    -- Exactly the slip's columns: ITEM | GR | CAAT | PR, plus the rate and the
    -- amount it produces.
    CREATE TABLE wholesale_line_items (
      id                  TEXT    PRIMARY KEY,
      entry_id            TEXT    NOT NULL REFERENCES wholesale_entries (id) ON DELETE CASCADE,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      line_no             INTEGER NOT NULL,
      item_name           TEXT    NOT NULL,
      gross_mg            INTEGER NOT NULL CHECK (gross_mg >= 0),
      -- Katt in milli-ratti per tola. 13.000 ratti is 13000. Bounded by the
      -- 96-ratti scale: beyond it the deduction is not arithmetically meaningful.
      katt_milli_ratti    INTEGER NOT NULL CHECK (katt_milli_ratti BETWEEN 0 AND 96000),
      -- Derived, but stored: a reprint must be identical to the original slip.
      khalis_mg           INTEGER NOT NULL,
      rate_per_tola_paisa INTEGER NOT NULL CHECK (rate_per_tola_paisa > 0),
      amount_paisa        INTEGER NOT NULL,
      remarks             TEXT
    );

    CREATE INDEX idx_wholesale_lines_entry ON wholesale_line_items (entry_id, line_no);

    -- ── held (unposted) slips ─────────────────────────────────────────────
    -- What the HOLD button parks. Deliberately a separate table with no
    -- foreign key into the ledger: a held slip is scratch, it has no invoice
    -- number, and no report, balance or ledger query ever reads it.
    CREATE TABLE wholesale_holds (
      id          TEXT PRIMARY KEY,
      branch_id   TEXT NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      party_id    TEXT REFERENCES parties (id),
      payload     TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users (id),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX idx_wholesale_holds_branch ON wholesale_holds (branch_id, updated_at DESC);
  `,
}
