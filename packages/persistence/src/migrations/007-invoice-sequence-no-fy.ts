import type { Migration } from './runner.js'

/**
 * The invoice sequence stops being per financial year.
 *
 * 005 keyed `invoice_sequences` by financial year, so the counter reset every
 * 1 July. That forced the year into the invoice number itself — without it the
 * first sale of each new year collided with the first sale of the previous one
 * under the UNIQUE constraint on `retail_sales.invoice_no`, and the shop could
 * not have traded on 1 July.
 *
 * The shop does not want the financial year in its invoice numbers, so the
 * simpler answer is the better one: ONE continuous sequence that never resets.
 * RS-00001 counts on for the life of the shop. No reset means no collision to
 * design around, and an invoice number that is unique on its own terms rather
 * than only in combination with a year.
 *
 * The `financial_year` column goes with it. A NOT NULL column holding a value
 * nothing reads is the kind of thing that rots quietly and then gets believed,
 * so the table is rebuilt without it — the standard SQLite pattern, forward
 * only, inside the migration runner's own transaction.
 *
 * Any existing sequence rows are collapsed onto the single key, taking the
 * highest counter so no number can be handed out twice across the change.
 */
export const migration007: Migration = {
  version: 7,
  name: 'invoice-sequence-no-fy',
  up: `
    CREATE TABLE invoice_sequences_new (
      key          TEXT PRIMARY KEY,
      prefix       TEXT NOT NULL,
      next_number  INTEGER NOT NULL
    );

    INSERT INTO invoice_sequences_new (key, prefix, next_number)
    SELECT 'retail', 'RS-', COALESCE(MAX(next_number), 1)
      FROM invoice_sequences
     WHERE key LIKE 'retail:%';

    DROP TABLE invoice_sequences;

    ALTER TABLE invoice_sequences_new RENAME TO invoice_sequences;
  `,
}
