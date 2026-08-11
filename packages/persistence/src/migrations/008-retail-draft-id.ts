import type { Migration } from './runner.js'

/**
 * The draft a sale was posted from, so posting twice is impossible.
 *
 * "Posting is idempotent: the same draft cannot post twice" cannot be honoured
 * with a flag in memory. A double-click is the easy half; the hard half is a
 * retry after the renderer never saw the reply — the IPC call succeeded, the
 * sale is on disk, and the counter presses Save again because nothing appeared
 * to happen. An in-process guard is gone by then if the app restarted, and two
 * identical invoices for one transaction is a real accounting fault: the gold
 * leaves the shop once and the books say twice.
 *
 * A UNIQUE column is the only guard that survives a restart. The renderer mints
 * a draft id when a sale is started and sends the same one on every attempt, so
 * the second attempt collides and the service returns the sale that already
 * exists rather than writing another.
 *
 * Nullable, because held drafts and sales written before this migration have no
 * id, and SQLite's UNIQUE permits many NULLs — which is the behaviour wanted
 * here: "no draft id" is not a value that can collide with itself.
 */
export const migration008: Migration = {
  version: 8,
  name: 'retail-draft-id',
  up: `
    ALTER TABLE retail_sales ADD COLUMN draft_id TEXT NULL;

    CREATE UNIQUE INDEX idx_retail_sales_draft ON retail_sales (draft_id)
      WHERE draft_id IS NOT NULL;
  `,
}
