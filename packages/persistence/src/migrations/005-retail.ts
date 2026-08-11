import type { Migration } from './runner.js'

/**
 * Retail sale: customers, salesmen, invoices, line items, and a real invoice
 * sequence.
 *
 * ── Why customers are not parties ─────────────────────────────────────────
 * `parties` is the wholesale counterparty table: every party has a standing
 * gold and cash ledger, because a wholesale relationship IS a running balance.
 * A retail customer usually has neither — they walk in, pay, and leave. Folding
 * the two together would mean every walk-in creating a ledger account that
 * never carries a balance, and the wholesale ledger filling with rows that are
 * not wholesale.
 *
 * ── Why the invoice snapshots the customer ────────────────────────────────
 * `customer_name_snapshot` and `customer_mobile_snapshot` are copied onto the
 * sale, not joined at read time. An invoice is a record of what happened. It
 * must still print correctly in five years if the customer is later renamed,
 * merged into another record, or deleted — and the printed paper the customer
 * is holding must keep matching the screen. The FK to `customers` is nullable
 * for the same reason: a walk-in sale is complete without one.
 *
 * ── Why every money and weight column is INTEGER ──────────────────────────
 * DECISIONS §2. Paisa and milligrams, never REAL, and a test asserts that no
 * REAL column exists anywhere in the schema. Percentages are basis points for
 * the same reason: 14.00% is 1400, so it survives arithmetic exactly.
 *
 * ── Why invoice_sequences exists ──────────────────────────────────────────
 * Wholesale derives its next number by scanning for the highest existing one,
 * which is fine at one counter and races at two. Retail allocates from a row
 * that is bumped INSIDE the same transaction as the insert, so two concurrent
 * saves cannot take the same number. The UI's "next invoice no" is a preview
 * only — it never reserves. A cancelled sale therefore burns its number, which
 * is correct: a gap in an invoice sequence is auditable, a reused number is a
 * second document claiming to be the first.
 */
export const migration005: Migration = {
  version: 5,
  name: 'retail',
  up: `
    CREATE TABLE customers (
      id                  TEXT PRIMARY KEY,
      code                TEXT NOT NULL UNIQUE,
      name                TEXT NOT NULL,
      mobile              TEXT,
      address             TEXT,
      city                TEXT,
      cnic                TEXT,
      is_walk_in          INTEGER NOT NULL DEFAULT 0 CHECK (is_walk_in IN (0, 1)),
      opening_gold_mg     INTEGER NOT NULL DEFAULT 0,
      opening_cash_paisa  INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL,
      created_by          TEXT NOT NULL
    );

    CREATE INDEX idx_customers_name   ON customers (name);
    CREATE INDEX idx_customers_mobile ON customers (mobile);

    CREATE TABLE salesmen (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE retail_sales (
      id                          TEXT PRIMARY KEY,
      invoice_no                  TEXT NOT NULL UNIQUE,
      branch_id                   TEXT NOT NULL REFERENCES branches(id),
      sale_date                   TEXT NOT NULL,
      sale_time                   TEXT NOT NULL,
      customer_id                 TEXT NULL REFERENCES customers(id),
      customer_name_snapshot      TEXT NOT NULL,
      customer_mobile_snapshot    TEXT,
      salesman_id                 TEXT NULL REFERENCES salesmen(id),
      salesman_name_snapshot      TEXT,
      rate_purity                 TEXT NOT NULL,
      rate_per_tola_paisa         INTEGER NOT NULL,
      gold_value_paisa            INTEGER NOT NULL,
      customer_gold_mg            INTEGER NOT NULL DEFAULT 0,
      customer_gold_purity        TEXT NULL,
      customer_gold_value_paisa   INTEGER NOT NULL DEFAULT 0,
      hallmark_charges_paisa      INTEGER NOT NULL DEFAULT 0,
      other_charges_paisa         INTEGER NOT NULL DEFAULT 0,
      discount_paisa              INTEGER NOT NULL DEFAULT 0,
      grand_total_paisa           INTEGER NOT NULL,
      amount_paid_paisa           INTEGER NOT NULL DEFAULT 0,
      payment_method              TEXT NOT NULL
                                    CHECK (payment_method IN ('cash','card','bank','credit')),
      balance_paisa               INTEGER NOT NULL DEFAULT 0,
      amount_in_words             TEXT NOT NULL,
      remarks                     TEXT,
      status                      TEXT NOT NULL
                                    CHECK (status IN ('draft','held','posted','void')),
      void_reason                 TEXT NULL,
      created_by                  TEXT NOT NULL REFERENCES users(id),
      created_at                  TEXT NOT NULL,
      posted_at                   TEXT NULL
    );

    CREATE INDEX idx_retail_sales_date     ON retail_sales (sale_date);
    CREATE INDEX idx_retail_sales_customer ON retail_sales (customer_id);
    CREATE INDEX idx_retail_sales_status   ON retail_sales (status);

    CREATE TABLE retail_sale_items (
      id                     TEXT PRIMARY KEY,
      sale_id                TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE CASCADE,
      line_no                INTEGER NOT NULL,
      item_name              TEXT NOT NULL,
      purity                 TEXT NOT NULL,
      gross_weight_mg        INTEGER NOT NULL CHECK (gross_weight_mg > 0),
      stone_weight_mg        INTEGER NOT NULL DEFAULT 0,
      cut_per_tola_mg        INTEGER NOT NULL DEFAULT 0,
      net_weight_mg          INTEGER NOT NULL,
      -- Basis points. 14.00% is 1400, and 5000 is the hard ceiling the service
      -- refuses above; this CHECK is the arithmetic floor under that policy.
      wastage_bp             INTEGER NOT NULL DEFAULT 0
                               CHECK (wastage_bp >= 0 AND wastage_bp <= 10000),
      wastage_mg             INTEGER NOT NULL DEFAULT 0,
      fine_weight_mg         INTEGER NOT NULL,
      labour_charges_paisa   INTEGER NOT NULL DEFAULT 0,
      labour_mode            TEXT NOT NULL DEFAULT 'fixed'
                               CHECK (labour_mode IN ('fixed','per_tola')),
      stone_charges_paisa    INTEGER NOT NULL DEFAULT 0,
      line_amount_paisa      INTEGER NOT NULL,
      UNIQUE (sale_id, line_no)
    );

    CREATE INDEX idx_retail_items_sale ON retail_sale_items (sale_id);

    CREATE TABLE invoice_sequences (
      key             TEXT PRIMARY KEY,
      prefix          TEXT NOT NULL,
      next_number     INTEGER NOT NULL,
      financial_year  TEXT NOT NULL
    );
  `,
}
