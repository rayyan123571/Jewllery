import type { Migration } from './runner.js'

/**
 * Parties (M1).
 *
 * Opening balances are stored on the party because they are a fact about the
 * moment the shop started using this system — there is no earlier transaction
 * to derive them from. Every balance *after* that is derived from the ledger and
 * never stored, so a stored balance can never drift out of agreement with the
 * entries that produced it.
 */
export const migration003: Migration = {
  version: 3,
  name: 'parties',
  up: `
    CREATE TABLE parties (
      id            TEXT    PRIMARY KEY,
      branch_id     TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      code          TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      mobile        TEXT,
      city          TEXT,
      -- Opening balances. INTEGER milligrams and INTEGER paisa, never REAL.
      -- Signed: positive means the party owed the shop at the opening.
      opening_gold_mg    INTEGER NOT NULL DEFAULT 0,
      opening_cash_paisa INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      notes         TEXT,
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    );

    -- Codes are unique per branch and case-insensitive, so "chj" and "CHJ"
    -- cannot both exist and leave the counter guessing which one they picked.
    CREATE UNIQUE INDEX idx_parties_code
      ON parties (branch_id, code COLLATE NOCASE);

    -- Serves the type-ahead in the party selector, which searches name first.
    CREATE INDEX idx_parties_name ON parties (branch_id, name COLLATE NOCASE);
    CREATE INDEX idx_parties_active ON parties (branch_id, is_active);
  `,
}
