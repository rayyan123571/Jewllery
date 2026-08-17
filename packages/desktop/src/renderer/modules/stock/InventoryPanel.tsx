import { useCallback, useEffect, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { Modal } from '../../components/Modal.js'
import type {
  InventorySummaryDto,
  LocationDto,
  PieceDto,
  PieceHistoryDto,
  PieceListRequest,
} from '../../../shared/ipc.js'

/**
 * The morning screen: QUANTITY · GROSS · KHALIS, readable in five seconds.
 *
 * Every figure is a COUNT or a SUM over piece rows, computed when asked.
 * Regrouping by location or supplier re-reads nothing — the same pieces,
 * folded differently. Any row drills into the pieces behind it, and any piece
 * opens its full history: purchased on, moved, issued, sold.
 */

type Grouping = 'category' | 'location' | 'supplier'

const GROUPINGS: readonly { key: Grouping; label: string }[] = [
  { key: 'category', label: 'By Category' },
  { key: 'location', label: 'By Location' },
  { key: 'supplier', label: 'By Supplier' },
]

export function InventoryPanel({ reloadKey }: { reloadKey: number }) {
  const [groupBy, setGroupBy] = useState<Grouping>('category')
  const [summary, setSummary] = useState<InventorySummaryDto | null>(null)
  /** Non-null while drilled into one summary row's pieces. */
  const [drill, setDrill] = useState<{ label: string; pieces: readonly PieceDto[] } | null>(
    null,
  )
  const [history, setHistory] = useState<PieceHistoryDto | null>(null)
  const [locations, setLocations] = useState<readonly LocationDto[]>([])
  const [moveTo, setMoveTo] = useState('')
  const { push } = useMessages()

  const refresh = useCallback(async () => {
    setSummary(await window.api.inventorySummary(groupBy))
  }, [groupBy])

  useEffect(() => {
    void refresh()
  }, [refresh, reloadKey])

  useEffect(() => {
    void window.api.inventoryLocations(false).then(setLocations)
  }, [])

  const openDrill = useCallback(async (label: string, filter: PieceListRequest) => {
    setDrill({ label, pieces: await window.api.pieceList(filter) })
  }, [])

  const openPiece = useCallback(async (pieceId: string) => {
    const found = await window.api.pieceHistory(pieceId)
    if (found) {
      setHistory(found)
      setMoveTo(found.piece.locationId ?? '')
    }
  }, [])

  const movePiece = useCallback(async () => {
    if (!history) return
    const result = await window.api.pieceMove(history.piece.id, moveTo || null)
    if (!result.ok) {
      push('bad', result.message)
      return
    }
    push('ok', `Tag ${history.piece.tagDisplay} moved.`)
    const reopened = await window.api.pieceHistory(history.piece.id)
    setHistory(reopened)
    await refresh()
    // The drill list under the modal is stale now; drop back to the summary.
    setDrill(null)
  }, [history, moveTo, refresh, push])

  return (
    <div className="panel__body">
      {drill === null ? (
        <>
          <div className="field-row">
            <span className="toolbar__end">
              {GROUPINGS.map((grouping) => (
                <Action
                  key={grouping.key}
                  id="inventory.regroup"
                  variant="tab"
                  active={groupBy === grouping.key}
                  onActivate={() => setGroupBy(grouping.key)}
                >
                  {grouping.label}
                </Action>
              ))}
            </span>
          </div>

          {summary === null || summary.rows.length === 0 ? (
            <EmptyState
              title="Nothing in stock"
              line="Pieces arrive through Opening Stock (what the shop already holds) and, from stage 4, through purchases of finished goods."
              actionId="stock.tab.opening"
              actionLabel="Enter Opening Stock"
            />
          ) : (
            <>
              <div className="table-scroll">
                <table className="grid grid--fixed">
                  <colgroup>
                    <col />
                    <col className="col--katt" />
                    <col className="col--gross" />
                    <col className="col--khalis" />
                    <col className="col--action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>{groupBy === 'category' ? 'Category · Purity' : groupBy === 'location' ? 'Location' : 'Supplier'}</th>
                      <th className="numeric">Quantity</th>
                      <th className="numeric">Gross g</th>
                      <th className="numeric">Khalis g</th>
                      <th className="grid__action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td className="numeric">{row.count}</td>
                        <td className="numeric">{row.grossDisplay}</td>
                        <td className="numeric">{row.khalisDisplay}</td>
                        <td className="grid__action">
                          <Action
                            id="inventory.drill"
                            variant="toolbar"
                            ariaLabel={`Show the pieces in ${row.label}`}
                            onActivate={() => void openDrill(row.label, row.filter)}
                          >
                            Pieces
                          </Action>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="numeric">{summary.totalCount}</td>
                      <td className="numeric">{summary.totalGrossDisplay}</td>
                      <td className="numeric">{summary.totalKhalisDisplay}</td>
                      <td className="grid__action" />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* The valuation names its rate and its moment — it is only true
                  for that instant. */}
              <div className="stat-strip">
                <div className="stat-cell">
                  <span className="stat-cell__label">Pieces in stock</span>
                  <span className="stat-cell__value">{summary.totalCount}</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-cell__label">Valuation (24K, khalis)</span>
                  <span className="stat-cell__value">
                    {summary.valuationDisplay ?? 'No 24K rate recorded'}
                  </span>
                </div>
                <div className="stat-cell">
                  <span className="stat-cell__label">At rate · as of</span>
                  <span className="stat-cell__value">
                    {summary.valuationRateDisplay
                      ? `${summary.valuationRateDisplay} · ${summary.valuationAtDisplay}`
                      : '—'}
                  </span>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="field-row">
            <Action id="inventory.back" variant="outline" onActivate={() => setDrill(null)}>
              ◀ Summary
            </Action>
            <p className="callout">
              {drill.label} — {drill.pieces.length} piece{drill.pieces.length === 1 ? '' : 's'}.
              Open one to read its history.
            </p>
          </div>
          <PieceTable pieces={drill.pieces} onOpen={(id) => void openPiece(id)} />
        </>
      )}

      {history ? (
        <Modal label={`Tag ${history.piece.tagDisplay}`} onClose={() => setHistory(null)} wide>
          <h2 className="modal__title">
            Tag {history.piece.tagDisplay} — {history.piece.itemName}
          </h2>
          <div className="field-row">
            <p className="callout">
              {history.piece.categoryLabel} · {history.piece.purityDisplay} ·{' '}
              {history.piece.statusDisplay} · {history.piece.sourceDisplay} ·{' '}
              gross {history.piece.grossDisplay} g
              {history.piece.stoneCount > 0
                ? ` (stones ${history.piece.stoneDisplay} g × ${history.piece.stoneCount})`
                : ''}{' '}
              · net {history.piece.netDisplay} g · katt {history.piece.kattDisplay} · khalis{' '}
              {history.piece.khalisDisplay} g
            </p>
          </div>

          <div className="panel__title">HISTORY</div>
          {history.events.map((event, index) => (
            <div className="summary-line" key={index}>
              <span>{event.atDisplay}</span>
              <span className="summary-line__value">{event.text}</span>
            </div>
          ))}

          {history.piece.status === 'IN_STOCK' ? (
            <div className="field-row">
              <label className="field">
                <span className="field__label">Location</span>
                <select
                  className="input"
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  aria-label="Move piece to location"
                >
                  <option value="">No location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <Action id="piece.move.save" variant="outline" onActivate={() => void movePiece()}>
                Move
              </Action>
            </div>
          ) : null}

          <div className="confirm__actions">
            <Action id="piece.close" variant="ghost" onActivate={() => setHistory(null)}>
              Close
            </Action>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function PieceTable({
  pieces,
  onOpen,
}: {
  pieces: readonly PieceDto[]
  onOpen: (pieceId: string) => void
}) {
  if (pieces.length === 0) {
    return <EmptyState title="No pieces" line="Nothing matches this slice." />
  }
  return (
    <div className="table-scroll">
      <table className="grid grid--fixed">
        <colgroup>
          <col className="col--katt" />
          <col />
          <col className="col--katt" />
          <col className="col--gross" />
          <col className="col--gross" />
          <col className="col--katt" />
          <col className="col--khalis" />
          <col className="col--rate" />
          <col className="col--action" />
        </colgroup>
        <thead>
          <tr>
            <th className="numeric">Tag</th>
            <th>Item</th>
            <th>Purity</th>
            <th className="numeric">Gross g</th>
            <th className="numeric">Net g</th>
            <th className="numeric">Katt</th>
            <th className="numeric">Khalis g</th>
            <th>Location</th>
            <th className="grid__action">Action</th>
          </tr>
        </thead>
        <tbody>
          {pieces.map((piece) => (
            <tr key={piece.id}>
              <td className="numeric">{piece.tagDisplay}</td>
              <td>
                {piece.itemCode} · {piece.itemName}
              </td>
              <td>{piece.purityDisplay}</td>
              <td className="numeric">{piece.grossDisplay}</td>
              <td className="numeric">{piece.netDisplay}</td>
              <td className="numeric">{piece.kattDisplay}</td>
              <td className="numeric">{piece.khalisDisplay}</td>
              <td>{piece.locationName}</td>
              <td className="grid__action">
                <Action
                  id="piece.open"
                  variant="toolbar"
                  ariaLabel={`Open tag ${piece.tagDisplay}`}
                  onActivate={() => onOpen(piece.id)}
                >
                  History
                </Action>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
