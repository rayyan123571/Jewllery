import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import {
  Katt,
  Weight,
  toIsoTimestamp,
  type Clock,
  type Piece,
  type PieceEvent,
  type PieceEventKind,
  type PieceSource,
  type PieceStatus,
  type Purity,
} from '@jewellery/domain'
import type {
  NewPiece,
  PieceFilter,
  PieceRepository,
  PieceSummaryGroup,
} from '@jewellery/application'
import type { DatabaseProvider } from '../Database.js'

/**
 * Pieces, their events, and the ledger rows they are never separated from.
 *
 * The one thing to keep in mind reading this: `createBatch` writes every
 * piece, its CREATED event AND its stock-ledger row in ONE transaction, tags
 * allocated inside it. There is deliberately no method that inserts a piece
 * alone — a piece without its ledger row is the silent drift between the two
 * views of the shop's gold, which is the failure the whole design exists to
 * prevent. Later stages add sell/melt/issue the same way: status flip plus
 * ledger row, one transaction, or nothing.
 */

interface PieceRow {
  id: string
  branch_id: string
  tag_number: number
  item_id: string
  gross_mg: number
  stone_mg: number
  stone_count: number
  net_mg: number
  katt_milli_ratti: number
  khalis_mg: number
  location_id: string | null
  status: string
  source_type: string
  source_id: string | null
  status_changed_at: string
  created_by_user_id: string
  created_at: string
  updated_at: string
}

interface EventRow {
  id: string
  piece_id: string
  branch_id: string
  at: string
  kind: string
  from_status: string | null
  to_status: string | null
  from_location_id: string | null
  to_location_id: string | null
  note: string | null
  created_by_user_id: string
  created_at: string
}

function toPiece(row: PieceRow): Piece {
  return {
    id: row.id,
    branchId: row.branch_id,
    tagNumber: row.tag_number,
    itemId: row.item_id,
    gross: Weight.fromMilligrams(row.gross_mg),
    stone: Weight.fromMilligrams(row.stone_mg),
    stoneCount: row.stone_count,
    net: Weight.fromMilligrams(row.net_mg),
    katt: Katt.fromMilliRatti(row.katt_milli_ratti),
    khalis: Weight.fromMilligrams(row.khalis_mg),
    locationId: row.location_id,
    status: row.status as PieceStatus,
    sourceType: row.source_type as PieceSource,
    sourceId: row.source_id,
    statusChangedAt: toIsoTimestamp(row.status_changed_at),
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }
}

function toEvent(row: EventRow): PieceEvent {
  return {
    id: row.id,
    pieceId: row.piece_id,
    branchId: row.branch_id,
    at: toIsoTimestamp(row.at),
    kind: row.kind as PieceEventKind,
    fromStatus: row.from_status as PieceStatus | null,
    toStatus: row.to_status as PieceStatus | null,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    note: row.note,
    createdByUserId: row.created_by_user_id,
    createdAt: toIsoTimestamp(row.created_at),
  }
}

export class SqlitePieceRepository implements PieceRepository {
  constructor(
    private readonly conn: DatabaseProvider,
    private readonly clock: Clock,
  ) {}

  /** The next tag, taken inside the caller's transaction — same as invoices. */
  private allocateTag(db: BetterSqlite3.Database): number {
    const row = db
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'piece_tag'")
      .get() as { next_number: number } | undefined
    if (!row) {
      const START = 1
      db.prepare(
        'INSERT INTO invoice_sequences (key, prefix, next_number) VALUES (?,?,?)',
      ).run('piece_tag', '', START + 1)
      return START
    }
    db.prepare(
      "UPDATE invoice_sequences SET next_number = next_number + 1 WHERE key = 'piece_tag'",
    ).run()
    return row.next_number
  }

