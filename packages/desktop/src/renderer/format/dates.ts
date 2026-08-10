/**
 * One date format for the whole application: **DD-MM-YYYY**.
 *
 * Three formats were reaching the glass at once — `10/08/2026` from the native
 * date picker, `2026-08-10` straight off the IPC boundary, and `10 August 2026`
 * from the clock. On a screen where a slip is dated, a rate is dated and a
 * ledger row is dated, that is not a cosmetic problem: `10/08` and `08/10` are
 * both readable as the tenth of August, and only one of them is.
 *
 * The wire format does not change. Every date crossing IPC stays ISO
 * `YYYY-MM-DD`, because that is what the rate service resolves a business day
 * with and what SQLite orders correctly as text. These helpers convert at the
 * UI edge and nowhere else — the same rule money and weight already follow.
 */

/** `2026-08-10` → `10-08-2026`. Anything unparseable is returned untouched. */
export function toDisplayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return iso
  return `${match[3]}-${match[2]}-${match[1]}`
}

/**
 * `10-08-2026` → `2026-08-10`, or null when the text is not a real date.
 *
 * Null rather than a guess: a half-typed date must leave the stored value
 * alone, not post a slip against the first of January.
 */
export function fromDisplayDate(text: string): string | null {
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/** The local calendar day as ISO. Never `toISOString()` — that is UTC. */
export function isoToday(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** ISO for a Date, in the machine's own calendar. The shop PC sits in the shop. */
export function isoOf(date: Date): string {
  return date.toLocaleDateString('en-CA')
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
