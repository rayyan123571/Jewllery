import { randomUUID } from 'node:crypto'
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
  invoice_no: string
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
    invoiceNo: row.invoice_no,
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
  post(entry: NewWholesaleEntry): WholesaleEntryWithLines {
    const db = this.conn.get()
    const id = randomUUID()
    const createdAt = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO wholesale_entries
           (id, branch_id, party_id, kind, invoice_no, entry_date,
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
        entry.invoiceNo,
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

  findByInvoiceNo(branchId: string, invoiceNo: string): WholesaleEntryWithLines | null {
    const row = this.conn
      .get()
      .prepare(
        'SELECT id FROM wholesale_entries WHERE branch_id = ? AND invoice_no = ? COLLATE NOCASE',
      )
      .get(branchId, invoiceNo) as { id: string } | undefined
    return row ? this.findById(row.id) : null
  }

  /**
   * The next free slip number.
   *
   * Derived from the highest existing number rather than from a counter,
   * because a counter and the table can drift apart after a restore — the
   * restored database would happily hand out a number already on a printed
   * slip. The unique index is the real guarantee; this only picks a sensible
   * starting point.
   */
  nextInvoiceNo(branchId: string, prefix: string): string {
    const row = this.conn
      .get()
      .prepare(
        `SELECT invoice_no FROM wholesale_entries
          WHERE branch_id = ? AND invoice_no LIKE ?
          ORDER BY LENGTH(invoice_no) DESC, invoice_no DESC
          LIMIT 1`,
      )
      .get(branchId, `${prefix}%`) as { invoice_no: string } | undefined

    const START = 10_001
    if (!row) return `${prefix}${START}`

    const digits = /(\d+)\s*$/.exec(row.invoice_no)
    const next = digits ? Number(digits[1]) + 1 : START
    return `${prefix}${next}`
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
