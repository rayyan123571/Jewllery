import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { GhostInput } from '../../components/GhostInput.js'
import { Icon } from '../../shell/Icon.js'
import type {
  RetailItemDto,
  RetailLineDto,
  WeightDto,
  WeightFieldDto,
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
type Kind =
  | 'text'
  | 'number'
  | 'derived'
  | 'rate'
  | 'labour'
  | 'deduction'
  | 'note'
  | 'action'

/** The karats the milawat selector offers, display order. */
const DEDUCTION_KARAT_OPTIONS = [24, 22, 21, 18] as const

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
  { key: 'deduction', label: 'Purity Deduction', kind: 'deduction', unitLabel: true },
  { key: 'net', label: 'Net Weight', kind: 'derived', unitLabel: true },
  { key: 'polishPercent', label: 'Polish %', kind: 'number' },
  { key: 'polish', label: 'Polish', kind: 'derived', unitLabel: true },
  { key: 'labour', label: 'Labour Charges', kind: 'labour' },
  { key: 'stoneCharges', label: 'Stone Charges', kind: 'number' },
  // The counter's own note about the piece. It is NOT on the printed slip and
  // is not meant to be — see RetailItemDto.remarks.
  { key: 'remarks', label: 'Remarks', kind: 'note' },
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
  /**
   * One pending "which karat is this?" lookup per column, keyed by column.
   *
   * Debounced the same way the whole-bill calculation is: a keystroke cancels
   * whatever lookup the previous keystroke queued, so a fast typist fires one
   * IPC round trip per pause, not one per character. `karatLookupTokens` pairs
   * with it so a reply that is still in flight when a NEWER keystroke's lookup
   * has already landed cannot overwrite it out of order.
   */
  const karatLookupTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const karatLookupTokens = useRef(new Map<number, number>())
  /** Derivations already asked for, so a re-render cannot re-ask mid-flight. */
  const derivedKaratFor = useRef(new Set<string>())

  useEffect(() => {
    const timers = karatLookupTimers.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

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
      /*
       * Tab off the LAST editable cell starts the NEXT ITEM, at its name.
       *
       * Not the same row of the next column, which is what Tab does everywhere
       * else here. Finishing Rate means finishing the item, and a ledger is
       * filled in column by column — sending the caret to the next column's
       * Rate would leave the operator typing a rate into an item with no name.
       *
       * Found by entering an invoice with the keyboard alone: because a blank
       * trailing column always exists, `column >= columns - 1` never fired on a
       * real column, so Tab from Rate landed on the BLANK column's Rate and the
       * next two items were typed into cells nobody was looking at. The amounts
       * came out 0.00 and the grid looked like it had simply ignored them.
       */
      if (row === LAST_EDITABLE) {
        event.preventDefault()
        if (column >= columns - 1) onAddItem()
        else focus(FIRST_EDITABLE, column + 1)
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
    // The reverse of `pickKarat`, and it goes through here rather than through
    // `pickKarat` itself for exactly that reason: `pickKarat` patches state
    // directly and never calls `commit`, so a picked karat cannot loop back
    // into this and re-derive itself. Only a hand-typed figure reaches here.
    if (spec.key === 'deduction') queueImpliedKarat(column, value)
  }

  /**
   * Asks main which standard karat, if any, the just-typed deduction implies
   * for this item's current net weight — the exact inverse of `pickKarat`.
   * Debounced per column; see `karatLookupTimers`.
   *
   * Never touches `purityDeduction` — the operator's own figure is never
   * overwritten by this, only the dropdown beside it.
   */
  const queueImpliedKarat = (column: number, typedValue: string): void => {
    const pending = karatLookupTimers.current.get(column)
    if (pending) clearTimeout(pending)
    const token = (karatLookupTokens.current.get(column) ?? 0) + 1
    karatLookupTokens.current.set(column, token)
    const timer = setTimeout(() => {
      karatLookupTimers.current.delete(column)
      const item = items[column]
      const empty: WeightFieldDto = { text: '', exactMg: null }
      void window.api
        .retailKaratFor({
          gross: item?.grossWeight ?? empty,
          stone: item?.stoneWeight ?? empty,
          deduction: { text: typedValue, exactMg: null },
          unit,
        })
        .then((karat) => {
          // Superseded by a keystroke whose own lookup already landed — drop
          // this one rather than let an out-of-order reply overwrite it.
          if (karatLookupTokens.current.get(column) !== token) return
          const patch = { deductionKarat: karat }
          if (column >= items.length) onAppend(patch)
          else onPatch(column, patch)
        })
        .catch(() => {
          // A failed lookup is not a matched karat. Left silent otherwise —
          // this is display-only polish on a live keystroke, not a save path
          // with something to refuse — but it must not vanish as an unhandled
          // rejection, which is what let a stale IPC channel look, on screen,
          // exactly like "nothing is close" instead of "the call never landed".
        })
    }, 120)
    karatLookupTimers.current.set(column, timer)
  }

  /**
   * Re-derives the implied karat for any item that arrived without one.
   *
   * The karat is DERIVED, not recorded, and that is what makes this the whole
   * of the fix: it is a pure function of gross, stone and the deduction, and
   * all three are already stored. So nothing about it needs a column in the
   * draft, a migration, or a field on the posted invoice — it is recomputed
   * from what was saved, wherever the items came from.
   *
   * Which matters because this screen UNMOUNTS. Switching to another module
   * and back throws the grid's state away and rebuilds it from the autosaved
   * draft (App.tsx renders one module at a time), and neither that draft nor a
   * loaded invoice carries the karat. Without this the box read blank on every
   * return, for a figure sitting right beside it that plainly implies one.
   *
   * `undefined` means "never asked"; `null` means "asked, and no karat fits".
   * Only the first is fetched, so an item that genuinely has no karat is not
   * re-asked on every render — and since every answer is written back as one
   * or the other, this can run at most once per item per figure. That is also
   * what keeps it clear of the typing path: a hand-typed figure has already
   * set the field to a defined value, so this never fires behind it.
   */
  useEffect(() => {
    const empty: WeightFieldDto = { text: '', exactMg: null }
    items.forEach((item, column) => {
      if (item.deductionKarat !== undefined) return
      // The typing path owns any column it has touched. Between a keystroke
      // and its debounce landing the karat is legitimately still unset, and
      // derivation must not read that gap as "restored without one" — it
      // would fire an undebounced lookup per character and race the typed
      // one to the answer. A token is minted synchronously on the first
      // keystroke, so this is already true by the time the effect runs.
      if (karatLookupTokens.current.has(column)) return
      const deduction = item.purityDeduction
      // Nothing typed is not a karat of nothing — leave the box blank rather
      // than spend a round trip to be told so.
      if (deduction.text.trim() === '' && deduction.exactMg === null) return

      const key = `${column}:${deduction.exactMg ?? deduction.text}`
      if (derivedKaratFor.current.has(key)) return
      derivedKaratFor.current.add(key)

      void window.api
        .retailKaratFor({
          gross: item.grossWeight ?? empty,
          stone: item.stoneWeight ?? empty,
          deduction,
          unit,
        })
        .then((karat) => onPatch(column, { deductionKarat: karat }))
        .catch(() => derivedKaratFor.current.delete(key))
    })
  }, [items, unit, onPatch])

  /**
   * The milawat selector: pick a karat and the deduction fills itself in —
   * net × (24 − k) / 24, computed by main (one tola at 22K is exactly
   * 0.972 g). A one-shot FILL, not a binding: the cell stays a typed value
   * the operator can edit, and re-picking after a weight change recomputes.
   *
   * The karat itself is kept alongside the figure — display only, so the
   * dropdown goes on showing which karat produced it instead of springing
   * back to "—" the moment the fill lands.
   */
  const pickKarat = async (column: number, karat: number): Promise<void> => {
    const item = items[column]
    const empty: WeightFieldDto = { text: '', exactMg: null }
    const result = await window.api.retailDeductionFor({
      gross: item?.grossWeight ?? empty,
      stone: item?.stoneWeight ?? empty,
      unit,
      karat,
    })
    if (!result) return
    const patch = {
      purityDeduction: {
        text: unit === 'tola' ? result.tola : result.gram,
        exactMg: result.mg,
      },
      // A whole number of karats needs no formatting — 18 shows as "18", the
      // same string the reverse direction would derive from the figure this
      // fill just wrote, so the two agree without one asking the other.
      deductionKarat: String(karat),
    }
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
                      onKarat={(karat) => void pickKarat(column, karat)}
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
    case 'remarks':
      return { remarks: value }
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
    case 'remarks':
      return item.remarks ?? ''
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
  onKarat,
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
  onKarat: (karat: number) => void
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

  if (spec.kind === 'note') {
    // Free text, and the only cell here that is not a figure or a choice. It
    // reads back exactly what was typed and goes nowhere near the arithmetic
    // or the paper.
    return (
      <div className="item-column__cell is-editable">
        <input
          className="cell-input"
          data-cell={id}
          value={typedValue(spec, item)}
          onChange={(event) => onCommit(event.target.value)}
          onFocus={(event) => onFocusCapture(event.target.value)}
          onKeyDown={keys}
          disabled={locked}
          placeholder="—"
          aria-label={`Item ${column + 1} remarks`}
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

  if (spec.kind === 'deduction') {
    /*
     * A combo, not a fixed list: it SHOWS whatever karat the typed figure
     * implies — 17.61 is a real answer for a real piece — and still OPENS the
     * four standard karats that fill the figure in for you.
     *
     * Still a <select>, deliberately. The implied karat is carried as one more
     * option, so the control keeps the size, the position, the keyboard
     * behaviour and the styling it already had; a hand-rolled popover would
     * have to re-earn all four. The extra option is added only when the
     * implied karat is NOT one of the four, so the menu never lists 18 twice.
     */
    const implied = item?.deductionKarat ?? ''
    const isStandard = (DEDUCTION_KARAT_OPTIONS as readonly number[]).includes(Number(implied))
    return (
      <div className="item-column__cell is-editable item-column__rate">
        <select
          className="cell-purity"
          value={implied}
          onChange={(event) => {
            const karat = Number(event.target.value)
            // Only the four standard karats FILL the figure in. Re-picking the
            // implied-karat option is a no-op: it is what is already on
            // screen, and acting on it would overwrite the typed figure with
            // a rounded-to-two-places version of itself.
            if ((DEDUCTION_KARAT_OPTIONS as readonly number[]).includes(karat)) onKarat(karat)
          }}
          disabled={locked}
          aria-label={`Item ${column + 1} deduction karat`}
        >
          <option value="">—</option>
          {implied !== '' && !isStandard ? <option value={implied}>{implied}K</option> : null}
          {DEDUCTION_KARAT_OPTIONS.map((karat) => (
            <option key={karat} value={karat}>
              {karat}K
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
          aria-label={`Item ${column + 1} purity deduction`}
        />
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
