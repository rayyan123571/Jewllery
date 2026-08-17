import {
  Money,
  Weight,
  computePieceFigures,
  toIsoTimestamp,
  type Clock,
  type IsoDate,
  type IsoTimestamp,
  type Item,
  type Katt,
  type Piece,
  type PieceEvent,
  type PublicUser,
  type Purity,
} from '@jewellery/domain'
import type {
  AuditRepository,
  ItemCategoryRepository,
  ItemRepository,
  LocationRepository,
  NewPiece,
  PartyRepository,
  PieceFilter,
  PieceRepository,
  PieceSummaryGroup,
} from '../abstractions/repositories.js'
import type { RateService } from '../rates/RateService.js'
import { ValidationError } from '../auth/AuthService.js'

/**
 * The pieces: creating them at go-live, reading them the way the shopkeeper
 * does every morning, and walking one piece's history.
 *
 * Every figure this service reports is a COUNT or a SUM over piece rows,
 * computed at the moment of asking. The atomicity — piece plus ledger row,
 * one transaction — is the repository's; what this service owns is the
 * validation said as sentences, the grouping, and the audit trail.
 */

export interface PieceDependencies {
  readonly pieces: PieceRepository
  readonly items: ItemRepository
  readonly itemCategories: ItemCategoryRepository
  readonly locations: LocationRepository
  readonly parties: PartyRepository
  readonly audit: AuditRepository
  readonly rates: RateService
  readonly clock: Clock
}

export interface OpeningLineInput {
  /** Null takes the next tag from the book; a number keeps an existing tag. */
  readonly tagNumber: number | null
  /** The item CODE as typed — resolved here, so the grid can be typed blind. */
  readonly itemCode: string
  readonly gross: Weight
  readonly stone: Weight
  readonly stoneCount: number
  /** Null falls back to the item's default katt. */
  readonly katt: Katt | null
  readonly locationId: string | null
}

export interface OpeningStockInput {
  readonly branchId: string
  /** The one date the opening is TRUE for. Every ledger row carries it. */
  readonly entryDate: IsoDate
  readonly lines: readonly OpeningLineInput[]
  readonly notes: string | null
}

export type SummaryGrouping = 'category' | 'location' | 'supplier'

export interface InventorySummaryRow {
  readonly label: string
  /** The exact filter that answers "which pieces are behind this row". */
  readonly filter: Partial<PieceFilter>
  readonly count: number
  readonly gross: Weight
  readonly khalis: Weight
}

export interface InventorySummary {
  readonly groupBy: SummaryGrouping
  readonly rows: readonly InventorySummaryRow[]
  readonly totalCount: number
  readonly totalGross: Weight
  readonly totalKhalis: Weight
  readonly valuation: Money | null
  readonly valuationRatePerTola: Money | null
  readonly valuationAt: IsoTimestamp
}

export class PieceService {
  constructor(private readonly deps: PieceDependencies) {}

  /**
   * Enters what the shop already holds. OPENING ledger rows, dated once, and
   * never mixed with purchases — nothing was bought and nobody was paid.
   */
  postOpeningStock(actor: PublicUser, input: OpeningStockInput): Piece[] {
    if (input.lines.length === 0) {
      throw new ValidationError('Opening stock needs at least one piece.')
    }

    const seenTags = new Set<number>()
    const pieces: NewPiece[] = input.lines.map((line, index) => {
      const rowNo = index + 1
      const item = this.requireItemByCode(input.branchId, line.itemCode, rowNo)
      if (line.gross.isZero || line.gross.isNegative) {
        throw new ValidationError(`Row ${rowNo} has no gross weight.`)
      }
      if (line.tagNumber !== null) {
        if (seenTags.has(line.tagNumber)) {
          throw new ValidationError(`Tag ${line.tagNumber} appears twice in this entry.`)
        }
        seenTags.add(line.tagNumber)
        const existing = this.deps.pieces.findByTag(input.branchId, line.tagNumber)
        if (existing) {
          throw new ValidationError(
            `Tag ${line.tagNumber} is already tied on another piece. Leave the tag ` +
              `blank to take the next number.`,
          )
        }
      }
      if (line.locationId !== null && !this.deps.locations.findById(line.locationId)) {
        throw new ValidationError(`Row ${rowNo}'s location no longer exists.`)
      }

      const katt = line.katt ?? item.defaultKatt
      const figures = computePieceFigures({ gross: line.gross, stone: line.stone, katt })
      return {
        branchId: input.branchId,
        tagNumber: line.tagNumber,
        itemId: item.id,
        gross: line.gross,
        stone: line.stone,
        stoneCount: line.stoneCount,
        net: figures.net,
        katt,
        khalis: figures.khalis,
        locationId: line.locationId,
        sourceType: 'OPENING',
        sourceId: null,
        createdByUserId: actor.id,
      }
    })

    const created = this.deps.pieces.createBatch(pieces, {
      kind: 'OPENING',
      // The opening is a fact about ONE date — the day the books started —
      // so the ledger rows carry it rather than the moment of typing.
      at: toIsoTimestamp(new Date(`${input.entryDate}T00:00:00.000Z`)),
      note: input.notes?.trim() ? input.notes.trim() : 'Opening stock',
    })

    this.deps.audit.append({
      branchId: input.branchId,
      userId: actor.id,
      action: 'OPENING_STOCK_POSTED',
      entity: 'pieces',
      entityId: created[0]?.id ?? null,
      detail: JSON.stringify({
        entryDate: input.entryDate,
        count: created.length,
        khalisMg: created.reduce((sum, piece) => sum + piece.khalis.milligrams, 0),
      }),
    })
    return created
  }