  createBatch(
    pieces: readonly NewPiece[],
    movement: {
      readonly kind: 'OPENING' | 'PURCHASE_IN'
      readonly at: string
      readonly note: string | null
    },
  ): Piece[] {
    const db = this.conn.get()
    const stamp = toIsoTimestamp(this.clock.now())
    const ids: string[] = []

    const insertPiece = db.prepare(
      `INSERT INTO pieces
         (id, branch_id, tag_number, item_id, gross_mg, stone_mg, stone_count,
          net_mg, katt_milli_ratti, khalis_mg, location_id, status,
          source_type, source_id, status_changed_at, created_by_user_id,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'IN_STOCK',?,?,?,?,?,?)`,
    )
    const insertEvent = db.prepare(
      `INSERT INTO piece_events
         (id, piece_id, branch_id, at, kind, from_status, to_status,
          from_location_id, to_location_id, note, created_by_user_id, created_at)
       VALUES (?,?,?,?,'CREATED',NULL,'IN_STOCK',NULL,?,?,?,?)`,
    )
    // The FINISHED bucket is pieces, and only pieces — which is what keeps the
    // stage-3 reconciliation exact rather than approximate.
    const insertMovement = db.prepare(
      `INSERT INTO stock_ledger
         (id, branch_id, at, kind, bucket, gross_mg, khalis_mg,
          katt_milli_ratti, rate_per_tola_paisa, ref_type, ref_id,
          item_name, note, created_by_user_id, created_at)
       VALUES (?,?,?,?,'FINISHED',?,?,?,NULL,'piece',?,?,?,?,?)`,
    )
    const itemName = db.prepare('SELECT name FROM items WHERE id = ?')

    const run = db.transaction(() => {
      for (const piece of pieces) {
        const id = randomUUID()
        ids.push(id)
        const tag = piece.tagNumber ?? this.allocateTag(db)
        insertPiece.run(
          id,
          piece.branchId,
          tag,
          piece.itemId,
          piece.gross.milligrams,
          piece.stone.milligrams,
          piece.stoneCount,
          piece.net.milligrams,
          piece.katt.milliRatti,
          piece.khalis.milligrams,
          piece.locationId,
          piece.sourceType,
          piece.sourceId,
          stamp,
          piece.createdByUserId,
          stamp,
          stamp,
        )
        insertEvent.run(
          randomUUID(),
          id,
          piece.branchId,
          movement.at,
          piece.locationId,
          movement.note,
          piece.createdByUserId,
          stamp,
        )
        const name = (itemName.get(piece.itemId) as { name: string } | undefined)?.name ?? ''
        insertMovement.run(
          randomUUID(),
          piece.branchId,
          movement.at,
          movement.kind,
          piece.gross.milligrams,
          piece.khalis.milligrams,
          piece.katt.milliRatti,
          id,
          `${name} · tag ${tag}`,
          movement.note,
          piece.createdByUserId,
          stamp,
        )
      }
    })

    run()
    return ids.map((id) => {
      const created = this.findById(id)
      if (!created) throw new Error(`Piece ${id} vanished immediately after creating`)
      return created
    })
  }

  findById(id: string): Piece | null {
    const row = this.conn.get().prepare('SELECT * FROM pieces WHERE id = ?').get(id) as
      | PieceRow
      | undefined
    return row ? toPiece(row) : null
  }

  findByTag(branchId: string, tagNumber: number): Piece | null {
    const row = this.conn
      .get()
      .prepare('SELECT * FROM pieces WHERE branch_id = ? AND tag_number = ?')
      .get(branchId, tagNumber) as PieceRow | undefined
    return row ? toPiece(row) : null
  }

