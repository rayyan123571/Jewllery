import type { Migration } from './runner.js'

/**
 * One directory of people, and wholesale slip numbers that are plain integers.
 *
 * Two changes, and they are in one migration because the second one rebuilds
 * the table the first one has to repoint. Splitting them would mean rebuilding
 * `wholesale_entries` twice for one outcome.
 *
 * ── 1. `parties` and `customers` become `contacts` ────────────────────────
 * The shop is one shop. A jeweller who buys a bangle over the counter on Monday
 * and takes gold on account on Friday is ONE person, and typing their name into
 * two different boxes to create two rows that share a name and nothing else is
 * how a shop ends up with two balances for one debt — invisible until they
 * disagree, and unfixable afterwards without deciding which one is the truth.
 *
 * So there is one table and one identity. Both screens search it, both screens
 * add to it, and a name added on either appears on the other immediately.
 *
 * `customers` is RENAMED rather than merged into a new table, and that is a
 * deliberate cost saving: SQLite rewrites REFERENCES clauses on rename, so
 * `retail_sales`, `retail_bills` and `retail_draft_bills` follow it for free.
 * Only the two wholesale tables have to be rebuilt to point at the new name,
 * and one of them was being rebuilt anyway.
 *
 * The party columns `customers` lacks are added; the customer columns `parties`
 * lacks are left null on the rows that come across, because a wholesale party
 * genuinely has no CNIC on file rather than having one this migration could
 * invent.
 *
 * ── 2. A slip number is 1, 2, 3 — not WS-10001 ────────────────────────────
 * Exactly what migration 012 did to the retail invoice, and for the same
 * reasons. TEXT sorts lexically, so 'WS-10' sorts before 'WS-9' and NEXT from
 * the ninth slip would land on the tenth only by accident. The prefix moves to
 * display time (`wholesale.display.prefix`, empty by default), so putting 'WS-'
 * back is a settings change and never another migration.
 *
 * ── Why the numbering starts again at 1 ───────────────────────────────────
 * It does not restart a live book: the highest number ever issued is carried
 * into the sequence below, so a shop that has already printed WS-10005 carries
 * on at 10006 with its old slips readable as 10001…10005. A shop that has
 * issued nothing starts at 1, which is the case this change was asked for.
 *
 * ── Two books, each numbered from 1 ───────────────────────────────────────
 * Issues and settlements share this table and are numbered from separate
 * sequences, so both will hold a slip numbered 1. The unique index is therefore
 * per KIND, not per table.
 *
 * A reversal keeps the number of the slip it reverses — it is the same document
 * being corrected, not a new one — so it is excluded from that index and from
 * the book the navigation arrows walk. `reverses_entry_id` is what tells them
 * apart, which is a real column rather than a '-REV' suffix glued onto a string.
 */
