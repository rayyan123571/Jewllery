import type { Migration } from './runner.js'

/**
 * The M0 schema: shop profile, branches, users, gold rates, audit log, settings.
 *
 * Two rules are visible in every table here and are not negotiable:
 *
 *   1. Every weight column is INTEGER milligrams and every money column is
 *      INTEGER paisa. There is no REAL column in this database, and
 *      schema.test.ts fails the build if one appears.
 *
 *   2. Every table that will ever hold a transaction carries `branch_id` from
 *      day one, so a future consolidation is not a migration across the whole
 *      trading history. The application ships with one branch. This does not
 *      make multi-branch work — see docs/DECISIONS.md §3.
 *
 * Timestamps are UTC ISO text; business dates are `YYYY-MM-DD` text. Both sort
 * lexicographically, which is what makes `ORDER BY effective_from DESC LIMIT 1`
 * correct with no date parsing in SQL.
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial',
  up: `
    -- ── branches ──────────────────────────────────────────────────────────
    CREATE TABLE branches (
      id          TEXT PRIMARY KEY,
      name        TEXT    NOT NULL,
      address     TEXT,
      is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active  IN (0, 1)),
      created_at  TEXT    NOT NULL
    );

    -- At most one default branch, enforced by the index rather than by code.
    CREATE UNIQUE INDEX idx_branches_single_default
      ON branches (is_default) WHERE is_default = 1;

    -- ── shop profile ──────────────────────────────────────────────────────
    -- Exactly one row, ever. The CHECK on the primary key is what guarantees
    -- it: there is one shop, not a tenant table.
    CREATE TABLE shop_profile (
      id                TEXT PRIMARY KEY CHECK (id = 'shop'),
      name              TEXT NOT NULL,
      tagline           TEXT,
      owner_name        TEXT NOT NULL,
      second_owner_name TEXT,
      phone1            TEXT NOT NULL,
      phone2            TEXT,
      phone3            TEXT,
      address           TEXT NOT NULL,
      logo_path         TEXT,
      updated_at        TEXT NOT NULL
    );

    -- ── users ─────────────────────────────────────────────────────────────
    -- Local accounts. No email column: an offline shop has no mail server, so
    -- there is no password reset by link. An ADMIN resets a password in-app.
    CREATE TABLE users (
      id                    TEXT PRIMARY KEY,
      branch_id             TEXT REFERENCES branches (id) ON DELETE SET NULL,
      name                  TEXT    NOT NULL,
      username              TEXT    NOT NULL,
      password_hash         TEXT    NOT NULL,
      role                  TEXT    NOT NULL
                              CHECK (role IN ('ADMIN','MANAGER','SALESMAN','ACCOUNTANT')),
      is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      must_change_password  INTEGER NOT NULL DEFAULT 0
                              CHECK (must_change_password IN (0, 1)),
      last_login_at         TEXT,
      created_at            TEXT    NOT NULL,
      updated_at            TEXT    NOT NULL
    );

    -- Case-insensitive: nobody should be able to create "Admin" alongside
    -- "admin" and then wonder which one they are logged in as.
    CREATE UNIQUE INDEX idx_users_username ON users (username COLLATE NOCASE);
    CREATE INDEX idx_users_branch ON users (branch_id);

    -- ── gold rates ────────────────────────────────────────────────────────
    -- History, not a setting. Rows are never updated or deleted; a correction
    -- is a new row. Valuation must use the rate in force on the day of the
    -- transaction, or reprinting an old statement silently reprices it.
    CREATE TABLE gold_rates (
      id                  TEXT    PRIMARY KEY,
      branch_id           TEXT    NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
      purity              TEXT    NOT NULL CHECK (purity IN ('K24','K22','K21','K18')),
      -- paisa per gram. INTEGER, never REAL.
      rate_per_gram       INTEGER NOT NULL CHECK (rate_per_gram > 0),
      effective_from      TEXT    NOT NULL,
      created_by_user_id  TEXT    NOT NULL REFERENCES users (id),
      created_at          TEXT    NOT NULL,
      note                TEXT
    );

    -- Serves the hot query: the rate for a purity on a given day is
    --   WHERE branch_id=? AND purity=? AND effective_from <= ?
    --   ORDER BY effective_from DESC, created_at DESC LIMIT 1
    CREATE INDEX idx_gold_rates_lookup
      ON gold_rates (branch_id, purity, effective_from DESC, created_at DESC);

    -- ── audit log ─────────────────────────────────────────────────────────
    -- Append only. No ip_address column: there is no network here.
    CREATE TABLE audit_log (
      id          TEXT PRIMARY KEY,
      branch_id   TEXT REFERENCES branches (id) ON DELETE SET NULL,
      -- Null only for a failed login, where no user was established.
      user_id     TEXT REFERENCES users (id),
      action      TEXT NOT NULL,
      entity      TEXT NOT NULL,
      entity_id   TEXT,
      detail      TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX idx_audit_created  ON audit_log (created_at DESC);
    CREATE INDEX idx_audit_user     ON audit_log (user_id, created_at DESC);
    CREATE INDEX idx_audit_entity   ON audit_log (entity, entity_id);

    -- ── settings ──────────────────────────────────────────────────────────
    -- Key/value, values stored as TEXT and parsed by the settings repository,
    -- so adding a setting never needs a migration.
    --
    -- This is where the M2 thresholds live: the over-return tolerance
    -- (default 0.050 g) and the cut-percentage check, which ships DISABLED
    -- with no guessed default — see docs/DECISIONS.md §7.
    CREATE TABLE app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- ── backup history ────────────────────────────────────────────────────
    -- Offline means the data exists nowhere else, so "when was the last good
    -- backup" is a question the app must be able to answer without the user
    -- going to look in a folder.
    CREATE TABLE backup_log (
      id                TEXT    PRIMARY KEY,
      file_path         TEXT    NOT NULL,
      size_bytes        INTEGER NOT NULL,
      kind              TEXT    NOT NULL CHECK (kind IN ('AUTO','MANUAL','PRE_RESTORE')),
      integrity_ok      INTEGER NOT NULL CHECK (integrity_ok IN (0, 1)),
      created_by_user_id TEXT   REFERENCES users (id),
      created_at        TEXT    NOT NULL
    );

    CREATE INDEX idx_backup_created ON backup_log (created_at DESC);
  `,
}
