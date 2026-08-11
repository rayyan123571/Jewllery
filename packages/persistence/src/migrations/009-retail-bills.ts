import type { Migration } from './runner.js'

/**
 * The bill: one customer visit, several slips.
 *
 * ── What a slip is, and what it is not ────────────────────────────────────
 * A slip IS a `retail_sales` row. Not a new kind of document, not a copy of one
 * — the same table, the same items, the same calculation core and the same
 * validations. Everything already proved about a retail sale keeps holding for
 * a slip, because a slip is a retail sale.
 *
 * What is new is the PARENT. A customer buys bangles, a chain and a pair of
 * tops in one visit and wants them on separate pieces of paper, because each
 * one is for a different person or a different purse. That is one visit
 * producing several documents, and until now the only way to record it was
 * three unrelated sales that nothing tied together.
 *
 * ── Which facts live where ────────────────────────────────────────────────
 * On the BILL: who the customer is, their mobile, the salesman, the date and
 * the time. They belong to the visit, not to any one slip, and holding them
 * once means they cannot disagree between slips.
 *
 * On the SLIP: items, charges, discount, payment — and the rate. The rate is
 * shared by every slip in a bill as a matter of how the screen fills them in,
 * NOT by living on the bill, and that is deliberate: `rate_per_tola_paisa`
 * stays on `retail_sales` where it already is, because a posted invoice must
 * reproduce exactly from its own row. A rate held only on the parent would make
 * every slip's price depend on a row it does not own.
 *
 * ── Why the columns are nullable and the index is partial ─────────────────
 * Every sale written before this migration has no bill, and that is a correct
 * state rather than a gap to backfill: a single-slip sale is a whole sale. So
 * `bill_id` is nullable and the uniqueness of (bill_id, slip_no) is enforced by
 * a PARTIAL unique index.
 *
 * SQLite cannot add a table-level UNIQUE constraint through ALTER TABLE, and a
 * plain UNIQUE index over two nullable columns would not do the right thing
 * anyway — it permits many NULL pairs, which is what we want for old rows, but
 * says nothing useful. `WHERE bill_id IS NOT NULL` is the exact constraint
 * intended: within a bill, a slip number appears once; outside one, the columns
 * are simply absent.
 */
export const migration009: Migration = {
  version: 9,
  name: 'retail-bills',
  up: `
    CREATE TABLE retail_bills (
      id                        TEXT PRIMARY KEY,
      bill_no                   TEXT NOT NULL UNIQUE,
      branch_id                 TEXT NOT NULL REFERENCES branches(id),
      bill_date                 TEXT NOT NULL,
      bill_time                 TEXT NOT NULL,
      customer_id               TEXT NULL REFERENCES customers(id),
      customer_name_snapshot    TEXT NOT NULL,
      customer_mobile_snapshot  TEXT,
      salesman_id               TEXT NULL REFERENCES salesmen(id),
      salesman_name_snapshot    TEXT,
      status                    TEXT NOT NULL
                                  CHECK (status IN ('draft','held','posted','void')),
      created_by                TEXT NOT NULL REFERENCES users(id),
      created_at                TEXT NOT NULL,
      posted_at                 TEXT NULL
    );

    CREATE INDEX idx_retail_bills_date     ON retail_bills (bill_date);
    CREATE INDEX idx_retail_bills_customer ON retail_bills (customer_id);

    ALTER TABLE retail_sales ADD COLUMN bill_id TEXT NULL REFERENCES retail_bills(id);
    ALTER TABLE retail_sales ADD COLUMN slip_no INTEGER NULL;
    ALTER TABLE retail_sales ADD COLUMN slip_label TEXT NULL;

    CREATE UNIQUE INDEX idx_retail_sales_bill_slip
      ON retail_sales (bill_id, slip_no)
      WHERE bill_id IS NOT NULL;

    CREATE INDEX idx_retail_sales_bill ON retail_sales (bill_id);
  `,
}
