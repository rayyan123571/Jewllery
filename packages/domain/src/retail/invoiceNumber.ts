/**
 * How an invoice number is shown, and how one typed by hand is read back.
 *
 * The stored number is a bare integer — 1, 2, 3 — and it is the shop's only
 * identifier for a document it has already handed to a customer. It is never
 * reset and never reused, so nothing in this file may ever change one: these
 * are a display function and its exact inverse, not arithmetic.
 *
 * The prefix is a SETTING (`invoice.display.prefix`), applied here at the last
 * moment and stored nowhere. That is the whole reason the migration to integers
 * is a one-off: a shop that later wants "RS-" back sets the key, every screen
 * and every printed document picks it up, and not one stored row moves.
 */

/**
 * The number as the operator reads it. Empty prefix gives a bare integer.
 *
 * No padding. "RS-00001" padded to five places so the numbers lined up in a
 * column of text; a report that right-aligns tabular figures lines them up
 * without inventing four zeros, and the shop asked to see 1, not 00001.
 */
export function formatInvoiceNo(invoiceNumber: number, displayPrefix: string): string {
  return `${displayPrefix}${invoiceNumber}`
}

/**
 * The integer inside whatever the operator typed, or null.
 *
 * The longest all-digit SUFFIX — the same rule migration 012 used to recover
 * these numbers from the old text, and for the same reason. It means every one
 * of these finds invoice 7:
 *
 *   "7"  ·  "RS-7"  ·  "RS-00007"  ·  " 7 "
 *
 * so a search box keeps working across the change of format, whatever prefix
 * the shop has set and whatever was printed on the paper in the customer's
 * hand. Anything with no trailing digits at all is null rather than 0 — 0 is a
 * number that could match a row, and "not a number" must not.
 */
export function parseInvoiceNumber(text: string): number | null {
  const digits = /(\d+)\s*$/.exec(text.trim())?.[1]
  if (digits === undefined) return null
  const value = Number(digits)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
