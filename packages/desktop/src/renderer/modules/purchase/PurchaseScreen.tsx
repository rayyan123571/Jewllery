import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { DateField } from '../../components/DateField.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { Modal } from '../../components/Modal.js'
import { toDisplayDate } from '../../format/dates.js'
import { PartySelector } from '../wholesale/PartySelector.js'
import type {
  PartyDto,
  PurchaseEntryDto,
  PurchaseLineInputDto,
  PurchaseNeighboursDto,
  PurchasePreviewDto,
  ShopProfileDto,
  StockSummaryDto,
} from '../../../shared/ipc.js'

/**
 * The Purchase screen: the shop buying gold over the counter.
 *
 * The wholesale screen's chrome, over the purchase book — the same toolbar,
 * the same rate strip, the same grid keyboard behaviour — because it is one
 * pair of hands moving between the screens. What is different is the trade:
 *
 *   - RATE is typeable per line. A seller's bangles and their chain can be
 *     priced differently on one slip; empty means "use the header rate".
 *   - Every line carries a BUCKET, defaulting to SCRAP — most purchases are
 *     old gold headed for the melt, not shelf-ready stock.
 *   - HOLD is real here. A held purchase takes a number and writes NO stock;
 *     only POSTED touches the ledger.
 *   - A posted purchase is never edited. It is CANCELLED, with a reason, which
 *     writes reversing stock rows and leaves everything else standing.
 *
 * Nothing on this screen calculates anything. Khalis and amounts arrive from
 * the main process, computed by the same code that saves them.
 */

const EMPTY_ROW: PurchaseLineInputDto = {
  itemName: '',
  grossGrams: '',
  kattRatti: '',
  rateRupees: '',
  bucket: 'SCRAP',
  remarks: null,
}

/** The typeable columns, in tab order. Khalis and amount are computed. */
const COLUMNS = ['itemName', 'grossGrams', 'kattRatti', 'rateRupees', 'remarks'] as const

const BUCKETS = ['SCRAP', 'FINISHED', 'BULLION'] as const

/** A zero is not a positive — see the wholesale screen's note. */
function isSignificant(display: string | undefined): boolean {
  if (!display) return false
  return /[1-9]/.test(display)
}

const NOWHERE: PurchaseNeighboursDto = {
  first: null,
  previous: null,
  next: null,
  last: null,
}

interface Guarded {
  readonly what: string
  readonly run: () => void | Promise<void>
}

function partyOf(entry: PurchaseEntryDto): PartyDto | null {
  if (!entry.draft.partyId) return null
  return {
    id: entry.draft.partyId,
    code: entry.draft.partyCode,
    name: entry.draft.partyName,
    mobile: null,
    city: null,
  }
}

