import {
  Katt,
  Weight,
  computePieceFigures,
  isPieceStatus,
  parsePurity,
  toIsoDate,
  type Item,
  type Piece,
  type PieceEvent,
  type PublicUser,
  type StockLocation,
} from '@jewellery/domain'
import type {
  ItemRepository,
  LocationRepository,
  OpeningLineInput,
  PieceFilter,
  PieceService,
} from '@jewellery/application'
import type {
  InventorySetupResult,
  InventorySummaryDto,
  OpeningLinePreviewDto,
  OpeningPostRequest,
  OpeningPostResult,
  OpeningPreviewDto,
  PieceDto,
  PieceHistoryDto,
  PieceListRequest,
} from '../shared/ipc.js'
import type { Session } from './session.js'

/**
 * The piece boundary, with no Electron anywhere in the file.
 *
 * Same rules as every handler file: nothing throws across the gap, every
 * figure and label is preformatted here — the tag, the category path, the
 * status said as words, a history line as a sentence.
 */

export interface PieceHandlerDeps {
  readonly branchId: string
  readonly pieces: PieceService
  readonly items: ItemRepository
  readonly locations: LocationRepository
  readonly session: Session
}

function requireUser(deps: PieceHandlerDeps): PublicUser {
  const user = deps.session.user
  if (!user) throw new Error('No user is signed in.')
  return user
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** "ISSUED_TO_KARIGAR" → "Issued to karigar". */
function statusWords(status: string): string {
  const words = status.replaceAll('_', ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function sourceWords(piece: Piece): string {
  switch (piece.sourceType) {
    case 'OPENING':
      return 'Opening stock'
    case 'PURCHASE':
      return 'Purchase'
    case 'KARIGAR_RECEIPT':
      return 'Karigar receipt'
  }
}

function pieceDto(
  deps: PieceHandlerDeps,
  piece: Piece,
  item: Item | null,
  locationName: (id: string | null) => string,
): PieceDto {
  return {
    id: piece.id,
    tagDisplay: String(piece.tagNumber),
    itemCode: item?.code ?? '',
    itemName: item?.name ?? '',
    categoryLabel: deps.pieces.categoryPath(item?.categoryId ?? null),
    purityDisplay: item ? `${item.purity.slice(1)}K` : '—',
    grossDisplay: piece.gross.format(),
    stoneDisplay: piece.stone.format(),
    stoneCount: piece.stoneCount,
    netDisplay: piece.net.format(),
    kattDisplay: piece.katt.format(),
    khalisDisplay: piece.khalis.format(),
    locationId: piece.locationId,
    locationName: locationName(piece.locationId),
    status: piece.status,
    statusDisplay: statusWords(piece.status),
    sourceDisplay: sourceWords(piece),
    createdDisplay: `${piece.createdAt.slice(0, 10)}`,
  }
}

function locationNamer(deps: PieceHandlerDeps): (id: string | null) => string {
  const byId = new Map<string, StockLocation>(
    deps.locations.list(deps.branchId, true).map((location) => [location.id, location]),
  )
  return (id) => (id ? (byId.get(id)?.name ?? '—') : '—')
}

export function inventorySummary(deps: PieceHandlerDeps, groupBy: string): InventorySummaryDto {
  const empty: InventorySummaryDto = {
    groupBy: 'category',
    rows: [],
    totalCount: 0,
    totalGrossDisplay: '0.000',
    totalKhalisDisplay: '0.000',
    valuationDisplay: null,
    valuationRateDisplay: null,
    valuationAtDisplay: '',
  }
  try {
    requireUser(deps)
    const grouping =
      groupBy === 'location' || groupBy === 'supplier' ? groupBy : ('category' as const)
    const summary = deps.pieces.summary(deps.branchId, grouping)
    return {
      groupBy: grouping,
      rows: summary.rows.map((row) => ({
        label: row.label,
        filter: { status: 'IN_STOCK', ...serialisableFilter(row.filter) },
        count: row.count,
        grossDisplay: row.gross.format(),
        khalisDisplay: row.khalis.format(),
      })),
      totalCount: summary.totalCount,
      totalGrossDisplay: summary.totalGross.format(),
      totalKhalisDisplay: summary.totalKhalis.format(),
      valuationDisplay: summary.valuation ? `Rs ${summary.valuation.formatWhole()}` : null,
      valuationRateDisplay: summary.valuationRatePerTola
        ? `Rs ${summary.valuationRatePerTola.formatWhole()} / tola (24K)`
        : null,
      valuationAtDisplay: `${summary.valuationAt.slice(0, 10)} ${summary.valuationAt.slice(11, 16)}`,
    }
  } catch {
    return empty
  }
}

/** Keeps only the fields the wire contract carries, absent-vs-null intact. */
function serialisableFilter(filter: Partial<PieceFilter>): PieceListRequest {
  const out: Record<string, unknown> = {}
  if ('categoryId' in filter) out['categoryId'] = filter.categoryId
  if ('purity' in filter && filter.purity !== undefined) out['purity'] = filter.purity
  if ('locationId' in filter) out['locationId'] = filter.locationId
  if ('supplierId' in filter) out['supplierId'] = filter.supplierId
  return out as PieceListRequest
}

export function pieceList(deps: PieceHandlerDeps, request: PieceListRequest): PieceDto[] {
  try {
    requireUser(deps)
    const filter: PieceFilter = { branchId: deps.branchId }
    const mutable = filter as {
      status?: PieceFilter['status']
      itemId?: string
      categoryId?: string | null
      purity?: PieceFilter['purity']
      locationId?: string | null
      supplierId?: string | null
    }
    if (request.status && isPieceStatus(request.status)) mutable.status = request.status
    if (request.itemId !== undefined) mutable.itemId = request.itemId
    if ('categoryId' in request) mutable.categoryId = request.categoryId ?? null
    if (request.purity !== undefined) mutable.purity = parsePurity(request.purity)
    if ('locationId' in request) mutable.locationId = request.locationId ?? null
    if ('supplierId' in request) mutable.supplierId = request.supplierId ?? null

    const name = locationNamer(deps)
    return deps.pieces
      .list(filter)
      .map((piece) => pieceDto(deps, piece, deps.items.findById(piece.itemId), name))
  } catch {
    return []
  }
}

export function pieceHistory(deps: PieceHandlerDeps, pieceId: string): PieceHistoryDto | null {
  try {
    requireUser(deps)
    const piece = deps.pieces.findById(pieceId)
    if (!piece) return null
    const name = locationNamer(deps)
    const item = deps.items.findById(piece.itemId)

    const eventText = (event: PieceEvent): string => {
      switch (event.kind) {
        case 'CREATED':
          return (
            `Created — ${event.note ?? 'entered'}` +
            (event.toLocationId ? ` (${name(event.toLocationId)})` : '')
          )
        case 'MOVED':
          return `Moved: ${name(event.fromLocationId)} → ${name(event.toLocationId)}`
        case 'STATUS_CHANGED':
          return (
            `Status: ${statusWords(event.fromStatus ?? '')} → ` +
            `${statusWords(event.toStatus ?? '')}` +
            (event.note ? ` — ${event.note}` : '')
          )
      }
    }

    return {
      piece: pieceDto(deps, piece, item, name),
      events: deps.pieces.history(pieceId).map((event) => ({
        atDisplay: `${event.at.slice(0, 10)} ${event.at.slice(11, 16)}`,
        text: eventText(event),
      })),
    }
  } catch {
    return null
  }
}

export function pieceMove(
  deps: PieceHandlerDeps,
  pieceId: string,
  locationId: string | null,
): InventorySetupResult {
  try {
    deps.pieces.movePiece(requireUser(deps), pieceId, locationId)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

export function openingNextTag(deps: PieceHandlerDeps): string {
  try {
    requireUser(deps)
    return String(deps.pieces.peekNextTag())
  } catch {
    return '—'
  }
}

/** A row that is genuinely blank contributes nothing — not even an error. */
function isBlank(line: OpeningPostRequest['lines'][number]): boolean {
  return !line.itemCode.trim() && !line.grossGrams.trim() && !line.tagText.trim()
}

interface ParsedLine {
  readonly input: OpeningLineInput
  readonly item: Item
}

function parseLine(
  deps: PieceHandlerDeps,
  line: OpeningPostRequest['lines'][number],
): ParsedLine {
  const code = line.itemCode.trim()
  if (!code) throw new Error('Needs an item code.')
  const item = deps.items.findByCode(deps.branchId, code)
  if (!item) throw new Error(`No item has the code ${code.toUpperCase()}.`)
  if (!item.isActive) throw new Error(`${item.code} is deactivated.`)

  const tagText = line.tagText.trim()
  if (tagText && !/^\d+$/.test(tagText)) throw new Error('A tag is a number.')
  const stoneCountText = line.stoneCountText.trim()
  if (stoneCountText && !/^\d+$/.test(stoneCountText)) {
    throw new Error('Stone count is a whole number.')
  }

  const gross = Weight.parse(line.grossGrams || '0')
  const stone = line.stoneGrams.trim() ? Weight.parse(line.stoneGrams) : Weight.ZERO
  const katt = line.kattRatti.trim() ? Katt.parse(line.kattRatti) : null
  // Validates stone ≤ gross with the domain's own message.
  computePieceFigures({ gross, stone, katt: katt ?? item.defaultKatt })

  return {
    item,
    input: {
      tagNumber: tagText ? Number(tagText) : null,
      itemCode: code,
      gross,
      stone,
      stoneCount: stoneCountText ? Number(stoneCountText) : 0,
      katt,
      locationId: line.locationId,
    },
  }
}

export function openingPreview(
  deps: PieceHandlerDeps,
  request: OpeningPostRequest,
): OpeningPreviewDto {
  const lines: OpeningLinePreviewDto[] = []
  let grossMg = 0
  let khalisMg = 0
  let count = 0

  try {
    requireUser(deps)
  } catch {
    return { lines: [], count: 0, grossTotalDisplay: '0.000', khalisTotalDisplay: '0.000' }
  }

  let nextTag = deps.pieces.peekNextTag()
  for (const line of request.lines) {
    if (isBlank(line)) continue
    try {
      const { input, item } = parseLine(deps, line)
      const katt = input.katt ?? item.defaultKatt
      const figures = computePieceFigures({ gross: input.gross, stone: input.stone, katt })
      if (input.gross.isZero) throw new Error('Needs a gross weight.')
      count += 1
      grossMg += input.gross.milligrams
      khalisMg += figures.khalis.milligrams
      lines.push({
        tagDisplay: input.tagNumber !== null ? String(input.tagNumber) : `next: ${nextTag++}`,
        itemName: item.name,
        kattDisplay: katt.format(),
        netDisplay: figures.net.format(),
        khalisDisplay: figures.khalis.format(),
        error: null,
      })
    } catch (error) {
      lines.push({
        tagDisplay: line.tagText,
        itemName: '',
        kattDisplay: line.kattRatti,
        netDisplay: '—',
        khalisDisplay: '—',
        error: messageOf(error),
      })
    }
  }

  return {
    lines,
    count,
    grossTotalDisplay: Weight.fromMilligrams(grossMg).format(),
    khalisTotalDisplay: Weight.fromMilligrams(khalisMg).format(),
  }
}

export function openingPost(
  deps: PieceHandlerDeps,
  request: OpeningPostRequest,
): OpeningPostResult {
  try {
    const actor = requireUser(deps)
    const rows = request.lines.filter((line) => !isBlank(line))
    const parsed = rows.map((line, index) => {
      try {
        return parseLine(deps, line).input
      } catch (error) {
        throw new Error(`Row ${index + 1}: ${messageOf(error)}`)
      }
    })

    const created = deps.pieces.postOpeningStock(actor, {
      branchId: deps.branchId,
      entryDate: toIsoDate(request.entryDate),
      lines: parsed,
      notes: request.notes,
    })

    const khalisMg = created.reduce((sum, piece) => sum + piece.khalis.milligrams, 0)
    return {
      ok: true,
      count: created.length,
      khalisTotalDisplay: Weight.fromMilligrams(khalisMg).format(),
    }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}
