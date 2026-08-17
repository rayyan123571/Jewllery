import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import {
  Katt,
  Money,
  Weight,
  toIsoDate,
  toIsoTimestamp,
  type Clock,
  type WholesaleEntry,
  type WholesaleEntryKind,
  type WholesaleEntryWithLines,
  type WholesaleLineItem,
} from '@jewellery/domain'
import type {
  NewWholesaleEntry,
  WholesaleRepository,
} from '@jewellery/application'
import type { DatabaseProvider } from '../Database.js'

/**
 * Wholesale entries, their lines, and the balances derived from them.
 *
 * The one thing to keep in mind reading this: `gold_delta_mg` is the only
 * column a balance ever sums. Everything else on the row — totals, settlement
 * portions, the stored rate — exists so the slip can be reprinted exactly as it
 * was posted. Deriving a balance from any of them instead would let the two
 * disagree.
 */

interface EntryRow {
  id: string
  branch_id: string
  party_id: string
  kind: string
  invoice_number: number
  entry_date: string
  rate_per_tola_paisa: number | null
  total_gross_mg: number
  total_khalis_mg: number
  total_amount_paisa: number
  settled_gold_mg: number
  settled_cash_paisa: number
  settled_cash_as_gold_mg: number
  gold_delta_mg: number
  cash_delta_paisa: number
  is_over_return: number
  confirmed_by_user_id: string | null
  reverses_entry_id: string | null
  reversed_by_entry_id: string | null
  notes: string | null
  created_by_user_id: string
  created_at: string
}

interface LineRow {
  id: string
  line_no: number
  item_name: string
  gross_mg: number
  katt_milli_ratti: number
  khalis_mg: number
  rate_per_tola_paisa: number
  amount_paisa: number
  remarks: string | null
}

function toEntry(row: EntryRow): WholesaleEntry {
  return {
    id: row.id,
    branchId: row.branch_id,
    partyId: row.party_id,
    kind: row.kind as WholesaleEntryKind,
    invoiceNumber: row.invoice_number,
    entryDate: toIsoDate(row.entry_date),
    ratePerTola:
      row.rate_per_tola_paisa === null ? null : Money.fromPaisa(row.rate_per_tola_paisa),
    totalGross: Weight.fromMilligrams(row.total_gross_mg),
    totalKhalis: Weight.fromMilligrams(row.total_khalis_mg),
    totalAmount: Money.fromPaisa(row.total_amount_paisa),
    settledGold: Weight.fromMilligrams(row.settled_gold_mg),
    settledCash: Money.fromPaisa(row.settled_cash_paisa),
    settledCashAsGold: Weight.fromMilligrams(row.settled_cash_as_gold_mg),
    goldDelta: Weight.fromMilligrams(row.gold_delta_mg),
    cashDelta: Money.fromPaisa(row.cash_delta_paisa),
    isOverReturn: row.is_over_return === 1,
    confirmedByUserId: row.confirmed_by_user_id,
    reversesEntryId: row.reverses_entry_id,
    reversedByEntryId: row.reversed_by_entry_id,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
  }
}

/**
 * Which sequence a slip takes its number from.
 *
 * Two books, not one. An issue and a settlement are different documents with
 * different meanings on the ledger, and a shop that asks "where is slip 4?"
 * means one of them — so each is numbered 1, 2, 3 in its own right rather than
 * sharing a counter and leaving both books full of gaps.
 */
function sequenceKeyOf(kind: WholesaleEntryKind): string {
  return kind === 'ISSUE' ? 'wholesale' : 'settlement'
}

function toLine(row: LineRow): WholesaleLineItem {
  return {
    id: row.id,
    lineNo: row.line_no,
    itemName: row.item_name,
    gross: Weight.fromMilligrams(row.gross_mg),
    katt: Katt.fromMilliRatti(row.katt_milli_ratti),
    khalis: Weight.fromMilligrams(row.khalis_mg),
    ratePerTola: Money.fromPaisa(row.rate_per_tola_paisa),
    amount: Money.fromPaisa(row.amount_paisa),
    remarks: row.remarks,
  }
}

