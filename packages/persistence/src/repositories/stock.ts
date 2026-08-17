import { randomUUID } from 'node:crypto'
import {
  Katt,
  Money,
  Weight,
  toIsoTimestamp,
  type Clock,
  type StockBucket,
  type StockBucketTotals,
  type StockMovement,
  type StockMovementKind,
} from '@jewellery/domain'
import type {
  NewStockMovement,
  StockLedgerRepository,
  StockMovementFilter,
} from '@jewellery/application'
import type { DatabaseProvider } from '../Database.js'

/**
 * The stock ledger. Append-only: this class has exactly one INSERT and no
 * UPDATE or DELETE, which is the storage-level form of the rule that stock is
 * a ledger, not a number. Purchases write their own movement rows inside their
 * posting transaction (see purchase.ts); this repository is the door for
 * everything else — adjustments, openings, melts — and for every read.
 */

interface MovementRow {
  id: string
  branch_id: string
  at: string
  kind: string
  bucket: string
  gross_mg: number
  khalis_mg: number
  katt_milli_ratti: number | null
  rate_per_tola_paisa: number | null
  ref_type: string | null
  ref_id: string | null
  item_name: string | null
  note: string | null
  created_by_user_id: string
  created_at: string
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    branchId: row.branch_id,
    at: toIsoTimestamp(row.at),
    kind: row.kind as StockMovementKind,
    bucket: row.bucket as StockBucket,
    gross: Weight.fromMilligrams(row.gross_mg),
    khalis: Weight.fromMilligrams(row.khalis_mg),
    katt: row.katt_milli_ratti === null ? null : Katt.fromMilliRatti(row.katt_milli_ratti),
    ratePerTola:
      row.rate_per_tola_paisa === null ? null : Money.fromPaisa(row.rate_per_tola_paisa),
    refType: row.ref_type,
    refId: row.ref_id,
    itemName: row.item_name,
    note: row.note,
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
  }
}

export class SqliteStockLedgerRepository implements StockLedgerRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  append(movement: NewStockMovement): StockMovement {
    const id = randomUUID()
    const stamp = toIsoTimestamp(this.clock.now())
    this.conn
      .get()
      .prepare(
        `INSERT INTO stock_ledger
           (id, branch_id, at, kind, bucket, gross_mg, khalis_mg,
            katt_milli_ratti, rate_per_tola_paisa, ref_type, ref_id,
            item_name, note, created_by_user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        movement.branchId,
        stamp,
        movement.kind,
        movement.bucket,
        movement.gross.milligrams,
        movement.khalis.milligrams,
        movement.katt?.milliRatti ?? null,
        movement.ratePerTola?.paisa ?? null,
        movement.refType,
        movement.refId,
        movement.itemName,
        movement.note,
        movement.createdByUserId,
        stamp,
      )
    const row = this.conn.get().prepare('SELECT * FROM stock_ledger WHERE id = ?').get(id) as
      | MovementRow
      | undefined
    if (!row) throw new Error(`Stock movement ${id} vanished immediately after appending`)
    return toMovement(row)
  }

  /**
   * Oldest first, so a running balance accumulates down the list. The rowid
   * tie-break makes same-millisecond rows deterministic, exactly as the
   * gold-rate lookup does.
   */
  list(filter: StockMovementFilter): StockMovement[] {
    const clauses = ['branch_id = ?']
    const params: unknown[] = [filter.branchId]

    if (filter.fromDate) {
      clauses.push("substr(at, 1, 10) >= ?")
      params.push(filter.fromDate)
    }
    if (filter.toDate) {
      clauses.push("substr(at, 1, 10) <= ?")
      params.push(filter.toDate)
    }
    if (filter.bucket) {
      clauses.push('bucket = ?')
      params.push(filter.bucket)
    }
    if (filter.kind) {
      clauses.push('kind = ?')
      params.push(filter.kind)
    }

    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM stock_ledger
          WHERE ${clauses.join(' AND ')}
          ORDER BY at ASC, created_at ASC, rowid ASC`,
      )
      .all(...params) as MovementRow[]
    return rows.map(toMovement)
  }

  forRef(refType: string, refId: string): StockMovement[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM stock_ledger
          WHERE ref_type = ? AND ref_id = ?
          ORDER BY at ASC, created_at ASC, rowid ASC`,
      )
      .all(refType, refId) as MovementRow[]
    return rows.map(toMovement)
  }

  /** SUM per bucket, computed fresh on every ask. Never stored anywhere. */
  summary(branchId: string): StockBucketTotals[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT bucket,
                COALESCE(SUM(gross_mg), 0)  AS gross,
                COALESCE(SUM(khalis_mg), 0) AS khalis
           FROM stock_ledger
          WHERE branch_id = ?
          GROUP BY bucket`,
      )
      .all(branchId) as { bucket: string; gross: number; khalis: number }[]
    return rows.map((row) => ({
      bucket: row.bucket as StockBucket,
      gross: Weight.fromMilligrams(row.gross),
      khalis: Weight.fromMilligrams(row.khalis),
    }))
  }
}
