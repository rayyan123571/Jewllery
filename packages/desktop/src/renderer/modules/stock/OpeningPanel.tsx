import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { DateField } from '../../components/DateField.js'
import { useMessages } from '../../components/Messages.js'
import type {
  LocationDto,
  OpeningLineDto,
  OpeningPreviewDto,
} from '../../../shared/ipc.js'

/**
 * Opening stock: what the shop already holds, entered piece by piece.
 *
 * The purchase grid's feel — Enter walks down a column, Tab off the last cell
 * opens a new row — over piece columns. Nothing here is a purchase: the rows
 * post as OPENING ledger rows carrying the one date the opening is true for,
 * and they never mix with bought goods.
 *
 * Khalis is computed and read-only, from NET (gross − stone) and katt — a
 * stone is not gold, and a khalis that contradicts the scale cannot be typed.
 */

const EMPTY_ROW: OpeningLineDto = {
  tagText: '',
  itemCode: '',
  grossGrams: '',
  stoneGrams: '',
  stoneCountText: '',
  kattRatti: '',
  locationId: null,
}

/** The typeable columns, in tab order. Net and khalis are computed. */
const COLUMNS = ['tagText', 'itemCode', 'grossGrams', 'stoneGrams', 'stoneCountText', 'kattRatti'] as const