  list(filter: PieceFilter): Piece[] {
    const clauses = ['p.branch_id = ?']
    const params: unknown[] = [filter.branchId]

    if (filter.status !== undefined) {
      clauses.push('p.status = ?')
      params.push(filter.status)
    }
    if (filter.itemId !== undefined) {
      clauses.push('p.item_id = ?')
      params.push(filter.itemId)
    }
    if (filter.categoryId !== undefined) {
      if (filter.categoryId === null) clauses.push('i.category_id IS NULL')
      else {
        clauses.push('i.category_id = ?')
        params.push(filter.categoryId)
      }
    }
    if (filter.purity !== undefined) {
      clauses.push('i.purity = ?')
      params.push(filter.purity)
    }
    if (filter.locationId !== undefined) {
      if (filter.locationId === null) clauses.push('p.location_id IS NULL')
      else {
        clauses.push('p.location_id = ?')
        params.push(filter.locationId)
      }
    }
    if (filter.supplierId !== undefined) {
      if (filter.supplierId === null) clauses.push('i.supplier_id IS NULL')
      else {
        clauses.push('i.supplier_id = ?')
        params.push(filter.supplierId)
      }
    }

    const rows = this.conn
      .get()
      .prepare(
        `SELECT p.* FROM pieces p
          JOIN items i ON i.id = p.item_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY p.tag_number
         LIMIT ?`,
      )
      .all(...params, filter.limit ?? 500) as PieceRow[]
    return rows.map(toPiece)
  }

  summaryGroups(branchId: string): PieceSummaryGroup[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT i.category_id, i.purity, p.location_id, i.supplier_id,
                COUNT(*)         AS n,
                SUM(p.gross_mg)  AS gross,
                SUM(p.khalis_mg) AS khalis
           FROM pieces p
           JOIN items i ON i.id = p.item_id
          WHERE p.branch_id = ? AND p.status = 'IN_STOCK'
          GROUP BY i.category_id, i.purity, p.location_id, i.supplier_id`,
      )
      .all(branchId) as {
      category_id: string | null
      purity: string
      location_id: string | null
      supplier_id: string | null
      n: number
      gross: number
      khalis: number
    }[]
    return rows.map((row) => ({
      categoryId: row.category_id,
      purity: row.purity as Purity,
      locationId: row.location_id,
      supplierId: row.supplier_id,
      count: row.n,
      grossMg: row.gross,
      khalisMg: row.khalis,
    }))
  }

  inStockTotals(branchId: string): { grossMg: number; khalisMg: number } {
    const row = this.conn
      .get()
      .prepare(
        `SELECT COALESCE(SUM(gross_mg), 0) AS gross, COALESCE(SUM(khalis_mg), 0) AS khalis
           FROM pieces WHERE branch_id = ? AND status = 'IN_STOCK'`,
      )
      .get(branchId) as { gross: number; khalis: number }
    return { grossMg: row.gross, khalisMg: row.khalis }
  }

  moveTo(pieceId: string, locationId: string | null, byUserId: string): Piece {
    const db = this.conn.get()
    const stamp = toIsoTimestamp(this.clock.now())

    const run = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId) as
        | PieceRow
        | undefined
      if (!existing) throw new Error(`No such piece: ${pieceId}`)

      db.prepare('UPDATE pieces SET location_id = ?, updated_at = ? WHERE id = ?').run(
        locationId,
        stamp,
        pieceId,
      )
      db.prepare(
        `INSERT INTO piece_events
           (id, piece_id, branch_id, at, kind, from_status, to_status,
            from_location_id, to_location_id, note, created_by_user_id, created_at)
         VALUES (?,?,?,?,'MOVED',NULL,NULL,?,?,NULL,?,?)`,
      ).run(
        randomUUID(),
        pieceId,
        existing.branch_id,
        stamp,
        existing.location_id,
        locationId,
        byUserId,
        stamp,
      )
    })

    run()
    const moved = this.findById(pieceId)
    if (!moved) throw new Error(`Piece ${pieceId} vanished immediately after moving`)
    return moved
  }

  events(pieceId: string): PieceEvent[] {
    const rows = this.conn
      .get()
      .prepare(
        `SELECT * FROM piece_events
          WHERE piece_id = ?
          ORDER BY at ASC, created_at ASC, rowid ASC`,
      )
      .all(pieceId) as EventRow[]
    return rows.map(toEvent)
  }

  peekNextTag(): number {
    const row = this.conn
      .get()
      .prepare("SELECT next_number FROM invoice_sequences WHERE key = 'piece_tag'")
      .get() as { next_number: number } | undefined
    return row?.next_number ?? 1
  }
}