export class SqliteWholesaleRepository implements WholesaleRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  /**
   * Header and lines in ONE transaction.
   *
   * A half-written slip would put the ledger out by whatever the missing part
   * was worth, and nothing on screen would show it. better-sqlite3's
   * `transaction()` rolls the whole thing back if any statement throws.
   */
  /**
   * The next number in a book, taken inside the caller's transaction.
   *
   * A reversal does NOT take one: it carries the number of the slip it corrects,
   * because it is the same document. That is also why the unique index on
   * (branch, kind, number) excludes reversals — two rows legitimately share a
   * number, and exactly two.
   */
  private allocateNumber(
    db: BetterSqlite3.Database,
    entry: NewWholesaleEntry,
  ): number {
    if (entry.reversesEntryId) {
      const original = db
        .prepare('SELECT invoice_number FROM wholesale_entries WHERE id = ?')
        .get(entry.reversesEntryId) as { invoice_number: number } | undefined
      if (original) return original.invoice_number
    }

    const key = sequenceKeyOf(entry.kind)
    const row = db
      .prepare('SELECT next_number FROM invoice_sequences WHERE key = ?')
      .get(key) as { next_number: number } | undefined

    if (!row) {
      const START = 1
      db.prepare(
        'INSERT INTO invoice_sequences (key, prefix, next_number) VALUES (?,?,?)',
      ).run(key, '', START + 1)
      return START
    }

    db.prepare(
      'UPDATE invoice_sequences SET next_number = next_number + 1 WHERE key = ?',
    ).run(key)
    return row.next_number
  }

  post(entry: NewWholesaleEntry): WholesaleEntryWithLines {
    const db = this.conn.get()
    const id = randomUUID()
    const createdAt = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      // Allocated HERE, inside the transaction, for the reason the retail
      // sequence is: a number read outside it can be handed to a second counter
      // before the first has written its row.
      const invoiceNumber = this.allocateNumber(db, entry)
      db.prepare(
        `INSERT INTO wholesale_entries
           (id, branch_id, party_id, kind, invoice_number, entry_date,
            rate_per_tola_paisa, total_gross_mg, total_khalis_mg, total_amount_paisa,
            settled_gold_mg, settled_cash_paisa, settled_cash_as_gold_mg,
            gold_delta_mg, cash_delta_paisa, is_over_return, confirmed_by_user_id,
            reverses_entry_id, notes, created_by_user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        entry.branchId,
        entry.partyId,
        entry.kind,
        invoiceNumber,
        entry.entryDate,
        entry.ratePerTola?.paisa ?? null,
        entry.totalGross.milligrams,
        entry.totalKhalis.milligrams,
        entry.totalAmount.paisa,
        entry.settledGold.milligrams,
        entry.settledCash.paisa,
        entry.settledCashAsGold.milligrams,
        entry.goldDelta.milligrams,
        entry.cashDelta.paisa,
        entry.isOverReturn ? 1 : 0,
        entry.confirmedByUserId,
        entry.reversesEntryId,
        entry.notes,
        entry.createdByUserId,
        createdAt,
      )

      const insertLine = db.prepare(
        `INSERT INTO wholesale_line_items
           (id, entry_id, branch_id, line_no, item_name, gross_mg,
            katt_milli_ratti, khalis_mg, rate_per_tola_paisa, amount_paisa, remarks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      for (const line of entry.lines) {
        insertLine.run(
          randomUUID(),
          id,
          entry.branchId,
          line.lineNo,
          line.itemName,
          line.gross.milligrams,
          line.katt.milliRatti,
          line.khalis.milligrams,
          line.ratePerTola.paisa,
          line.amount.paisa,
          line.remarks,
        )
      }
    })

    run()
    const posted = this.findById(id)
    if (!posted) throw new Error(`Entry ${id} vanished immediately after posting`)
    return posted
  }

  findById(id: string): WholesaleEntryWithLines | null {
    const db = this.conn.get()
    const row = db.prepare('SELECT * FROM wholesale_entries WHERE id = ?').get(id) as
      | EntryRow
      | undefined
    if (!row) return null

    const lines = db
      .prepare('SELECT * FROM wholesale_line_items WHERE entry_id = ? ORDER BY line_no')
      .all(id) as LineRow[]
    return { entry: toEntry(row), lines: lines.map(toLine) }
  }

  /**
   * One slip, by the number printed on it.
   *
   * The kind is part of the key because there are two books: an issue 1 and a
   * settlement 1 are different documents, and looking one up without saying
   * which book would be a question with two answers.
   *
   * Reversals are excluded. A reversal shares its original's number, so without
   * this a corrected slip would sometimes read back as its own correction.
   */
  findByNumber(
    branchId: string,
    kind: WholesaleEntryKind,
    invoiceNumber: number,
  ): WholesaleEntryWithLines | null {
    const row = this.conn
      .get()
      .prepare(
        `SELECT id FROM wholesale_entries
          WHERE branch_id = ? AND kind = ? AND invoice_number = ?
            AND reverses_entry_id IS NULL`,
      )
      .get(branchId, kind, invoiceNumber) as { id: string } | undefined
    return row ? this.findById(row.id) : null
  }

  /**
   * Where the four navigation controls can go from `current`.
   *
   * One query set rather than four calls, for the reason the retail one gives:
   * the toolbar needs every answer at once to know which arrows are dead, and
   * asking one at a time lets the four disagree about the same book.
   *
   * Two things this scope deliberately excludes:
   *
   *   - **Settlements and reversals.** A settlement is numbered from its own
   *     sequence and a reversal carries its original's number, so both would
   *     otherwise appear as slips the arrows could step onto. The book these
   *     arrows walk is the ISSUE book, which is what the screen edits.
   *   - **Reversed slips**, unless asked for. Like a voided invoice they are
   *     never deleted and their numbers are never reused, so hiding one leaves a
   *     visible gap — which is what tells the operator a slip was corrected.
   */
  neighbours(
    branchId: string,
    current: number | null,
    includeReversed: boolean,
  ): { first: number | null; previous: number | null; next: number | null; last: number | null } {
    const db = this.conn.get()
    const reversedClause = includeReversed ? '' : ' AND reversed_by_entry_id IS NULL'
    const scope =
      `FROM wholesale_entries WHERE branch_id = ? AND kind = 'ISSUE' ` +
      `  AND reverses_entry_id IS NULL${reversedClause}`

    const one = (sql: string, ...extra: unknown[]): number | null => {
      const row = db.prepare(sql).get(branchId, ...extra) as
        | { n: number | null }
        | undefined
      return row?.n ?? null
    }

    const first = one(`SELECT MIN(invoice_number) AS n ${scope}`)
    const last = one(`SELECT MAX(invoice_number) AS n ${scope}`)
    const previous =
      current === null
        ? last
        : one(
            `SELECT invoice_number AS n ${scope} AND invoice_number < ?
              ORDER BY invoice_number DESC LIMIT 1`,
            current,
          )
    const next =
      current === null
        ? null
        : one(
            `SELECT invoice_number AS n ${scope} AND invoice_number > ?
              ORDER BY invoice_number ASC LIMIT 1`,
            current,
          )

    return { first, previous, next, last }
  }

  /**
   * A PREVIEW of the next number in a book. Reserves nothing, burns nothing.
   *
   * Read from the sequence rather than from the highest row, so it agrees with
   * what `post` will actually allocate. A shop with no slips yet gets 1.
   */
  peekNextNumber(kind: WholesaleEntryKind): number {
    const row = this.conn
      .get()
      .prepare('SELECT next_number FROM invoice_sequences WHERE key = ?')
      .get(sequenceKeyOf(kind)) as { next_number: number } | undefined
    return row?.next_number ?? 1
  }

  balances(partyId: string): { goldMg: number; cashPaisa: number } {
    // Reversed entries still count: the reversal is itself a row with the
    // opposite delta, so the pair nets to zero. Excluding the original would
    // double-count the correction.
    const row = this.conn
      .get()
      .prepare(
        `SELECT COALESCE(SUM(gold_delta_mg), 0)    AS gold,
                COALESCE(SUM(cash_delta_paisa), 0) AS cash
           FROM wholesale_entries WHERE party_id = ?`,
      )
      .get(partyId) as { gold: number; cash: number }
    return { goldMg: row.gold, cashPaisa: row.cash }
  }

  listForParty(partyId: string, limit: number): WholesaleEntry[] {
    // Oldest first: the ledger accumulates a running balance down the page,
    // exactly as the slip's Previous → Current Issued → End Balance reads.
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM wholesale_entries
          WHERE party_id = ?
          ORDER BY entry_date ASC, created_at ASC, rowid ASC
          LIMIT ?`,
      )
      .all(partyId, limit) as EntryRow[]
    return rows.map(toEntry)
  }

  listRecent(branchId: string, limit: number): WholesaleEntry[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM wholesale_entries
          WHERE branch_id = ?
          ORDER BY entry_date DESC, created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(branchId, limit) as EntryRow[]
    return rows.map(toEntry)
  }

  markReversed(originalId: string, reversalId: string): void {
    this.conn
      .get()
      .prepare('UPDATE wholesale_entries SET reversed_by_entry_id = ? WHERE id = ?')
      .run(reversalId, originalId)
  }
}
