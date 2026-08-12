import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { GhostInput } from '../../components/GhostInput.js'
import { Icon } from '../../shell/Icon.js'
import type {
  RetailItemDto,
  RetailLineDto,
  WeightDto,
  WeightUnit,
} from '../../../shared/ipc.js'

/**
 * The items grid — the ONLY place an item is entered.
 *
 * There is no separate DETAILS form any more, and its absence is the point.
 * A form beside a table means every line has two representations and a moment
 * where they disagree: the row in the table, and the copy loaded into the form
 * that nobody has written back yet. That moment is what the unresolved-edit
 * refusal existed to police, and policing it correctly is harder than not
 * creating it. Typing into the cell IS the edit.
 *
 * ── Two sources, and which one wins where ─────────────────────────────────
 * `items` is what the operator TYPED — the input, exactly as it will be sent.
 * `lines` is what main COMPUTED from it. Editable cells render from `items`,
 * so a keystroke is never round-tripped through a calculation before it comes
 * back on screen and the caret never jumps. Derived cells render from `lines`,
 * because they are answers rather than input.
 *
 * The renderer computes nothing. Net Weight, Polish and Amount are read out of
 * `lines` and formatted; the only arithmetic here is `deductionOf`, which is a
 * subtraction of two integers main already handed over, and it is display only.
 */

/** How many columns fit before the grid starts scrolling sideways. */
export const VISIBLE_COLUMNS = 4

const PURITY_OPTIONS = ['K24', 'K22', 'K21', 'K18'] as const

/** A cell that takes a number. Everything but the name and the mode toggle. */
type Kind = 'text' | 'number' | 'derived' | 'rate' | 'labour' | 'action'

interface RowSpec {
  readonly key: string
  readonly label: string
  readonly kind: Kind
  /** True where the label carries the current unit, e.g. "Weight (Tola)". */
  readonly unitLabel?: boolean
}

/**
 * The rows, in the order the operator reads them down a column.
 *
 * Derived rows sit immediately under the figures that produce them: Net Weight
 * under the three weights it is the difference of, Polish under the percentage,
 * Amount at the foot. That ordering is what lets the column be checked by eye
 * without knowing the formula.
 */
export const ROWS: readonly RowSpec[] = [
  { key: 'itemName', label: 'Item Name', kind: 'text' },
  { key: 'gross', label: 'Weight', kind: 'number', unitLabel: true },
  { key: 'stone', label: 'Stone', kind: 'number', unitLabel: true },
  { key: 'deduction', label: 'Purity Deduction', kind: 'number', unitLabel: true },
  { key: 'net', label: 'Net Weight', kind: 'derived', unitLabel: true },
  { key: 'polishPercent', label: 'Polish %', kind: 'number' },
  { key: 'polish', label: 'Polish', kind: 'derived', unitLabel: true },
  { key: 'labour', label: 'Labour Charges', kind: 'labour' },
  { key: 'stoneCharges', label: 'Stone Charges', kind: 'number' },
  { key: 'rate', label: 'Rate (PKR)', kind: 'rate' },
  { key: 'amount', label: 'Amount (PKR)', kind: 'derived' },
  { key: 'action', label: 'Action', kind: 'action' },
]

/** Rows a caret can land on. Derived cells and the action row are skipped. */
const EDITABLE_ROWS = ROWS.map((row, index) => ({ row, index })).filter(
  ({ row }) => row.kind !== 'derived' && row.kind !== 'action',
)
const FIRST_EDITABLE = EDITABLE_ROWS[0]?.index ?? 0
const LAST_EDITABLE = EDITABLE_ROWS[EDITABLE_ROWS.length - 1]?.index ?? 0

/** The next editable row in a direction, or null at the end. */
function stepRow(from: number, delta: 1 | -1): number | null {
  for (let row = from + delta; row >= 0 && row < ROWS.length; row += delta) {
    const spec = ROWS[row]
    if (spec && spec.kind !== 'derived' && spec.kind !== 'action') return row
  }
  return null
}

