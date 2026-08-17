import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import {
  Katt,
  Money,
  Weight,
  toIsoDate,
  toIsoTimestamp,
  type Clock,
  type PurchaseEntry,
  type PurchaseEntryWithLines,
  type PurchaseLineItem,
  type PurchaseStatus,
  type StockBucket,
} from '@jewellery/domain'
import type { NewPurchaseEntry, PurchaseNeighbours, PurchaseRepository } from '@jewellery/application'
import type { DatabaseProvider } from '../Database.js'

/**
 * Purchases, their lines, and the stock movements they produce.
 *
 * The one thing to keep in mind reading this: `post` writes the header, every
 * line AND every stock_ledger row in ONE transaction, with the invoice number
 * allocated inside it. A half-written purchase would leave stock permanently
 * wrong with nothing pointing at the cause, and a number taken outside the
 * transaction could be handed to two terminals at once.
 *
 * `cancel` never deletes: the reversing stock rows are new rows with the
 * opposite sign, written in the same transaction that flips the status.
 */

interface EntryRow {
  id: string
  branch_id: string
  party_id: string
  invoice_number: number
  entry_date: string
  status: string
  rate_per_tola_paisa: number
  total_gross_mg: number
  total_khalis_mg: number
  total_amount_paisa: number
  notes: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
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
  bucket: string
  remarks: string | null
}

