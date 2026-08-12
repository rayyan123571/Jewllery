import type { Migration } from './runner.js'

/**
 * The invoice number becomes a plain integer: 1, 2, 3 — not RS-00001.
 *
 * ── The rule this migration must not break ────────────────────────────────
 * A number is NEVER reset and NEVER reused. Two bills sharing a number would
 * corrupt the shop's records permanently, and no later correction can undo it:
 * the paper is already in the customer's hand. So the number an existing sale
 * carries must survive this change unaltered — RS-00001 becomes 1, and it is
 * still the same document — and the sequence must carry on from the highest
 * value that has ever been handed out rather than restarting at 1.
 *
 * ── Why an integer column, alongside the text one ─────────────────────────
 * `invoice_no` stays TEXT because it is what every existing reader binds to and
 * what the UNIQUE constraint has always been enforced on. But TEXT sorts
 * lexically: '10' sorts before '9', so a report ordered by invoice number would
 * put the tenth sale above the ninth and the operator would open the wrong
 * bill. `invoice_number` is the same value as an INTEGER, and it is what the
 * reports order by and range over.
 *
 * Both are UNIQUE. Keeping two representations of one fact is a duplication,
 * and the honest defence of it is that the pair is written once, in one
 * statement, inside the same transaction that allocates it — see
 * `allocateInvoiceNumber` in repositories/retail.ts. They cannot drift because
 * nothing can write one without the other.
 *
 * ── How the integer is recovered from the old text ────────────────────────
 * The longest all-digit SUFFIX of `invoice_no`. That is exactly right for every
 * shape the old generator could produce — 'RS-00001', 'RS00001', a prefix the
 * shop changed to something with a digit in it like 'RS2-00001' — because the
 * counter was always zero-padded onto the end and the peel stops at the first
 * character from the right that is not a digit.
 *
 * The recursive CTE below accumulates that suffix one character at a time, so a
 * row contributes '1', '01', '001', '0001', '00001'. Every one of those casts
 * to the same integer, which is why taking MAX() over them is safe and gives
 * the full number rather than a truncated one.
 *
 * It is idempotent by construction: run against numbers that are already bare
 * integers, the peel returns them unchanged.
 *
 * ── Why the UNIQUE INDEX is the safety net, not a comment ─────────────────
 * An `invoice_no` with no trailing digits at all cannot be produced by any
 * version of this application, but a hand-edited database could hold one. Such
 * a row casts to 0. If there is more than one, the UNIQUE index below fails to
 * build, this migration rolls back whole, and the database stays at version 11
 * with a named error — which is the correct outcome. A silent collision is the
 * one thing that must not happen here.
 *
 * ── The prefix moves to display time ──────────────────────────────────────
 * `invoice_sequences.prefix` is emptied and the sequence stops taking one. A
 * prefix is now a display setting (`invoice.display.prefix`, default empty), so
 * putting 'RS-' back later is a settings change and never another migration —
 * the stored number does not move. `retail.invoicePrefix`, which used to feed
 * the generator, is emptied for the same reason: leaving 'RS-' in a row that
 * nothing reads is how it gets believed again later.
 */
export const migration012: Migration = {
  version: 12,
  name: 'invoice-integer',
  up: `
    -- NOT NULL DEFAULT 0 rather than a table rebuild. retail_sale_items holds an
    -- ON DELETE CASCADE reference to retail_sales, and PRAGMA foreign_keys is ON
    -- and cannot be turned off inside the migration runner's transaction — so
    -- dropping the parent table would cascade every line item on the way past.
    -- ADD COLUMN touches nothing else, and the UNIQUE index below is what makes
    -- the 0 default unable to survive.
    ALTER TABLE retail_sales ADD COLUMN invoice_number INTEGER NOT NULL DEFAULT 0;

    WITH RECURSIVE peel(id, rest, digits) AS (
      SELECT id, invoice_no, '' FROM retail_sales
      UNION ALL
      SELECT id,
             substr(rest, 1, length(rest) - 1),
             substr(rest, length(rest), 1) || digits
        FROM peel
       WHERE length(rest) > 0
         AND substr(rest, length(rest), 1) BETWEEN '0' AND '9'
    )
    UPDATE retail_sales
       SET invoice_number = (
             SELECT MAX(CAST(peel.digits AS INTEGER))
               FROM peel
              WHERE peel.id = retail_sales.id
           );

    CREATE UNIQUE INDEX ux_retail_sales_invoice_number
      ON retail_sales (invoice_number);

    -- The text column becomes the same number, bare. The customer's paper says
    -- "RS-00001" and this row now says "1"; they are the same invoice, and the
    -- shop can put the prefix back at display time whenever it wants to.
    UPDATE retail_sales SET invoice_no = CAST(invoice_number AS TEXT);

    -- Carry on from the highest number ever handed out. MAX of the two sources,
    -- because the counter can legitimately be AHEAD of the highest stored row:
    -- a sale that was rolled back after its bump, or a held sale later deleted,
    -- burns a number and that number must stay burned.
    UPDATE invoice_sequences
       SET prefix = '',
           next_number = MAX(
             next_number,
             COALESCE((SELECT MAX(invoice_number) FROM retail_sales), 0) + 1
           )
     WHERE key = 'retail';

    -- No sequence row yet means no sale has ever been posted, so the counter
    -- starts where it always did. Written explicitly rather than left to the
    -- allocator's lazy insert, so the prefix is '' from the very first sale.
    INSERT INTO invoice_sequences (key, prefix, next_number)
    SELECT 'retail', '', 1
     WHERE NOT EXISTS (SELECT 1 FROM invoice_sequences WHERE key = 'retail');

    -- The old generator prefix. Emptied, not deleted: a shop that had set it to
    -- something other than 'RS-' should see that it is no longer in force.
    UPDATE app_settings SET value = '' WHERE key = 'retail.invoicePrefix';

    -- Indexes the Retail Sale Report ranges over. The date index already exists
    -- from 005; these two are the composites that let a date range filtered by
    -- status, and a customer's history within a range, be served without a scan.
    CREATE INDEX idx_retail_sales_date_status
      ON retail_sales (sale_date, status);
    CREATE INDEX idx_retail_sales_customer_date
      ON retail_sales (customer_id, sale_date);
  `,
}