function cellId(row: number, column: number): string {
  return `r${row}c${column}`
}

export interface ItemsGridProps {
  readonly items: readonly RetailItemDto[]
  readonly lines: readonly RetailLineDto[]
  readonly unit: WeightUnit
  readonly locked: boolean
  /** Set once after ADD ITEM, so the new column takes the caret exactly once. */
  readonly focusLast: boolean
  readonly onFocusedLast: () => void
  readonly onPatch: (index: number, patch: Partial<RetailItemDto>) => void
  /** Called when the blank trailing column is typed into. Appends a real item. */
  readonly onAppend: (patch: Partial<RetailItemDto>) => void
  readonly onDelete: (index: number) => void
  readonly onPrint: (index: number) => void
  readonly onAddItem: () => void
  readonly customerNames: readonly string[]
}

export function ItemsGrid({
  items,
  lines,
  unit,
  locked,
  focusLast,
  onFocusedLast,
  onPatch,
  onAppend,
  onDelete,
  onPrint,
  onAddItem,
  customerNames,
}: ItemsGridProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  /** The value a cell held when it took focus, so Esc has something to revert to. */
  const beforeEdit = useRef<string>('')

  const unitWord = unit === 'tola' ? 'Tola' : 'Gram'
  /**
   * Real items plus exactly ONE blank column, ready for entry.
   *
   * Not four placeholders. A grid padded out with empty slots says nothing
   * about how many items are on the bill — the operator has to count the filled
   * ones — and it makes the header count meaningless. One blank column is an
   * invitation; three more are noise.
   */
  const columns = items.length + (locked ? 0 : 1)

  // Stable: it reads refs only. An unstable `focus` in the effect below would
  // re-run it every render and steal the caret back while the operator types.
  const focus = useCallback((row: number, column: number): void => {
    const target = grid.current?.querySelector<HTMLElement>(
      `[data-cell="${cellId(row, column)}"]`,
    )
    if (!target) return
    target.focus()
    if (target instanceof HTMLInputElement) target.select()
    // Keep the column in view when the caret walks past the fourth one.
    // Feature-detected: jsdom has no scrollIntoView, and a grid that throws in
    // a test harness is a grid nobody can test the keyboard model of.
    const holder = target.closest('.item-column')
    if (holder && typeof holder.scrollIntoView === 'function') {
      holder.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [])

  /**
   * ADD ITEM appends a column; the caret follows it. Runs once per press.
   *
   * `focus` and `onFocusedLast` are deliberately not dependencies: `focus`
   * closes over refs only, and including the callback would re-run this on
   * every render of the parent and steal the caret back mid-typing.
   */
  useEffect(() => {
    if (!focusLast) return
    focus(FIRST_EDITABLE, Math.max(0, items.length - 1))
    onFocusedLast()
  }, [focusLast, items.length, focus, onFocusedLast])

  /**
   * The whole keyboard model, in one place.
   *
   * A counter operator works this grid two-handed with no mouse, so the moves
   * are the ones a ledger implies rather than the ones a web form does: Enter
   * goes DOWN the column being filled in, Tab goes ACROSS to the same field of
   * the next item. Derived cells are skipped in every direction because there
   * is nothing to do in them, and stopping on one would make the operator press
   * the key twice for no reason.
   */
  const onCellKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    row: number,
    column: number,
  ): void => {
    const { key, shiftKey } = event

    if (key === 'Escape') {
      event.preventDefault()
      const target = event.target
      if (target instanceof HTMLInputElement) {
        target.value = beforeEdit.current
        commit(row, column, beforeEdit.current)
      }
      return
    }

    if (key === 'Enter' || key === 'ArrowDown') {
      const next = stepRow(row, 1)
      if (next === null) return
      event.preventDefault()
      focus(next, column)
      return
    }

    if (key === 'ArrowUp') {
      const next = stepRow(row, -1)
      if (next === null) return
      event.preventDefault()
      focus(next, column)
      return
    }

    if (key === 'Tab') {
      if (shiftKey) {
        if (column === 0) return
        event.preventDefault()
        focus(row, column - 1)
        return
      }
      // Tab off the last editable cell of the last column makes a new column.
      // The alternative is the operator reaching for ADD ITEM with a mouse
      // between every item, which is the thing this grid exists to avoid.
      if (column >= columns - 1 && row === LAST_EDITABLE) {
        event.preventDefault()
        onAddItem()
        return
      }
      if (column >= columns - 1) return
      event.preventDefault()
      focus(row, column + 1)
      return
    }

    // Left and right only move between columns when the caret is at the edge of
    // the text, or typing a weight would jump out of the field mid-number.
    const atStart =
      !(event.target instanceof HTMLInputElement) || event.target.selectionStart === 0
    const atEnd =
      !(event.target instanceof HTMLInputElement) ||
      event.target.selectionEnd === event.target.value.length

    if (key === 'ArrowLeft' && atStart && column > 0) {
      event.preventDefault()
      focus(row, column - 1)
      return
    }
    if (key === 'ArrowRight' && atEnd && column < columns - 1) {
      event.preventDefault()
      focus(row, column + 1)
    }
  }

  /** Writes a cell through to the bill, appending a column if it was the blank one. */
  const commit = (row: number, column: number, value: string): void => {
    const spec = ROWS[row]
    if (!spec) return
    const patch = patchFor(spec.key, value)
    if (!patch) return
    if (column >= items.length) onAppend(patch)
    else onPatch(column, patch)
  }

  const scrollBy = (direction: 1 | -1): void => {
    const first = scroller.current?.querySelector<HTMLElement>('.item-column')
    scroller.current?.scrollBy({
      left: (first?.offsetWidth ?? 160) * direction,
      behavior: 'smooth',
    })
  }

  return (
    <div className="items-card">
      <div className="items-card__head">
        {/* The count is what tells the operator there are columns off screen.
            Without it a six-item bill and a four-item bill look identical. */}
        <span>ITEMS — {items.length}</span>
        <div className="items-card__tools">
          {items.length > VISIBLE_COLUMNS ? (
            <>
              <Action
                id="retail.items.scroll-left"
                variant="icon"
                ariaLabel="Scroll items left"
                onActivate={() => scrollBy(-1)}
              >
                <Icon name="chevron-left" size={16} />
              </Action>
              <Action
                id="retail.items.scroll-right"
                variant="icon"
                ariaLabel="Scroll items right"
                onActivate={() => scrollBy(1)}
              >
                <Icon name="chevron-right" size={16} />
              </Action>
            </>
          ) : null}
          <Action id="retail.item.add" variant="outline" className="items-card__add">
            <Icon name="plus" size={14} />
            <span>ADD ITEM</span>
          </Action>
          {/* Moved here from beside the deleted DETAILS card. It belongs with
              the weights it converts, not in a rail of unrelated buttons. */}
          <Action id="retail.unit.toggle" variant="outline" className="items-card__unit">
            <Icon name="refresh" size={14} />
            <span>Gram ⇄ Tola</span>
          </Action>
        </div>
      </div>

      <div className="items-card__body">
        {/* Frozen while the columns scroll under it. */}
        <div className="item-labels">
          <div className="item-labels__spacer" aria-hidden="true" />
          {ROWS.map((spec) => (
            <div className="item-labels__cell" key={spec.key}>
              {spec.unitLabel ? `${spec.label} (${unitWord})` : spec.label}
            </div>
          ))}
        </div>

        <div className="item-columns" ref={scroller}>
          <div className="item-columns__track" ref={grid}>
            {Array.from({ length: columns }, (_, column) => {
              const item = items[column]
              const line = lines[column]
              const isBlank = column >= items.length
              return (
                <div
                  className={`item-column${isBlank ? ' is-blank' : ''}`}
                  key={column}
                >
                  <div className="item-column__head">
                    {column + 1}. {item?.itemName?.trim() || 'Item'}
                  </div>

                  {ROWS.map((spec, row) => (
                    <Cell
                      key={spec.key}
                      spec={spec}
                      row={row}
                      column={column}
                      item={item}
                      line={line}
                      unit={unit}
                      locked={locked}
                      names={customerNames}
                      onKeyDown={onCellKeyDown}
                      onFocusCapture={(value) => {
                        beforeEdit.current = value
                      }}
                      onCommit={(value) => commit(row, column, value)}
                      onPatch={(patch) =>
                        isBlank ? onAppend(patch) : onPatch(column, patch)
                      }
                      onDelete={() => onDelete(column)}
                      onPrint={() => onPrint(column)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Maps a row key to the item field it writes. Unknown keys write nothing. */
function patchFor(key: string, value: string): Partial<RetailItemDto> | null {
  switch (key) {
    case 'itemName':
      return { itemName: value }
    // exactMg is cleared: the operator has typed, so the text is authoritative
    // again. It is only ever set by the unit toggle, which is what makes a
    // Gram ⇄ Tola flip lossless.
    case 'gross':
      return { grossWeight: { text: value, exactMg: null } }
    case 'stone':
      return { stoneWeight: { text: value, exactMg: null } }
    case 'deduction':
      return { purityDeduction: { text: value, exactMg: null } }
    case 'polishPercent':
      return { wastagePercent: value }
    case 'labour':
      return { labourCharges: value }
    case 'stoneCharges':
      return { stoneCharges: value }
    case 'rate':
      return { ratePerTola: value }
    default:
      return null
  }
}

/** What an editable cell currently holds, straight from what was typed. */
function typedValue(spec: RowSpec, item: RetailItemDto | undefined): string {
  if (!item) return ''
  switch (spec.key) {
    case 'itemName':
      return item.itemName
    case 'gross':
      return item.grossWeight.text
    case 'stone':
      return item.stoneWeight.text
    case 'deduction':
      return item.purityDeduction.text
    case 'polishPercent':
      return item.wastagePercent
    case 'labour':
      return item.labourCharges
    case 'stoneCharges':
      return item.stoneCharges
    case 'rate':
      return item.ratePerTola
    default:
      return ''
  }
}

/** What a DERIVED cell shows. Read from what main computed, never recomputed. */
function derivedValue(
  spec: RowSpec,
  line: RetailLineDto | undefined,
  unit: WeightUnit,
): string {
  if (!line) return spec.key === 'amount' ? '0.00' : '0.000'
  switch (spec.key) {
    case 'net':
      return show(line.net, unit)
    case 'polish':
      return show(line.wastage, unit)
    case 'amount':
      return line.amount.rupees
    default:
      return ''
  }
}

function show(weight: WeightDto | undefined, unit: WeightUnit): string {
  if (!weight) return '0.000'
  return unit === 'tola' ? weight.tola : weight.gram
}

function Cell({
  spec,
  row,
  column,
  item,
  line,
  unit,
  locked,
  names,
  onKeyDown,
  onFocusCapture,
  onCommit,
  onPatch,
  onDelete,
  onPrint,
}: {
  spec: RowSpec
  row: number
  column: number
  item: RetailItemDto | undefined
  line: RetailLineDto | undefined
  unit: WeightUnit
  locked: boolean
  names: readonly string[]
  onKeyDown: (event: KeyboardEvent<HTMLElement>, row: number, column: number) => void
  onFocusCapture: (value: string) => void
  onCommit: (value: string) => void
  onPatch: (patch: Partial<RetailItemDto>) => void
  onDelete: () => void
  onPrint: () => void
}) {
  const id = cellId(row, column)
  const keys = (event: KeyboardEvent<HTMLElement>): void => onKeyDown(event, row, column)

  if (spec.kind === 'derived') {
    // Parchment, no border, and NOT in the tab order. A derived cell that can
    // be focused is one an operator will try to type into, and the only thing
    // that can happen then is confusion about why nothing changed.
    return (
      <div className="item-column__cell is-derived" aria-readonly="true">
        {derivedValue(spec, line, unit)}
      </div>
    )
  }

  if (spec.kind === 'action') {
    return (
      <div className="item-column__cell item-column__actions">
        {item ? (
          <>
            <Action
              id="retail.item.print"
              variant="icon"
              ariaLabel={`Print item ${column + 1}`}
              onActivate={onPrint}
            >
              <Icon name="print" size={16} />
            </Action>
            <Action
              id="retail.item.delete"
              variant="icon"
              className="is-danger"
              ariaLabel={`Delete item ${column + 1}`}
              onActivate={onDelete}
            >
              <Icon name="trash" size={16} />
            </Action>
          </>
        ) : null}
      </div>
    )
  }

  if (spec.kind === 'text') {
    // The same prefix autocomplete the customer box uses. One implementation.
    return (
      <div className="item-column__cell is-editable">
        <GhostInput
          value={typedValue(spec, item)}
          onChange={onCommit}
          suggestions={names}
          className="cell-input"
          ariaLabel={`Item ${column + 1} name`}
          onKeyDown={keys}
          disabled={locked}
          inputProps={{
            'data-cell': id,
            onFocus: (event) => onFocusCapture(event.target.value),
          }}
        />
      </div>
    )
  }

  if (spec.kind === 'labour') {
    return (
      <div className="item-column__cell is-editable item-column__labour">
        <input
          className="cell-input numeric"
          data-cell={id}
          value={typedValue(spec, item)}
          onChange={(event) => onCommit(event.target.value)}
          onFocus={(event) => onFocusCapture(event.target.value)}
          onKeyDown={keys}
          inputMode="decimal"
          disabled={locked}
          aria-label={`Item ${column + 1} labour charges`}
        />
        {/* In-cell, because the mode belongs to the figure beside it: 900
            fixed and 900 per tola are different money on the same line. */}
        <Action
          id="retail.labour.mode"
          variant="ghost"
          className="cell-mode"
          ariaLabel={`Item ${column + 1} labour is ${
            item?.labourMode === 'per_tola' ? 'per tola' : 'a fixed amount'
          }`}
          onActivate={() =>
            onPatch({
              labourMode: item?.labourMode === 'per_tola' ? 'fixed' : 'per_tola',
            })
          }
        >
          {item?.labourMode === 'per_tola' ? '/tola' : 'fixed'}
        </Action>
      </div>
    )
  }

  if (spec.kind === 'rate') {
    return (
      <div className="item-column__cell is-editable item-column__rate">
        {/* Purity is per-item: one bill can hold a 22K chain and 18K tops. */}
        <select
          className="cell-purity"
          value={item?.purity ?? 'K22'}
          onChange={(event) => onPatch({ purity: event.target.value })}
          disabled={locked}
          aria-label={`Item ${column + 1} purity`}
        >
          {PURITY_OPTIONS.map((purity) => (
            <option key={purity} value={purity}>
              {purity.slice(1)}K
            </option>
          ))}
        </select>
        <input
          className="cell-input numeric"
          data-cell={id}
          value={typedValue(spec, item)}
          onChange={(event) => onCommit(event.target.value)}
          onFocus={(event) => onFocusCapture(event.target.value)}
          onKeyDown={keys}
          inputMode="decimal"
          disabled={locked}
          // Empty shows the rate the purity gives, so the cell is filled in
          // without the operator having to type a figure they did not choose.
          placeholder={line?.rateDisplay ?? '—'}
          aria-label={`Item ${column + 1} rate`}
        />
      </div>
    )
  }

  return (
    <div className="item-column__cell is-editable">
      <input
        className="cell-input numeric"
        data-cell={id}
        value={typedValue(spec, item)}
        onChange={(event) => onCommit(event.target.value)}
        onFocus={(event) => onFocusCapture(event.target.value)}
        onKeyDown={keys}
        inputMode="decimal"
        disabled={locked}
        aria-label={`Item ${column + 1} ${spec.label.toLowerCase()}`}
      />
    </div>
  )
}