export function PurchaseScreen({
  today,
  shop,
  receiptFooter,
  onPosted,
  pendingOpen,
  onPendingOpenHandled,
}: {
  today: string
  shop: ShopProfileDto
  receiptFooter: string
  onPosted: () => void
  /** An invoice number another screen asked to open — the stock ledger's reference. */
  pendingOpen?: number | null
  onPendingOpenHandled?: () => void
}) {
  const [party, setParty] = useState<PartyDto | null>(null)
  const [rows, setRows] = useState<PurchaseLineInputDto[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }])
  const [entryDate, setEntryDate] = useState(today)
  const [rateOverride, setRateOverride] = useState('')
  const [preview, setPreview] = useState<PurchasePreviewDto | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('—')
  const [busy, setBusy] = useState(false)
  const [stockSummary, setStockSummary] = useState<StockSummaryDto | null>(null)
  const { push } = useMessages()

  // ── the book, and where the screen is in it ───────────────────────────────
  const [stored, setStored] = useState<PurchaseEntryDto | null>(null)
  const [neighbours, setNeighbours] = useState<PurchaseNeighboursDto>(NOWHERE)
  const [showCancelled, setShowCancelled] = useState(false)
  const [guard, setGuard] = useState<Guarded | null>(null)
  /** The cancel-invoice dialog, holding the typed reason. Null when closed. */
  const [voidReason, setVoidReason] = useState<string | null>(null)
  const [jumpText, setJumpText] = useState('')
  const [jumpError, setJumpError] = useState<string | null>(null)
  const [partyKey, setPartyKey] = useState(0)
  const [baseline, setBaseline] = useState('')

  const cells = useRef(new Map<string, HTMLInputElement | null>())
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)

  useEffect(() => {
    void window.api.purchaseNextInvoiceNo().then(setInvoiceNo)
  }, [])

  const refreshStock = useCallback(async () => {
    setStockSummary(await window.api.stockSummary())
  }, [])

  useEffect(() => {
    void refreshStock()
  }, [refreshStock])

  /** The purchase being typed, as ONE value — preview, save and dirty agree. */
  const draft = useMemo(
    () => ({
      partyId: party?.id ?? '',
      entryDate,
      lines: rows,
      notes: null,
      ratePerTolaOverride: rateOverride,
      heldId: stored?.status === 'held' ? stored.entryId : null,
    }),
    [party, entryDate, rows, rateOverride, stored],
  )

  useEffect(() => {
    void window.api.purchasePreview(draft).then(setPreview)
  }, [draft])

  useEffect(() => {
    if (!pendingFocus) return
    cells.current.get(pendingFocus)?.focus()
    setPendingFocus(null)
  }, [pendingFocus, rows.length])

  const setRow = (index: number, patch: Partial<PurchaseLineInputDto>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = useCallback(() => setRows((c) => [...c, { ...EMPTY_ROW }]), [])
  const clearRows = useCallback(() => setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]), [])
  const deleteRow = (index: number): void =>
    setRows((current) =>
      current.length <= 1 ? [{ ...EMPTY_ROW }] : current.filter((_, i) => i !== index),
    )

  // ── walking the book ──────────────────────────────────────────────────────

  /**
   * A POSTED or CANCELLED purchase is read-only. A HELD one opens editable —
   * holding is parking, not posting, and its lines are still the operator's.
   */
  const isLocked = stored !== null && stored.status !== 'held'

  const markClean = useCallback((of: unknown) => {
    setBaseline(JSON.stringify(of))
  }, [])

  const dirty = useMemo(
    () => !isLocked && baseline !== '' && JSON.stringify(draft) !== baseline,
    [draft, isLocked, baseline],
  )

  useEffect(() => {
    setBaseline((current) => (current === '' ? JSON.stringify(draft) : current))
  }, [draft])

  useEffect(() => {
    void window.api
      .purchaseNeighbours(stored?.invoiceNumber ?? null, showCancelled)
      .then(setNeighbours)
  }, [stored, showCancelled, invoiceNo])

  useEffect(() => {
    setJumpText(stored?.invoiceNo ?? invoiceNo)
    setJumpError(null)
  }, [stored, invoiceNo])

  const openPurchase = useCallback(
    async (invoiceNumber: number): Promise<boolean> => {
      const loaded = await window.api.purchaseLoadAsDraft(invoiceNumber)
      if (!loaded) return false

      const next = loaded.draft
      setParty(partyOf(loaded))
      setRows(next.lines.length > 0 ? next.lines.map((line) => ({ ...line })) : [{ ...EMPTY_ROW }])
      setEntryDate(next.entryDate)
      // The rate this purchase was PRICED at, pinned. Without it a purchase
      // from last week reprices itself at today's rate the moment it is opened.
      setRateOverride(next.ratePerTolaOverride)
      setStored(loaded)
      setPartyKey((key) => key + 1)
      setJumpError(null)
      markClean({
        partyId: next.partyId ?? '',
        entryDate: next.entryDate,
        lines: next.lines.length > 0 ? next.lines : [{ ...EMPTY_ROW }],
        notes: null,
        ratePerTolaOverride: next.ratePerTolaOverride,
        heldId: loaded.status === 'held' ? loaded.entryId : null,
      })
      return true
    },
    [markClean],
  )

  // The stock ledger's reference column lands here: another screen asked for a
  // purchase by number, and the request is consumed exactly once.
  useEffect(() => {
    if (!pendingOpen) return
    void openPurchase(pendingOpen).then((opened) => {
      if (!opened) push('bad', `Purchase ${pendingOpen} could not be opened.`)
      onPendingOpenHandled?.()
    })
  }, [pendingOpen, openPurchase, onPendingOpenHandled, push])

  /** EVERY way off this purchase goes through here — see the wholesale note. */
  const guarded = useCallback(
    (what: string, run: () => void | Promise<void>) => {
      if (!dirty) {
        void run()
        return
      }
      setGuard({ what, run })
    },
    [dirty],
  )

  const goTo = useCallback(
    (target: number | null, what: string) => {
      if (target === null) return
      guarded(what, async () => {
        const opened = await openPurchase(target)
        if (!opened) push('bad', `Purchase ${target} could not be opened.`)
      })
    },
    [guarded, openPurchase, push],
  )

  const startNew = useCallback(() => {
    clearRows()
    setParty(null)
    setPartyKey((key) => key + 1)
    setRateOverride('')
    setStored(null)
    setJumpError(null)
    setBaseline('')
    void window.api.purchaseNextInvoiceNo().then(setInvoiceNo)
  }, [clearRows])

  const jumpToTyped = useCallback(() => {
    const typed = jumpText.trim().replace(/^[A-Za-z]+-?/, '')
    if (typed === '') {
      setJumpError(null)
      return
    }
    if (!/^\d+$/.test(typed)) {
      setJumpError('Numbers only.')
      return
    }
    const wanted = Number(typed)
    guarded(`purchase ${wanted}`, async () => {
      const opened = await openPurchase(wanted)
      if (!opened) setJumpError(`No purchase ${wanted}.`)
    })
  }, [jumpText, guarded, openPurchase])

  /** Enter walks DOWN a column; Tab off the last cell opens a new row. */
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

  /**
   * Posts or holds the purchase. Answers whether it actually went — a refused
   * save must not be followed by the guard's navigation.
   */
  const save = useCallback(
    async (mode: 'post' | 'post-print' | 'hold'): Promise<boolean> => {
      if (busy) return false
      if (isLocked) {
        push(
          'bad',
          `${stored?.invoiceNo ?? 'This purchase'} is ${stored?.status ?? 'posted'}. ` +
            `A posted purchase is corrected by cancelling it, never by saving over it.`,
        )
        return false
      }
      setBusy(true)
      try {
        if (!party) {
          push('bad', 'Choose a party before saving.')
          return false
        }
        const request = { ...draft, partyId: party.id }
        const result =
          mode === 'hold'
            ? await window.api.purchaseHold(request)
            : await window.api.purchaseSave(request)
        if (!result.ok) {
          push('bad', result.message)
          return false
        }
        if (mode === 'hold') {
          push(
            'ok',
            `Held ${result.invoiceNo}. Nothing has moved into stock — a held purchase ` +
              `has not happened yet. Open it again and SAVE to post it.`,
          )
        } else {
          push(
            'ok',
            `Saved ${result.invoiceNo}. ${result.khalisTotalDisplay} g khalis into stock, ` +
              `Rs ${result.amountTotalDisplay}.` +
              (mode === 'post-print' ? ' Sent to printer.' : ''),
          )
        }
        if (mode === 'post-print') window.print()
        clearRows()
        setRateOverride('')
        setStored(null)
        setBaseline('')
        await Promise.all([
          window.api.purchaseNextInvoiceNo().then(setInvoiceNo),
          refreshStock(),
        ])
        onPosted()
        return true
      } finally {
        setBusy(false)
      }
    },
    [busy, isLocked, stored, party, draft, clearRows, refreshStock, onPosted, push],
  )

  /** Cancels the posted purchase on screen, with the typed reason. */
  const confirmVoid = useCallback(async () => {
    if (!stored || voidReason === null) return
    const reason = voidReason.trim()
    if (reason === '') {
      push('bad', 'A cancellation needs a reason. It stays on the record.')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.purchaseCancel(stored.entryId, reason)
      if (!result.ok) {
        push('bad', result.message)
        return
      }
      push(
        'ok',
        `Cancelled ${stored.invoiceNo}. Reversing stock rows are written — the ` +
          `original rows stand, and the pair nets to zero.`,
      )
      setVoidReason(null)
      await Promise.all([openPurchase(stored.invoiceNumber), refreshStock()])
      onPosted()
    } finally {
      setBusy(false)
    }
  }, [stored, voidReason, openPurchase, refreshStock, onPosted, push])

  // Published so the shell's action registry can drive these buttons.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'purchase.row.add': addRow,
      'purchase.row.clear': clearRows,
      'purchase.save': () => void save('post'),
      'purchase.save-and-print': () => void save('post-print'),
      'purchase.print': () => window.print(),
      'purchase.hold': () => void save('hold'),
      'purchase.cancel': () => {
        clearRows()
        setRateOverride('')
      },
      'rate.refresh': () => setRateOverride(''),
      'purchase.new': () => guarded('a new purchase', startNew),
      'purchase.nav.first': () =>
        goTo(neighbours.first?.number ?? null, `purchase ${neighbours.first?.display}`),
      'purchase.nav.prev': () =>
        goTo(neighbours.previous?.number ?? null, `purchase ${neighbours.previous?.display}`),
      'purchase.nav.next': () =>
        goTo(neighbours.next?.number ?? null, `purchase ${neighbours.next?.display}`),
      'purchase.nav.last': () =>
        goTo(neighbours.last?.number ?? null, `purchase ${neighbours.last?.display}`),
      'purchase.invoice.jump': jumpToTyped,
      'purchase.invoice.search': jumpToTyped,
      'purchase.void': () => setVoidReason(''),
      'purchase.cancelled.toggle': () => setShowCancelled((current) => !current),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [addRow, clearRows, save, guarded, goTo, neighbours, jumpToTyped, startNew])

  /**
   * The function keys the buttons advertise, all five of them — a jeweller
   * entering fifty lines never touches the mouse.
   */
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (document.querySelector('.modal')) return

      if (event.ctrlKey && !event.altKey) {
        const chords: Record<string, () => void> = {
          Home: () =>
            goTo(neighbours.first?.number ?? null, `purchase ${neighbours.first?.display}`),
          End: () =>
            goTo(neighbours.last?.number ?? null, `purchase ${neighbours.last?.display}`),
          ArrowLeft: () =>
            goTo(
              neighbours.previous?.number ?? null,
              `purchase ${neighbours.previous?.display}`,
            ),
          ArrowRight: () =>
            goTo(neighbours.next?.number ?? null, `purchase ${neighbours.next?.display}`),
          s: () => void save('post'),
          S: () => void save('post'),
        }
        const chord = chords[event.key]
        if (!chord) return
        event.preventDefault()
        chord()
        return
      }

      const keys: Record<string, () => void> = {
        F2: addRow,
        F5: () => void save('post'),
        F6: () => void save('post-print'),
        F7: () => window.print(),
        F8: () => void save('hold'),
        F9: () => guarded('a new purchase', startNew),
      }
      const handler = keys[event.key]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, addRow, guarded, goTo, neighbours, startNew])

  const totals = useMemo(
    () => ({
      gross: preview?.grossTotalDisplay ?? '0.000',
      khalis: preview?.khalisTotalDisplay ?? '0.000',
      amount: preview?.amountTotalDisplay ?? '0.00',
    }),
    [preview],
  )

  return (
    <div className="screen purchase">
      {/* The toolbar the other two books wear: party · NEW | the four
          navigation controls | SAVE | the number box. */}
      <div className="invoice-toolbar purchase__toolbar">
        <PartySelector
          key={partyKey}
          selected={party}
          onSelect={setParty}
          disabled={isLocked}
          variant="toolbar"
        />

        <Action
          id="purchase.new"
          variant="outline"
          className="toolbar__new"
          onActivate={() => guarded('a new purchase', startNew)}
        >
          NEW
        </Action>

        <span className="toolbar__rule" aria-hidden="true" />

        <div className="toolbar__nav" role="group" aria-label="Move between purchases">
          <Action
            id="purchase.nav.first"
            variant="outline"
            className="toolbar__step"
            unavailable={
              neighbours.first === null ||
              neighbours.first.number === stored?.invoiceNumber
            }
            onActivate={() =>
              goTo(neighbours.first?.number ?? null, `purchase ${neighbours.first?.display}`)
            }
          >
            <span aria-hidden="true">|◀</span>
            <span>FIRST</span>
          </Action>
          <Action
            id="purchase.nav.prev"
            variant="outline"
            className="toolbar__step"
            unavailable={neighbours.previous === null}
            onActivate={() =>
              goTo(
                neighbours.previous?.number ?? null,
                `purchase ${neighbours.previous?.display}`,
              )
            }
          >
            <span aria-hidden="true">◀</span>
            <span>PREV</span>
          </Action>
          <Action
            id="purchase.nav.next"
            variant="outline"
            className="toolbar__step"
            unavailable={neighbours.next === null}
            onActivate={() =>
              goTo(neighbours.next?.number ?? null, `purchase ${neighbours.next?.display}`)
            }
          >
            <span>NEXT</span>
            <span aria-hidden="true">▶</span>
          </Action>
          <Action
            id="purchase.nav.last"
            variant="outline"
            className="toolbar__step"
            unavailable={
              neighbours.last === null || neighbours.last.number === stored?.invoiceNumber
            }
            onActivate={() =>
              goTo(neighbours.last?.number ?? null, `purchase ${neighbours.last?.display}`)
            }
          >
            <span>LAST</span>
            <span aria-hidden="true">▶|</span>
          </Action>
        </div>

        <Action
          id="purchase.save"
          variant="primary"
          className="toolbar__save"
          busy={busy}
          unavailable={isLocked}
        >
          SAVE
        </Action>

        <span className="toolbar__rule" aria-hidden="true" />

        <label className="toolbar__jump">
          <span className="toolbar__jump-label">Invoice No :</span>
          <input
            className="input toolbar__jump-input"
            value={jumpText}
            onChange={(e) => {
              setJumpText(e.target.value)
              setJumpError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                jumpToTyped()
              }
              if (e.key === 'Escape') {
                setJumpText('')
                setJumpError(null)
              }
            }}
            aria-label="Purchase number — type one and press Enter to open it"
          />
          <Action id="purchase.invoice.search" variant="segment" ariaLabel="Find purchase">
            <Icon name="search" size={16} />
          </Action>
        </label>
        {jumpError ? (
          <span className="toolbar__jump-error" role="alert">
            {jumpError}
          </span>
        ) : null}
      </div>

      <div className="screen__head">
        {preview?.rateMissing ? (
          <div className="banner">
            No gold rate is recorded for {toDisplayDate(entryDate)}. Set the 24K rate on
            the Dashboard before saving — every amount depends on it.
          </div>
        ) : null}

        {/* The snapshot check. A stored purchase whose figures no longer
            reproduce from its own katt and rate says so plainly — the screen
            never silently displays either figure. */}
        {stored?.figuresWarning ? <div className="banner">{stored.figuresWarning}</div> : null}
      </div>

      {stored ? (
        <div className={`record-state${stored.status === 'cancelled' ? ' is-void' : ''}`}>
          <span className="record-state__what">
            {stored.invoiceNo} · {stored.status.toUpperCase()}
            {isLocked ? ' · read-only' : ' · editable until posted'}
          </span>
          {stored.status === 'posted' ? (
            <Action
              id="purchase.void"
              variant="outline"
              className="record-state__edit"
              onActivate={() => setVoidReason('')}
            >
              CANCEL INVOICE
            </Action>
          ) : stored.status === 'held' ? (
            <span className="record-state__why">
              Held: nothing has moved into stock. SAVE posts it under this same number;
              HOLD parks it again.
            </span>
          ) : (
            <span className="record-state__why">
              Cancelled — its reversing stock rows and the original rows both stand,
              netting to zero. The number stays burned.
            </span>
          )}
          <Action
            id="purchase.cancelled.toggle"
            variant="ghost"
            className="record-state__voided"
            active={showCancelled}
            onActivate={() => setShowCancelled((current) => !current)}
          >
            {showCancelled ? 'Hiding nothing' : 'Show cancelled'}
          </Action>
        </div>
      ) : null}

      <div className="workspace__split screen__body">
        <div className="entry-column">
          <div className="panel">
            <div className="panel__title">ENTRY DETAILS</div>

            <div className="field-row">
              <label className="field">
                <span className="field__label">Code</span>
                <input
                  className="input input--derived"
                  value={party?.code ?? ''}
                  readOnly
                  disabled
                  placeholder="—"
                  aria-label="Party code"
                />
              </label>

              <DateField
                value={entryDate}
                onChange={setEntryDate}
                label="Date"
                ariaLabel="Entry date"
              />

              <label className="field">
                <span className="field__label">Gold Rate (Per Tola)</span>
                <span className="input-group">
                  <input
                    className="input input--numeric"
                    value={rateOverride}
                    onChange={(e) => setRateOverride(e.target.value)}
                    placeholder={preview?.rateDisplay ?? 'No rate set'}
                    inputMode="decimal"
                    aria-label="Gold rate per tola"
                    disabled={isLocked}
                  />
                  <Action id="rate.refresh" variant="segment" ariaLabel="Refresh rate">
                    <Icon name="refresh" size={16} />
                  </Action>
                </span>
              </label>
            </div>

            <ActionBar busy={busy} locked={isLocked} />
          </div>

          <div className="panel panel--fill">
            <div className="panel__title">
              <span>ITEM DETAILS</span>
              <span className="toolbar__end">
                <Action id="purchase.row.add" variant="toolbar" unavailable={isLocked}>
                  <Icon name="plus" size={16} /> Add Row
                </Action>
                <Action id="purchase.row.clear" variant="toolbar" unavailable={isLocked}>
                  <Icon name="cross" size={16} /> Clear Row
                </Action>
                <Action id="purchase.import-from-stock" variant="toolbar">
                  <Icon name="upload" size={16} /> Import
                </Action>
                <Action id="purchase.scan-barcode" variant="toolbar">
                  <Icon name="barcode" size={16} /> Scan
                </Action>
              </span>
            </div>
            <div className="panel__body panel__body--flush">
              <div className="table-scroll">
                <table className="grid grid--fixed">
                  <colgroup>
                    <col className="col--index" />
                    <col />
                    <col className="col--gross" />
                    <col className="col--katt" />
                    <col className="col--khalis" />
                    <col className="col--rate" />
                    <col className="col--amount" />
                    <col className="col--remarks" />
                    <col className="col--bucket-action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="grid__index">#</th>
                      <th>Item Name</th>
                      <th className="numeric">Gross g</th>
                      <th className="numeric">Katt r/t</th>
                      <th className="numeric">Khalis g</th>
                      <th className="numeric">Rate</th>
                      <th className="numeric">Amount</th>
                      <th>Remarks</th>
                      <th className="grid__action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const computed = preview?.lines[index]
                      const cell = (columnIndex: number) => ({
                        ref: (node: HTMLInputElement | null) => {
                          cells.current.set(`${index}:${columnIndex}`, node)
                        },
                        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) =>
                          onCellKeyDown(index, columnIndex, event),
                      })
                      return (
                        <tr key={index} className={computed?.error ? 'row--error' : undefined}>
                          <td className="grid__index">{index + 1}</td>
                          <td>
                            <input
                              className="input input--cell"
                              value={row.itemName}
                              onChange={(e) => setRow(index, { itemName: e.target.value })}
                              placeholder="Item name"
                              aria-label={`Item name row ${index + 1}`}
                              disabled={isLocked}
                              {...cell(0)}
                            />
                          </td>
                          <td>
                            <input
                              className="input input--cell input--numeric"
                              value={row.grossGrams}
                              onChange={(e) => setRow(index, { grossGrams: e.target.value })}
                              placeholder="0.000"
                              inputMode="decimal"
                              aria-label={`Gross weight row ${index + 1}`}
                              disabled={isLocked}
                              {...cell(1)}
                            />
                          </td>
                          <td>
                            <input
                              className="input input--cell input--numeric"
                              value={row.kattRatti}
                              onChange={(e) => setRow(index, { kattRatti: e.target.value })}
                              placeholder="0.000"
                              inputMode="decimal"
                              aria-label={`Katt row ${index + 1}`}
                              disabled={isLocked}
                              {...cell(2)}
                            />
                          </td>
                          {/* Khalis is COMPUTED and read-only. A khalis that
                              contradicts the gross and katt cannot be typed. */}
                          <td
                            className={`numeric${
                              isSignificant(computed?.khalisDisplay) ? ' positive' : ' muted'
                            }`}
                            title={computed?.purityDisplay}
                          >
                            {computed?.khalisDisplay ?? '—'}
                          </td>
                          {/* RATE is typeable per line, unlike wholesale.
                              Empty means the header rate, shown as the
                              placeholder. */}
                          <td>
                            <input
                              className="input input--cell input--numeric"
                              value={row.rateRupees}
                              onChange={(e) => setRow(index, { rateRupees: e.target.value })}
                              placeholder={preview?.rateDisplay ?? '—'}
                              inputMode="decimal"
                              aria-label={`Rate row ${index + 1}`}
                              disabled={isLocked}
                              {...cell(3)}
                            />
                          </td>
                          <td className="numeric muted">{computed?.amountDisplay ?? '—'}</td>
                          <td>
                            <input
                              className="input input--cell"
                              value={row.remarks ?? ''}
                              onChange={(e) => setRow(index, { remarks: e.target.value })}
                              placeholder="—"
                              aria-label={`Remarks row ${index + 1}`}
                              disabled={isLocked}
                              {...cell(4)}
                            />
                          </td>
                          <td className="grid__action">
                            <span className="bucket-action">
                              {/* Where this line's metal lands. SCRAP first —
                                  most of what crosses this counter is old gold
                                  headed for the melt. */}
                              <select
                                className="input input--cell bucket-action__select"
                                value={row.bucket}
                                onChange={(e) => setRow(index, { bucket: e.target.value })}
                                aria-label={`Bucket row ${index + 1}`}
                                disabled={isLocked}
                              >
                                {BUCKETS.map((bucket) => (
                                  <option key={bucket} value={bucket}>
                                    {bucket}
                                  </option>
                                ))}
                              </select>
                              <Action
                                id="purchase.row.delete"
                                variant="icon"
                                className="is-danger"
                                ariaLabel={`Delete row ${index + 1}`}
                                unavailable={isLocked}
                                onActivate={() => deleteRow(index)}
                              >
                                <Icon name="trash" size={16} />
                              </Action>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="grid__index" />
                      <td>Total</td>
                      <td className="numeric">{totals.gross}</td>
                      <td />
                      <td
                        className={`numeric${isSignificant(totals.khalis) ? ' positive' : ''}`}
                      >
                        {totals.khalis}
                      </td>
                      <td />
                      <td className="numeric">{totals.amount}</td>
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
          </div>

          <div className="stat-strip">
            <div className="stat-cell">
              <span className="stat-cell__label">Total Gross</span>
              <span className="stat-cell__value">{totals.gross} g</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell__label">Total Khalis</span>
              <span
                className={`stat-cell__value${isSignificant(totals.khalis) ? ' positive' : ''}`}
              >
                {totals.khalis} g
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell__label">Total Amount</span>
              <span className="stat-cell__value">Rs. {totals.amount}</span>
            </div>
          </div>
        </div>

        <aside className="rail">
          <PurchasePreviewSlip
            invoiceNo={stored?.invoiceNo ?? invoiceNo}
            date={entryDate}
            party={party}
            preview={preview}
            shop={shop}
            footer={receiptFooter}
          />

          <div className="panel">
            <div className="panel__title">
              <span>STOCK ON HAND</span>
              <span className="toolbar__end">
                <Action id="stock.refresh" variant="toolbar" onActivate={() => void refreshStock()}>
                  <Icon name="refresh" size={16} /> Refresh
                </Action>
              </span>
            </div>
            <div className="panel__body">
              {stockSummary ? (
                <>
                  {stockSummary.buckets.map((bucket) => (
                    <div className="summary-line" key={bucket.bucket}>
                      <span>{bucket.bucket}</span>
                      <span
                        className={`summary-line__value${bucket.isNegative ? ' negative' : ''}`}
                      >
                        {bucket.khalisDisplay} g{bucket.isNegative ? ' (short)' : ''}
                      </span>
                    </div>
                  ))}
                  <div className="summary-line">
                    <span>Total khalis</span>
                    <span className="summary-line__value">
                      {stockSummary.totalKhalisDisplay} g
                    </span>
                  </div>
                </>
              ) : (
                <EmptyState title="No stock yet" line="Posted purchases appear here." />
              )}
            </div>
          </div>
        </aside>
      </div>

      {guard ? (
        <Modal label="This purchase has unsaved changes" onClose={() => setGuard(null)}>
          <h2 className="modal__title">Save this purchase first?</h2>
          <p className="hint">
            This purchase has rows that have not been saved. Going to {guard.what} now
            would leave them behind — the screen holds one purchase at a time.
          </p>
          <div className="confirm__actions">
            <Action
              id="purchase.guard.cancel"
              variant="ghost"
              onActivate={() => setGuard(null)}
            >
              Stay here
            </Action>
            <Action
              id="purchase.guard.discard"
              variant="outline"
              className="is-cancel"
              onActivate={() => {
                const go = guard.run
                setGuard(null)
                setBaseline('')
                void go()
              }}
            >
              Discard changes
            </Action>
            <Action
              id="purchase.guard.save"
              variant="primary"
              busy={busy}
              onActivate={() => {
                const go = guard.run
                setGuard(null)
                void save('post').then((saved) => {
                  if (saved) void go()
                })
              }}
            >
              Save, then go
            </Action>
          </div>
        </Modal>
      ) : null}

      {voidReason !== null && stored ? (
        <Modal label="Cancel this posted purchase" onClose={() => setVoidReason(null)}>
          <h2 className="modal__title">Cancel {stored.invoiceNo}?</h2>
          <p className="hint">
            Cancelling writes REVERSING stock rows — the original rows are never deleted,
            and the summary returns to what it was before this purchase. The number stays
            burned. The reason stays on the record.
          </p>
          <label className="field">
            <span className="field__label">Reason</span>
            <input
              className="input"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Seller returned, deal off"
              aria-label="Cancellation reason"
            />
          </label>
          <div className="confirm__actions">
            <Action
              id="purchase.void.back"
              variant="ghost"
              onActivate={() => setVoidReason(null)}
            >
              Keep the purchase
            </Action>
            <Action
              id="purchase.void.confirm"
              variant="outline"
              className="is-cancel"
              busy={busy}
              onActivate={() => void confirmVoid()}
            >
              Cancel it
            </Action>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

/** The five purchase actions, F5–F8 wired for real — HOLD included. */
function ActionBar({ busy, locked }: { busy: boolean; locked: boolean }) {
  return (
    <div className="action-bar">
      <Action
        id="purchase.save"
        variant="primary"
        className="is-save"
        busy={busy}
        unavailable={locked}
      >
        <Icon name="save" size={18} />
        <span>SAVE (F5)</span>
      </Action>
      <Action
        id="purchase.save-and-print"
        variant="outline"
        className="is-save-print"
        busy={busy}
        unavailable={locked}
      >
        <Icon name="print" size={18} />
        <span>SAVE &amp; PRINT (F6)</span>
      </Action>
      <Action id="purchase.print" variant="outline" className="is-print">
        <Icon name="print" size={18} />
        <span>PRINT (F7)</span>
      </Action>
      <Action id="purchase.hold" variant="outline" className="is-hold" busy={busy} unavailable={locked}>
        <Icon name="pause" size={18} />
        <span>HOLD (F8)</span>
      </Action>
      <Action id="purchase.cancel" variant="outline" className="is-cancel">
        <Icon name="cross" size={18} />
        <span>CANCEL</span>
      </Action>
    </div>
  )
}

/** The 80mm slip facsimile, purchase-shaped: gross, katt, khalis, amount. */
function PurchasePreviewSlip({
  invoiceNo,
  date,
  party,
  preview,
  shop,
  footer,
}: {
  invoiceNo: string
  date: string
  party: PartyDto | null
  preview: PurchasePreviewDto | null
  shop: ShopProfileDto
  footer: string
}) {
  const items = (preview?.lines ?? []).filter((line) => !line.error)
  return (
    <div className="panel">
      <div className="panel__title">PURCHASE PREVIEW (80MM)</div>
      <div className="panel__body slip">
        <div className="slip__brand">{shop.name.trim() || 'GOLD JEWELLERS'}</div>
        {shop.tagline.trim() ? <div className="slip__tagline">{shop.tagline}</div> : null}
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Purchase No.</span>
          <span>{invoiceNo}</span>
        </div>
        <div className="slip__row">
          <span>Date</span>
          <span>{toDisplayDate(date)}</span>
        </div>
        <div className="slip__row">
          <span>Party</span>
          <span>{party?.name ?? '—'}</span>
        </div>
        <div className="slip__row">
          <span>Rate</span>
          <span>{preview?.rateDisplay ? `${preview.rateDisplay}/tola` : '—'}</span>
        </div>
        {items.length > 0 ? (
          <>
            <div className="slip__rule" />
            <div className="slip__row slip__head">
              <span>ITEM</span>
              <span>GR</span>
              <span>KATT</span>
              <span>PR</span>
            </div>
            {items.map((line, index) => (
              <div className="slip__row slip__item" key={index}>
                <span>{line.itemName}</span>
                <span>{line.grossDisplay}</span>
                <span>{line.kattDisplay}</span>
                <span>{line.khalisDisplay}</span>
              </div>
            ))}
            <div className="slip__rule" />
            <div className="slip__row">
              <span>Total</span>
              <span>( {preview?.grossTotalDisplay ?? '0.000'} )</span>
              <span />
              <span>( {preview?.khalisTotalDisplay ?? '0.000'} )</span>
            </div>
          </>
        ) : null}
        <div className="slip__rule" />
        <div className="slip__row slip__total">
          <span>Amount Payable</span>
          <span>Rs. {preview?.amountTotalDisplay ?? '0.00'}</span>
        </div>
        <div className="slip__rule" />
        {footer.trim() ? <div className="slip__centre">{footer}</div> : null}
      </div>
    </div>
  )
}
