import type { Migration } from './runner.js'

/**
 * Pieces (M4 stage 2): the inventory itself, one row per physical article.
 *
 * ── Not item + quantity ───────────────────────────────────────────────────
 * There is no quantity column anywhere. Two "22K ladies ring" are not
 * interchangeable — one is 4.200 g and the other 5.800 g — so every article
 * is a row with its own weight, katt and tag. "How many" is COUNT(*),
 * "how much khalis" is SUM(khalis_mg), and every screen is a GROUP BY.
 *
 * ── The invariant this table exists under ─────────────────────────────────
 * The metal ledger and the pieces are two views of the same gold:
 *
 *   SUM(khalis_mg of pieces WHERE status = 'IN_STOCK')  ===  the ledger's
 *   FINISHED balance.
 *
 * FINISHED bucket = pieces only; SCRAP and BULLION stay untagged metal. Every
 * operation that creates, sells, melts or issues a piece writes its ledger row
 * in the SAME transaction — the repository offers no path that touches one
 * side without the other. Stage 3 adds the reconciliation check that proves
 * the two sides still agree, on demand and on every app start.
 *
 * ── Weights ───────────────────────────────────────────────────────────────
 * gross is the article on the scale, stones included. net = gross − stone is
 * the metal, and the CHECK makes the identity structural rather than a habit.
 * khalis is the pure content of the NET — a stone is not gold — snapshotted
 * at creation exactly as a purchase line snapshots its figures.
 *
 * A piece is never deleted. Status changes, and every change lands in
 * piece_events — the drill-down history the shopkeeper reads as "purchased
 * on, moved, issued, sold".
 */
export const migration018: Migration = {
  version: 18,
  name: 'pieces',
  up: `
    CREATE TABLE pieces (
      id                 TEXT    PRIMARY KEY,
      branch_id          TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      -- Printed on the physical tag; barcodes read it back (stage 7). Unique
      -- per branch, allocated from its own book inside the creating
      -- transaction, or typed to keep a tag already tied on.
      tag_number         INTEGER NOT NULL,
      item_id            TEXT    NOT NULL REFERENCES items (id),
      gross_mg           INTEGER NOT NULL CHECK (gross_mg >= 0),
      stone_mg           INTEGER NOT NULL DEFAULT 0 CHECK (stone_mg >= 0),
      stone_count        INTEGER NOT NULL DEFAULT 0 CHECK (stone_count >= 0),
      -- Stored AND checked: the identity net = gross − stone can never drift.
      net_mg             INTEGER NOT NULL CHECK (net_mg = gross_mg - stone_mg),
      katt_milli_ratti   INTEGER NOT NULL CHECK (katt_milli_ratti BETWEEN 0 AND 96000),
      khalis_mg          INTEGER NOT NULL CHECK (khalis_mg >= 0),
      location_id        TEXT    REFERENCES locations (id),
      status             TEXT    NOT NULL CHECK (status IN
                           ('IN_STOCK', 'SOLD', 'MELTED', 'ISSUED_TO_KARIGAR', 'TRANSFERRED', 'LOST')),
      source_type        TEXT    NOT NULL CHECK (source_type IN
                           ('OPENING', 'PURCHASE', 'KARIGAR_RECEIPT')),
      source_id          TEXT,
      status_changed_at  TEXT    NOT NULL,
      created_by_user_id TEXT    NOT NULL REFERENCES users (id),
      created_at         TEXT    NOT NULL,
      updated_at         TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX ux_pieces_tag      ON pieces (branch_id, tag_number);
    -- Serves the summary (IN_STOCK sweep) and the drill-downs.
    CREATE INDEX idx_pieces_status   ON pieces (branch_id, status);
    CREATE INDEX idx_pieces_item     ON pieces (item_id);
    CREATE INDEX idx_pieces_location ON pieces (location_id);

    CREATE TABLE piece_events (
      id                 TEXT    PRIMARY KEY,
      piece_id           TEXT    NOT NULL REFERENCES pieces (id),
      branch_id          TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      at                 TEXT    NOT NULL,
      kind               TEXT    NOT NULL CHECK (kind IN ('CREATED', 'MOVED', 'STATUS_CHANGED')),
      from_status        TEXT,
      to_status          TEXT,
      from_location_id   TEXT,
      to_location_id     TEXT,
      note               TEXT,
      created_by_user_id TEXT    NOT NULL REFERENCES users (id),
      created_at         TEXT    NOT NULL
    );

    CREATE INDEX idx_piece_events_piece ON piece_events (piece_id, at, created_at);

    -- The tag book, from 1, exactly like the invoice books.
    INSERT OR REPLACE INTO invoice_sequences (key, prefix, next_number)
      VALUES ('piece_tag', '', 1);
  `,
}