export function OpeningPanel({
  today,
  onPosted,
}: {
  today: string
  onPosted: () => void
}) {
  const [rows, setRows] = useState<OpeningLineDto[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }])
  const [entryDate, setEntryDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<OpeningPreviewDto | null>(null)
  const [locations, setLocations] = useState<readonly LocationDto[]>([])
  const [nextTag, setNextTag] = useState('—')
  const [busy, setBusy] = useState(false)
  const { push } = useMessages()

  const cells = useRef(new Map<string, HTMLInputElement | null>())
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)

  useEffect(() => {
    void window.api.inventoryLocations(false).then(setLocations)
    void window.api.openingNextTag().then(setNextTag)
  }, [])

  const request = useMemo(
    () => ({ entryDate, lines: rows, notes: notes.trim() ? notes : null }),
    [entryDate, rows, notes],
  )

  useEffect(() => {
    void window.api.openingPreview(request).then(setPreview)
  }, [request])

  useEffect(() => {
    if (!pendingFocus) return
    cells.current.get(pendingFocus)?.focus()
    setPendingFocus(null)
  }, [pendingFocus, rows.length])

  const setRow = (index: number, patch: Partial<OpeningLineDto>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = useCallback(() => setRows((c) => [...c, { ...EMPTY_ROW }]), [])
  const clearRows = useCallback(() => setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]), [])
  const deleteRow = (index: number): void =>
    setRows((current) =>
      current.length <= 1 ? [{ ...EMPTY_ROW }] : current.filter((_, i) => i !== index),
    )

  const onCellKeyDown = (
    rowIndex: number,
    columnIndex: number,
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const below = cells.current.get(`${rowIndex + 1}:${columnIndex}`)
      below?.focus()
      below?.select()
      return
    }
    const lastCell = rowIndex === rows.length - 1 && columnIndex === COLUMNS.length - 1
    if (event.key === 'Tab' && !event.shiftKey && lastCell) {
      event.preventDefault()
      addRow()
      setPendingFocus(`${rowIndex + 1}:0`)
    }
  }

  const save = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.api.openingPost(request)
      if (!result.ok) {
        push('bad', result.message)
        return
      }
      push(
        'ok',
        `Opening stock posted: ${result.count} piece${result.count === 1 ? '' : 's'}, ` +
          `${result.khalisTotalDisplay} g khalis into FINISHED — dated ${entryDate}, ` +
          `never mixed with purchases.`,
      )
      clearRows()
      setNotes('')
      await window.api.openingNextTag().then(setNextTag)
      onPosted()
    } finally {
      setBusy(false)
    }
  }, [busy, request, entryDate, clearRows, onPosted, push])

  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'opening.row.add': addRow,
      'opening.row.clear': clearRows,
      'opening.save': () => void save(),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [addRow, clearRows, save])

  const cell = (rowIndex: number, columnIndex: number) => ({
    ref: (node: HTMLInputElement | null) => {
      cells.current.set(`${rowIndex}:${columnIndex}`, node)
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) =>
      onCellKeyDown(rowIndex, columnIndex, event),
  })

  return (
    <div className="panel__body">
      <p className="callout">
        The shop is not starting empty. Enter every piece it already holds — its own
        weight, its own katt, its own tag. These post as OPENING rows dated once, and the
        next free tag is {nextTag}; leave TAG blank to take numbers from there.
      </p>

      <div className="field-row">
        <DateField
          value={entryDate}
          onChange={setEntryDate}
          label="Opening date"
          ariaLabel="Opening date"
        />
        <label className="field">
          <span className="field__label">Notes</span>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Counted at go-live"
            aria-label="Opening notes"
          />
        </label>
        <span className="toolbar__end">
          <Action id="opening.row.add" variant="toolbar">
            <Icon name="plus" size={16} /> Add Row
          </Action>
          <Action id="opening.row.clear" variant="toolbar">
            <Icon name="cross" size={16} /> Clear Row
          </Action>
          <Action id="opening.save" variant="primary" busy={busy} onActivate={() => void save()}>
            <Icon name="save" size={16} /> Post Opening Stock
          </Action>
        </span>
      </div>

      <div className="table-scroll">
        <table className="grid grid--fixed">
          <colgroup>
            <col className="col--katt" />
            <col className="col--rate" />
            <col />
            <col className="col--gross" />
            <col className="col--gross" />
            <col className="col--index" />
            <col className="col--katt" />
            <col className="col--khalis" />
            <col className="col--rate" />
            <col className="col--action" />
          </colgroup>
          <thead>
            <tr>
              <th className="numeric">Tag</th>
              <th>Item Code</th>
              <th>Item</th>
              <th className="numeric">Gross g</th>
              <th className="numeric">Stone g</th>
              <th className="numeric">Ct</th>
              <th className="numeric">Katt r/t</th>
              <th className="numeric">Khalis g</th>
              <th>Location</th>
              <th className="grid__action">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const computed = preview?.lines[index]
              return (
                <tr key={index} className={computed?.error ? 'row--error' : undefined}>
                  <td>
                    <input
                      className="input input--cell input--numeric"
                      value={row.tagText}
                      onChange={(e) => setRow(index, { tagText: e.target.value })}
                      placeholder="auto"
                      inputMode="numeric"
                      aria-label={`Tag row ${index + 1}`}
                      {...cell(index, 0)}
                    />
                  </td>
                  <td>
                    <input
                      className="input input--cell"
                      value={row.itemCode}
                      onChange={(e) => setRow(index, { itemCode: e.target.value })}
                      placeholder="e.g. R-114"
                      aria-label={`Item code row ${index + 1}`}
                      {...cell(index, 1)}
                    />
                  </td>
                  {/* Resolved from the code — typing stays on the keyboard. */}
                  <td className="muted" title={computed?.error ?? undefined}>
                    {computed?.itemName || '—'}
                  </td>
                  <td>
                    <input
                      className="input input--cell input--numeric"
                      value={row.grossGrams}
                      onChange={(e) => setRow(index, { grossGrams: e.target.value })}
                      placeholder="0.000"
                      inputMode="decimal"
                      aria-label={`Gross weight row ${index + 1}`}
                      {...cell(index, 2)}
                    />
                  </td>
                  <td>
                    <input
                      className="input input--cell input--numeric"
                      value={row.stoneGrams}
                      onChange={(e) => setRow(index, { stoneGrams: e.target.value })}
                      placeholder="0.000"
                      inputMode="decimal"
                      aria-label={`Stone weight row ${index + 1}`}
                      {...cell(index, 3)}
                    />
                  </td>
                  <td>
                    <input
                      className="input input--cell input--numeric"
                      value={row.stoneCountText}
                      onChange={(e) => setRow(index, { stoneCountText: e.target.value })}
                      placeholder="0"
                      inputMode="numeric"
                      aria-label={`Stone count row ${index + 1}`}
                      {...cell(index, 4)}
                    />
                  </td>
                  <td>
                    <input
                      className="input input--cell input--numeric"
                      value={row.kattRatti}
                      onChange={(e) => setRow(index, { kattRatti: e.target.value })}
                      placeholder="item's"
                      inputMode="decimal"
                      aria-label={`Katt row ${index + 1}`}
                      {...cell(index, 5)}
                    />
                  </td>
                  {/* Computed from NET × katt. Cannot be typed. */}
                  <td className="numeric muted">{computed?.khalisDisplay ?? '—'}</td>
                  <td>
                    <select
                      className="input input--cell"
                      value={row.locationId ?? ''}
                      onChange={(e) => setRow(index, { locationId: e.target.value || null })}
                      aria-label={`Location row ${index + 1}`}
                    >
                      <option value="">—</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="grid__action">
                    <Action
                      id="opening.row.delete"
                      variant="icon"
                      className="is-danger"
                      ariaLabel={`Delete row ${index + 1}`}
                      onActivate={() => deleteRow(index)}
                    >
                      <Icon name="trash" size={16} />
                    </Action>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total — {preview?.count ?? 0} pieces</td>
              <td className="numeric">{preview?.grossTotalDisplay ?? '0.000'}</td>
              <td />
              <td />
              <td />
              <td className="numeric">{preview?.khalisTotalDisplay ?? '0.000'}</td>
              <td />
              <td className="grid__action" />
            </tr>
          </tfoot>
        </table>
      </div>

      {preview?.lines.some((l) => l.error) ? (
        <p className="hint hint--bad">{preview.lines.find((l) => l.error)?.error}</p>
      ) : null}
    </div>
  )
}