export const migration015: Migration = {
  version: 15,
  name: 'shared-directory',
  up: `
    -- ── one directory ───────────────────────────────────────────────────────
    -- The rename carries retail_sales, retail_bills and retail_draft_bills with
    -- it: SQLite rewrites their REFERENCES clauses, so none of them is rebuilt.
    ALTER TABLE customers RENAME TO contacts;

    -- The columns a party has and a customer did not. Nullable, because
    -- ALTER TABLE cannot add NOT NULL without a constant default and because a
    -- walk-in genuinely belongs to no branch until one is chosen for them.
    ALTER TABLE contacts ADD COLUMN branch_id TEXT REFERENCES branches (id);
    ALTER TABLE contacts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
      CHECK (is_active IN (0, 1));
    ALTER TABLE contacts ADD COLUMN notes TEXT;
    ALTER TABLE contacts ADD COLUMN updated_at TEXT;

    UPDATE contacts
       SET branch_id  = COALESCE(branch_id, (SELECT id FROM branches WHERE is_default = 1)),
           updated_at = COALESCE(updated_at, created_at);

    -- Every party, carried across with its id intact so the ledger rows that
    -- already point at it still find it.
    INSERT INTO contacts (
      id, code, name, mobile, address, city, cnic, is_walk_in,
      opening_gold_mg, opening_cash_paisa, created_at, created_by,
      branch_id, is_active, notes, updated_at
    )
    SELECT p.id, p.code, p.name, p.mobile, NULL, p.city, NULL, 0,
           p.opening_gold_mg, p.opening_cash_paisa, p.created_at,
           COALESCE((SELECT id FROM users ORDER BY created_at LIMIT 1), 'migration-015'),
           p.branch_id, p.is_active, p.notes, p.updated_at
      FROM parties p
     WHERE p.id NOT IN (SELECT id FROM contacts);

    -- One code, one person — whatever case it was typed in. The column already
    -- carries a case-sensitive UNIQUE from migration 005; this is what stops
    -- "chj" and "CHJ" both existing and leaving the counter guessing.
    CREATE UNIQUE INDEX idx_contacts_code ON contacts (code COLLATE NOCASE);
    CREATE INDEX idx_contacts_branch_name ON contacts (branch_id, name COLLATE NOCASE);

    -- ── the slip book, renumbered ───────────────────────────────────────────
    CREATE TABLE wholesale_entries_new (
      id                  TEXT    PRIMARY KEY,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      party_id            TEXT    NOT NULL REFERENCES contacts (id),
      kind                TEXT    NOT NULL CHECK (kind IN ('ISSUE','SETTLEMENT')),
      -- The number, as an INTEGER. 1, 2, 3 — the prefix is a display setting.
      invoice_number      INTEGER NOT NULL,
      entry_date          TEXT    NOT NULL,
      rate_per_tola_paisa INTEGER CHECK (rate_per_tola_paisa IS NULL
                                         OR rate_per_tola_paisa > 0),
      total_gross_mg      INTEGER NOT NULL DEFAULT 0,
      total_khalis_mg     INTEGER NOT NULL DEFAULT 0,
      total_amount_paisa  INTEGER NOT NULL DEFAULT 0,
      settled_gold_mg     INTEGER NOT NULL DEFAULT 0,
      settled_cash_paisa  INTEGER NOT NULL DEFAULT 0,
      settled_cash_as_gold_mg INTEGER NOT NULL DEFAULT 0,
      gold_delta_mg       INTEGER NOT NULL,
      cash_delta_paisa    INTEGER NOT NULL DEFAULT 0,
      is_over_return      INTEGER NOT NULL DEFAULT 0 CHECK (is_over_return IN (0,1)),
      confirmed_by_user_id TEXT REFERENCES users (id),
      reverses_entry_id     TEXT REFERENCES wholesale_entries (id),
      reversed_by_entry_id  TEXT REFERENCES wholesale_entries (id),
      notes               TEXT,
      created_by_user_id  TEXT    NOT NULL REFERENCES users (id),
      created_at          TEXT    NOT NULL
    );

    -- The integer recovered from the old text, by the same recursive peel
    -- migration 012 used on the retail invoice: the longest all-digit SUFFIX.
    -- 'WS-10001' gives 10001; 'WS-10001-REV' gives nothing and falls back to
    -- the number of the slip it reverses, which is the number it should have
    -- carried all along.
    WITH RECURSIVE peel(id, rest, digits) AS (
      SELECT id, invoice_no, '' FROM wholesale_entries
      UNION ALL
      SELECT id,
             substr(rest, 1, length(rest) - 1),
             substr(rest, length(rest), 1) || digits
        FROM peel
       WHERE length(rest) > 0
         AND substr(rest, length(rest), 1) BETWEEN '0' AND '9'
    )
    INSERT INTO wholesale_entries_new (
      id, branch_id, party_id, kind, invoice_number, entry_date,
      rate_per_tola_paisa, total_gross_mg, total_khalis_mg, total_amount_paisa,
      settled_gold_mg, settled_cash_paisa, settled_cash_as_gold_mg,
      gold_delta_mg, cash_delta_paisa, is_over_return, confirmed_by_user_id,
      reverses_entry_id, reversed_by_entry_id, notes, created_by_user_id, created_at
    )
    SELECT e.id, e.branch_id, e.party_id, e.kind,
           COALESCE(
             -- The empty-string guard matters: the peel's own seed row carries
             -- an empty digits string, and CAST('' AS INTEGER) is 0 rather than
             -- NULL — so without it a number ending in no digits at all
             -- ('WS-1-REV') would read as slip 0 and never fall through to the
             -- line below.
             (SELECT MAX(CAST(p.digits AS INTEGER))
                FROM peel p WHERE p.id = e.id AND p.digits <> ''),
             (SELECT MAX(CAST(p2.digits AS INTEGER))
                FROM peel p2 WHERE p2.id = e.reverses_entry_id AND p2.digits <> ''),
             0
           ),
           e.entry_date,
           e.rate_per_tola_paisa, e.total_gross_mg, e.total_khalis_mg, e.total_amount_paisa,
           e.settled_gold_mg, e.settled_cash_paisa, e.settled_cash_as_gold_mg,
           e.gold_delta_mg, e.cash_delta_paisa, e.is_over_return, e.confirmed_by_user_id,
           e.reverses_entry_id, e.reversed_by_entry_id, e.notes, e.created_by_user_id,
           e.created_at
      FROM wholesale_entries e;

    -- The children are lifted off the old parent BEFORE it is dropped. Dropping
    -- a parent while PRAGMA foreign_keys is ON runs the ON DELETE CASCADE, and
    -- the pragma cannot be turned off inside the runner's transaction — so the
    -- lines would go with the table they belong to.
    CREATE TABLE wholesale_line_items_keep AS SELECT * FROM wholesale_line_items;
    DELETE FROM wholesale_line_items;

    DROP TABLE wholesale_entries;
    ALTER TABLE wholesale_entries_new RENAME TO wholesale_entries;

    INSERT INTO wholesale_line_items SELECT * FROM wholesale_line_items_keep;
    DROP TABLE wholesale_line_items_keep;

    -- Per KIND: issues and settlements are two books, and both hold a 1. A
    -- reversal carries its original's number, so it is not in either book.
    CREATE UNIQUE INDEX idx_wholesale_number
      ON wholesale_entries (branch_id, kind, invoice_number)
      WHERE reverses_entry_id IS NULL;

    CREATE INDEX idx_wholesale_party_date
      ON wholesale_entries (party_id, entry_date, created_at);
    CREATE INDEX idx_wholesale_branch_date
      ON wholesale_entries (branch_id, entry_date DESC);

    -- ── the held-slip table, repointed ──────────────────────────────────────
    CREATE TABLE wholesale_holds_new (
      id          TEXT PRIMARY KEY,
      branch_id   TEXT NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      party_id    TEXT REFERENCES contacts (id),
      payload     TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users (id),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    INSERT INTO wholesale_holds_new SELECT * FROM wholesale_holds;
    DROP TABLE wholesale_holds;
    ALTER TABLE wholesale_holds_new RENAME TO wholesale_holds;
    CREATE INDEX idx_wholesale_holds_branch ON wholesale_holds (branch_id, updated_at DESC);

    DROP TABLE parties;

    -- ── the sequences ───────────────────────────────────────────────────────
    -- Carried on from the highest number ever issued, never restarted: a number
    -- that has been printed is spent, and handing it out twice would put two
    -- slips in the shop's books claiming to be the same document.
    INSERT OR REPLACE INTO invoice_sequences (key, prefix, next_number)
    VALUES (
      'wholesale', '',
      COALESCE((SELECT MAX(invoice_number) + 1 FROM wholesale_entries
                 WHERE kind = 'ISSUE' AND reverses_entry_id IS NULL), 1)
    );

    INSERT OR REPLACE INTO invoice_sequences (key, prefix, next_number)
    VALUES (
      'settlement', '',
      COALESCE((SELECT MAX(invoice_number) + 1 FROM wholesale_entries
                 WHERE kind = 'SETTLEMENT' AND reverses_entry_id IS NULL), 1)
    );

    -- The old generator's prefixes are emptied rather than left in a row
    -- nothing reads. A stale 'WS-' sitting in the settings table is how it gets
    -- believed again a year from now.
    UPDATE app_settings SET value = ''
     WHERE key IN ('wholesale.invoicePrefix', 'wholesale.settlementPrefix');
  `,
}