  /**
   * The morning screen: QUANTITY · GROSS · KHALIS, grouped as asked, over
   * IN_STOCK pieces only. One GROUP BY from the repository, regrouped here,
   * so switching the grouping never re-reads the database differently.
   */
  summary(branchId: string, groupBy: SummaryGrouping): InventorySummary {
    const groups = this.deps.pieces.summaryGroups(branchId)
    const merged = new Map<
      string,
      { label: string; filter: Partial<PieceFilter>; count: number; grossMg: number; khalisMg: number }
    >()

    for (const group of groups) {
      const { key, label, filter } = this.rowKeyOf(groupBy, group)
      const row = merged.get(key) ?? { label, filter, count: 0, grossMg: 0, khalisMg: 0 }
      row.count += group.count
      row.grossMg += group.grossMg
      row.khalisMg += group.khalisMg
      merged.set(key, row)
    }

    const rows: InventorySummaryRow[] = [...merged.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((row) => ({
        label: row.label,
        filter: row.filter,
        count: row.count,
        gross: Weight.fromMilligrams(row.grossMg),
        khalis: Weight.fromMilligrams(row.khalisMg),
      }))

    const totalCount = rows.reduce((sum, row) => sum + row.count, 0)
    const totalGross = Weight.sum(rows.map((row) => row.gross))
    const totalKhalis = Weight.sum(rows.map((row) => row.khalis))

    const rate =
      this.deps.rates.rateOn(branchId, 'K24', this.deps.rates.today())?.ratePerTola ?? null

    return {
      groupBy,
      rows,
      totalCount,
      totalGross,
      totalKhalis,
      valuation: rate ? Money.valueOfAtTolaRate(totalKhalis, rate) : null,
      valuationRatePerTola: rate,
      valuationAt: toIsoTimestamp(this.deps.clock.now()),
    }
  }

  list(filter: PieceFilter): Piece[] {
    return this.deps.pieces.list(filter)
  }

  findById(id: string): Piece | null {
    return this.deps.pieces.findById(id)
  }

  history(pieceId: string): PieceEvent[] {
    return this.deps.pieces.events(pieceId)
  }

  peekNextTag(): number {
    return this.deps.pieces.peekNextTag()
  }

  itemOf(piece: Piece): Item | null {
    return this.deps.items.findById(piece.itemId)
  }

  movePiece(actor: PublicUser, pieceId: string, locationId: string | null): Piece {
    const piece = this.deps.pieces.findById(pieceId)
    if (!piece) throw new ValidationError('No such piece.')
    if (piece.status !== 'IN_STOCK') {
      throw new ValidationError(
        `Tag ${piece.tagNumber} is ${piece.status.replaceAll('_', ' ').toLowerCase()} — ` +
          `only a piece in stock can be re-shelved.`,
      )
    }
    if (locationId !== null && !this.deps.locations.findById(locationId)) {
      throw new ValidationError('That location no longer exists.')
    }
    const moved = this.deps.pieces.moveTo(pieceId, locationId, actor.id)
    this.deps.audit.append({
      branchId: piece.branchId,
      userId: actor.id,
      action: 'PIECE_MOVED',
      entity: 'pieces',
      entityId: pieceId,
      detail: JSON.stringify({ from: piece.locationId, to: locationId }),
    })
    return moved
  }

  // ── grouping keys ─────────────────────────────────────────────────────────

  private rowKeyOf(
    groupBy: SummaryGrouping,
    group: PieceSummaryGroup,
  ): { key: string; label: string; filter: Partial<PieceFilter> } {
    switch (groupBy) {
      case 'category': {
        const key = `${group.categoryId ?? '~none'}|${group.purity}`
        return {
          key,
          label: `${this.categoryPath(group.categoryId)} · ${purityLabel(group.purity)}`,
          filter: { categoryId: group.categoryId, purity: group.purity },
        }
      }
      case 'location': {
        const key = group.locationId ?? '~none'
        const location = group.locationId
          ? this.deps.locations.findById(group.locationId)
          : null
        return {
          key,
          label: location?.name ?? 'No location',
          filter: { locationId: group.locationId },
        }
      }
      case 'supplier': {
        const key = group.supplierId ?? '~none'
        const supplier = group.supplierId
          ? this.deps.parties.findById(group.supplierId)
          : null
        return {
          key,
          label: supplier?.name ?? 'No supplier',
          filter: { supplierId: group.supplierId },
        }
      }
    }
  }

  categoryPath(categoryId: string | null): string {
    if (!categoryId) return 'Not filed'
    const category = this.deps.itemCategories.findById(categoryId)
    if (!category) return 'Not filed'
    if (!category.parentId) return category.name
    const parent = this.deps.itemCategories.findById(category.parentId)
    return parent ? `${parent.name} › ${category.name}` : category.name
  }

  private requireItemByCode(branchId: string, code: string, rowNo: number): Item {
    const trimmed = code.trim()
    if (trimmed.length === 0) {
      throw new ValidationError(`Row ${rowNo} needs an item code.`)
    }
    const item = this.deps.items.findByCode(branchId, trimmed)
    if (!item) {
      throw new ValidationError(
        `Row ${rowNo}: no item has the code ${trimmed.toUpperCase()}. Add it on the ` +
          `Items tab first.`,
      )
    }
    if (!item.isActive) {
      throw new ValidationError(
        `Row ${rowNo}: ${item.code} is deactivated. Reactivate it to tag new pieces.`,
      )
    }
    return item
  }
}

function purityLabel(purity: Purity): string {
  return `${purity.slice(1)}K`
}