function toEntry(row: EntryRow): PurchaseEntry {
  return {
    id: row.id,
    branchId: row.branch_id,
    partyId: row.party_id,
    invoiceNumber: row.invoice_number,
    entryDate: toIsoDate(row.entry_date),
    status: row.status as PurchaseStatus,
    ratePerTola: Money.fromPaisa(row.rate_per_tola_paisa),
    totalGross: Weight.fromMilligrams(row.total_gross_mg),
    totalKhalis: Weight.fromMilligrams(row.total_khalis_mg),
    totalAmount: Money.fromPaisa(row.total_amount_paisa),
    notes: row.notes,
    cancelledAt: row.cancelled_at === null ? null : toIsoTimestamp(row.cancelled_at),
    cancelReason: row.cancel_reason,
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

function toLine(row: LineRow): PurchaseLineItem {
  return {
    id: row.id,
    lineNo: row.line_no,
    itemName: row.item_name,
    gross: Weight.fromMilligrams(row.gross_mg),
    katt: Katt.fromMilliRatti(row.katt_milli_ratti),
    khalis: Weight.fromMilligrams(row.khalis_mg),
    ratePerTola: Money.fromPaisa(row.rate_per_tola_paisa),
    amount: Money.fromPaisa(row.amount_paisa),
    bucket: row.bucket as StockBucket,
    remarks: row.remarks,
  }
}

const INSERT_MOVEMENT = `
  INSERT INTO stock_ledger
    (id, branch_id, at, kind, bucket, gross_mg, khalis_mg,
     katt_milli_ratti, rate_per_tola_paisa, ref_type, ref_id,
     item_name, note, created_by_user_id, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

export class SqlitePurchaseRepository implements PurchaseRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  /**
   * The next number in the purchase book, taken inside the caller's
   * transaction. A held purchase being posted keeps the number it took when it
   * was held, so no allocation happens on that path at all.
   */
  private allocateNumber(db: BetterSqlite3.Database): number {
    const row = db
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'purchase'")
      .get() as { next_number: number } | undefined

    if (!row) {
      const START = 1
      db.prepare(
        'INSERT INTO invoice_sequences (key, prefix, next_number) VALUES (?,?,?)',
      ).run('purchase', '', START + 1)
      return START
    }

    db.prepare(
      "UPDATE invoice_sequences SET next_number = next_number + 1 WHERE key = 'purchase'",
    ).run()
    return row.next_number
  }

  post(entry: NewPurchaseEntry): PurchaseEntryWithLines {
    const db = this.conn.get()
    const stamp = toIsoTimestamp(this.clock.now())
    let id = ''

    const run = db.transaction(() => {
      if (entry.heldId) {
        id = this.repostHeld(db, entry, entry.heldId, stamp)
      } else {
        id = randomUUID()
        const invoiceNumber = this.allocateNumber(db)
        db.prepare(
          `INSERT INTO purchase_entries
             (id, branch_id, party_id, invoice_number, entry_date, status,
              rate_per_tola_paisa, total_gross_mg, total_khalis_mg, total_amount_paisa,
              notes, cancelled_at, cancel_reason, created_by_user_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)`,
        ).run(
          id,
          entry.branchId,
          entry.partyId,
          invoiceNumber,
          entry.entryDate,
          entry.status,
          entry.ratePerTola.paisa,
          entry.totalGross.milligrams,
          entry.totalKhalis.milligrams,
          entry.totalAmount.paisa,
          entry.notes,
          entry.createdByUserId,
          stamp,
          stamp,
        )
        this.insertLines(db, entry, id)
      }

      // Only POSTED touches stock. A held purchase has not happened yet.
      if (entry.status === 'posted') {
        this.insertMovements(db, entry, id, stamp)
      }
    })

    run()
    const posted = this.findById(id)
    if (!posted) throw new Error(`Purchase ${id} vanished immediately after posting`)
    return posted
  }

  /**
   * Saving over a HELD purchase: same row, same number, fresh lines.
   *
   * Replacing a held slip is not an edit of posted history — a held slip has
   * written nothing to any ledger, so its lines are still the operator's
   * scratchpad. The one thing it keeps is the number it burned when held.
   */
  private repostHeld(
    db: BetterSqlite3.Database,
    entry: NewPurchaseEntry,
    heldId: string,
    stamp: string,
  ): string {
    const held = db
      .prepare('SELECT id, status FROM purchase_entries WHERE id = ?')
      .get(heldId) as { id: string; status: string } | undefined
    if (!held) throw new Error(`No such held purchase: ${heldId}`)
    if (held.status !== 'held') {
      throw new Error(`Purchase ${heldId} is ${held.status}, not held`)
    }

    db.prepare(
      `UPDATE purchase_entries
          SET party_id = ?, entry_date = ?, status = ?,
              rate_per_tola_paisa = ?, total_gross_mg = ?, total_khalis_mg = ?,
              total_amount_paisa = ?, notes = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      entry.partyId,
      entry.entryDate,
      entry.status,
      entry.ratePerTola.paisa,
      entry.totalGross.milligrams,
      entry.totalKhalis.milligrams,
      entry.totalAmount.paisa,
      entry.notes,
      stamp,
      heldId,
    )
    db.prepare('DELETE FROM purchase_line_items WHERE purchase_id = ?').run(heldId)
    this.insertLines(db, entry, heldId)
    return heldId
  }

  private insertLines(db: BetterSqlite3.Database, entry: NewPurchaseEntry, id: string): void {
    const insertLine = db.prepare(
      `INSERT INTO purchase_line_items
         (id, purchase_id, branch_id, line_no, item_name, gross_mg,
          katt_milli_ratti, khalis_mg, rate_per_tola_paisa, amount_paisa, bucket, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        line.bucket,
        line.remarks,
      )
    }
  }

  /** One PURCHASE_IN row per line, each carrying its own katt and rate. */
  private insertMovements(
    db: BetterSqlite3.Database,
    entry: NewPurchaseEntry,
    purchaseId: string,
    stamp: string,
  ): void {
    const insert = db.prepare(INSERT_MOVEMENT)
    for (const line of entry.lines) {
      insert.run(
        randomUUID(),
        entry.branchId,
        stamp,
        'PURCHASE_IN',
        line.bucket,
        line.gross.milligrams,
        line.khalis.milligrams,
        line.katt.milliRatti,
        line.ratePerTola.paisa,
        'purchase',
        purchaseId,
        line.itemName,
        null,
        entry.createdByUserId,
        stamp,
      )
    }
  }

  /**
   * Cancels a purchase. Status flips on the SAME row — the number stays
   * burned — and, for a posted one, every line gets a reversing stock row in
   * the same transaction. The original stock rows are never touched, so the
   * ledger shows the purchase, the cancellation, and a net of zero.
   */
  cancel(id: string, reason: string): PurchaseEntryWithLines {
    const db = this.conn.get()
    const stamp = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM purchase_entries WHERE id = ?')
        .get(id) as EntryRow | undefined
      if (!existing) throw new Error(`No such purchase: ${id}`)
      if (existing.status === 'cancelled') {
        throw new Error(`Purchase ${id} is already cancelled`)
      }

      if (existing.status === 'posted') {
        const lines = db
          .prepare('SELECT * FROM purchase_line_items WHERE purchase_id = ? ORDER BY line_no')
          .all(id) as LineRow[]
        const insert = db.prepare(INSERT_MOVEMENT)
        for (const line of lines) {
          insert.run(
            randomUUID(),
            existing.branch_id,
            stamp,
            'PURCHASE_IN',
            line.bucket,
            -line.gross_mg,
            -line.khalis_mg,
            line.katt_milli_ratti,
            line.rate_per_tola_paisa,
            'purchase',
            id,
            line.item_name,
            `Reversal of purchase ${existing.invoice_number}: ${reason}`,
            existing.created_by_user_id,
            stamp,
          )
        }
      }

      db.prepare(
        `UPDATE purchase_entries
            SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
          WHERE id = ?`,
      ).run(stamp, reason, stamp, id)
    })

    run()
    const cancelled = this.findById(id)
    if (!cancelled) throw new Error(`Purchase ${id} vanished immediately after cancelling`)
    return cancelled
  }

  findById(id: string): PurchaseEntryWithLines | null {
    const db = this.conn.get()
    const row = db.prepare('SELECT * FROM purchase_entries WHERE id = ?').get(id) as
      | EntryRow
      | undefined
    if (!row) return null

    const lines = db
      .prepare('SELECT * FROM purchase_line_items WHERE purchase_id = ? ORDER BY line_no')
      .all(id) as LineRow[]
    return { entry: toEntry(row), lines: lines.map(toLine) }
  }

  /** By the number printed on it. A cancelled purchase still answers. */
  findByNumber(branchId: string, invoiceNumber: number): PurchaseEntryWithLines | null {
    const row = this.conn
      .get()
      .prepare(
        'SELECT id FROM purchase_entries WHERE branch_id = ? AND invoice_number = ?',
      )
      .get(branchId, invoiceNumber) as { id: string } | undefined
    return row ? this.findById(row.id) : null
  }

  /**
   * Where the four navigation controls can go from `current`. Cancelled
   * purchases are skipped unless asked for — their numbers leave a visible
   * gap, which is what tells the operator one was taken back.
   */
  neighbours(
    branchId: string,
    current: number | null,
    includeCancelled: boolean,
  ): PurchaseNeighbours {
    const db = this.conn.get()
    const cancelledClause = includeCancelled ? '' : " AND status != 'cancelled'"
    const scope = `FROM purchase_entries WHERE branch_id = ?${cancelledClause}`

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

  /** A PREVIEW of the next number. Reserves nothing, burns nothing. */
  peekNextNumber(): number {
    const row = this.conn
      .get()
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'purchase'")
      .get() as { next_number: number } | undefined
    return row?.next_number ?? 1
  }

  listRecent(branchId: string, limit: number): PurchaseEntry[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM purchase_entries
          WHERE branch_id = ?
          ORDER BY entry_date DESC, created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(branchId, limit) as EntryRow[]
    return rows.map(toEntry)
  }
}
