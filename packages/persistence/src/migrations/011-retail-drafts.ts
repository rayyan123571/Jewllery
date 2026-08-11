import type { Migration } from './runner.js'

/**
 * The bill in progress, on disk.
 *
 * ── Why a draft is not a retail_sale row ──────────────────────────────────
 * A slip IS a retail_sale once it is posted. In progress it is not, and the
 * blocker is `invoice_no TEXT NOT NULL UNIQUE`: an invoice number is ALLOCATED,
 * from a sequence, and spending one on a bill that may never be posted would
 * burn a number for every abandoned keystroke session. The whole point of
 * `invoice_sequences` is that a number is taken once, inside the transaction
 * that writes the document.
 *
 * So the editor's state gets its own tables. Posting reads them, runs them
 * through the SAME validation and the SAME `postBill` transaction a
 * renderer-held bill would have used, and only then are invoice numbers taken.
 * Nothing about a posted invoice can be disturbed by draft churn, because draft
 * churn never touches `retail_sales`.
 *
 * ── Why the typed text is stored beside the integer ───────────────────────
 * Money is paisa and weight is milligrams everywhere a TOTAL is computed. A
 * draft is not a total — it is what is in the boxes, mid-sentence. "2." is not a
 * weight, and parsing it to 0 to satisfy an INTEGER column would silently eat
 * the operator's work at exactly the moment this feature exists to protect it.
 *
 * So each typed field keeps both: the text as typed, and the exact milligram
 * WHEN one is known (the unit toggle sets it — see WeightFieldDto). That is the
 * DTO's own shape, persisted faithfully, so resuming restores the screen
 * byte-for-byte including the toggle's losslessness. Nothing computes from these
 * columns; resume feeds them back through the same parsers the live screen uses.
 *
 * ── One open draft per branch ─────────────────────────────────────────────
 * A counter serves one customer at a time. `branch_id` is UNIQUE, so saving a
 * draft replaces the branch's draft rather than accumulating a graveyard of
 * abandoned bills nobody will ever resume.
 */
export const migration011: Migration = {
  version: 11,
  name: 'retail-drafts',
  up: `
    CREATE TABLE retail_draft_bills (
      id                  TEXT PRIMARY KEY,
      branch_id           TEXT NOT NULL UNIQUE REFERENCES branches(id),
      bill_date           TEXT NOT NULL,
      bill_time           TEXT NOT NULL,
      customer_id         TEXT NULL REFERENCES customers(id),
      customer_name       TEXT NOT NULL DEFAULT '',
      customer_mobile     TEXT,
      salesman_id         TEXT NULL REFERENCES salesmen(id),
      rate_purity         TEXT NOT NULL,
      rate_override_text  TEXT NOT NULL DEFAULT '',
      weight_unit         TEXT NOT NULL DEFAULT 'tola'
                            CHECK (weight_unit IN ('gram','tola')),
      active_slip_no      INTEGER NOT NULL DEFAULT 1,
      /*
       * Which line is open in DETAILS, if any.
       *
       * An unresolved edit BLOCKS a save, so it is part of the draft's state:
       * resuming a bill that was mid-edit must resume the edit too, or the
       * operator comes back to a screen that refuses to save and says a line is
       * being edited that no longer appears to be.
       */
      editing_slip_no     INTEGER NULL,
      editing_line_no     INTEGER NULL,
      created_by          TEXT NOT NULL REFERENCES users(id),
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE TABLE retail_draft_slips (
      id                    TEXT PRIMARY KEY,
      draft_bill_id         TEXT NOT NULL
                              REFERENCES retail_draft_bills(id) ON DELETE CASCADE,
      slip_no               INTEGER NOT NULL,
      slip_label            TEXT NOT NULL DEFAULT '',
      /* The idempotency key this slip will post with. Minted once, kept. */
      draft_key             TEXT NOT NULL,
      customer_gold_text    TEXT NOT NULL DEFAULT '',
      customer_gold_mg      INTEGER NULL,
      customer_gold_purity  TEXT NULL,
      hallmark_text         TEXT NOT NULL DEFAULT '',
      other_text            TEXT NOT NULL DEFAULT '',
      discount_text         TEXT NOT NULL DEFAULT '',
      amount_paid_text      TEXT NOT NULL DEFAULT '',
      payment_method        TEXT NOT NULL DEFAULT 'cash'
                              CHECK (payment_method IN ('cash','card','bank','credit')),
      remarks               TEXT,
      UNIQUE (draft_bill_id, slip_no)
    );

    CREATE INDEX idx_retail_draft_slips_bill ON retail_draft_slips (draft_bill_id);

    CREATE TABLE retail_draft_items (
      id                    TEXT PRIMARY KEY,
      draft_slip_id         TEXT NOT NULL
                              REFERENCES retail_draft_slips(id) ON DELETE CASCADE,
      line_no               INTEGER NOT NULL,
      item_name             TEXT NOT NULL DEFAULT '',
      purity                TEXT NOT NULL,
      gross_text            TEXT NOT NULL DEFAULT '',
      gross_mg              INTEGER NULL,
      stone_text            TEXT NOT NULL DEFAULT '',
      stone_mg              INTEGER NULL,
      purity_deduction_text TEXT NOT NULL DEFAULT '',
      purity_deduction_mg   INTEGER NULL,
      wastage_percent_text  TEXT NOT NULL DEFAULT '',
      labour_text           TEXT NOT NULL DEFAULT '',
      labour_mode           TEXT NOT NULL DEFAULT 'fixed'
                              CHECK (labour_mode IN ('fixed','per_tola')),
      stone_charges_text    TEXT NOT NULL DEFAULT '',
      UNIQUE (draft_slip_id, line_no)
    );

    CREATE INDEX idx_retail_draft_items_slip ON retail_draft_items (draft_slip_id);
  `,
}
