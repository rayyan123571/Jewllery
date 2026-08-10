import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { DateField } from '../../components/DateField.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { toDisplayDate } from '../../format/dates.js'
import { PartySelector } from './PartySelector.js'
import { SettlementPanel } from './SettlementPanel.js'
import type {
  LedgerRowDto,
  LineInputDto,
  PartyBalanceDto,
  PartyDto,
  PreviewDto,
} from '../../../shared/ipc.js'

/**
 * The Whole Sale screen.
 *
 * The layout is the approved one. The grid model is the real slip's, not the
 * mockup's: **Gross · Katt (ratti/tola) · Khalis**, with no purity column and no
 * per-row remaining weight. Katt IS how purity is expressed here, and remaining
 * exists only as a ledger balance.
 *
 * Nothing on this screen calculates anything. Every figure shown — khalis,
 * amount, totals, balances — is computed in the main process by the same code
 * that will post the slip, and arrives preformatted. That is why what the
 * operator sees while typing is exactly what gets saved.
 *
 * ── The height budget ──────────────────────────────────────────────────────
 * The window height is a budget and the item table is what it is spent on. Head
 * and the fixed cards take what they need; the table absorbs the rest and is the
 * only region allowed to scroll. The party ledger is deliberately NOT on this
 * tab — it is the whole content of the Whole Sale Ledger tab, and the same rows
 * shown twice cost the table a third of its height to tell the operator nothing
 * new.
 */

const EMPTY_ROW: LineInputDto = { itemName: '', grossGrams: '', kattRatti: '', remarks: null }

/** The typeable columns, in tab order. Khalis, rate and amount are computed. */
const COLUMNS = ['itemName', 'grossGrams', 'kattRatti', 'remarks'] as const

type Tab = 'new' | 'ledger' | 'settle' | 'history'

export function WholesaleScreen({
  today,
  onPosted,
}: {
  today: string
  onPosted: () => void
}) {
  const [tab, setTab] = useState<Tab>('new')
  const [party, setParty] = useState<PartyDto | null>(null)
  const [balance, setBalance] = useState<PartyBalanceDto | null>(null)
  const [rows, setRows] = useState<LineInputDto[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }])
  const [entryDate, setEntryDate] = useState(today)
  // Empty means "use the rate recorded for this date". A typed value overrides it.
  const [rateOverride, setRateOverride] = useState('')
  const [preview, setPreview] = useState<PreviewDto | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('—')
  const [ledger, setLedger] = useState<readonly LedgerRowDto[]>([])
  const [busy, setBusy] = useState(false)
  const { push } = useMessages()

  // Cell focus, for the two keyboard behaviours that matter at a counter.
  const cells = useRef(new Map<string, HTMLInputElement | null>())
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)

  const refreshParty = useCallback(async (id: string | null) => {
    if (!id) {
      setBalance(null)
      setLedger([])
      return
    }
    const [b, l] = await Promise.all([window.api.partyBalance(id), window.api.partyLedger(id)])
    setBalance(b)
    setLedger(l)
  }, [])

  useEffect(() => {
    void window.api.nextInvoiceNo().then(setInvoiceNo)
  }, [])

  useEffect(() => {
    void refreshParty(party?.id ?? null)
  }, [party, refreshParty])

  // Live preview. The main process runs the same computeLine/totalsOf the post
  // path runs, so this is not an approximation of what will be saved — it is it.
  useEffect(() => {
    const request = {
      partyId: party?.id ?? '',
      entryDate,
      lines: rows,
      notes: null,
      ratePerTolaOverride: rateOverride,
    }
    void window.api.previewWholesale(request).then(setPreview)
  }, [rows, entryDate, party, rateOverride])

  // A row added by Tab has to exist before it can be focused, so the focus is
  // deferred to the render that contains it.
  useEffect(() => {
    if (!pendingFocus) return
    cells.current.get(pendingFocus)?.focus()
    setPendingFocus(null)
  }, [pendingFocus, rows.length])

  const setRow = (index: number, patch: Partial<LineInputDto>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = useCallback(() => setRows((c) => [...c, { ...EMPTY_ROW }]), [])
  const clearRows = useCallback(() => setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]), [])
  const deleteRow = (index: number): void =>
    setRows((current) =>
      current.length <= 1 ? [{ ...EMPTY_ROW }] : current.filter((_, i) => i !== index),
    )

  /**
   * The two keyboard behaviours a counter operator actually uses.
   *
   * Enter walks DOWN a column, because a slip is entered a column at a time —
   * six gross weights, then six katts — not a row at a time. Tab off the last
   * cell of the last row opens a new one and lands in its first cell, so a long
   * slip never needs the mouse. Both matter more than anything visual on this
   * screen: they are the difference between typing a slip and operating a form.
   */
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

  const save = useCallback(
    async (thenPrint: boolean) => {
      if (busy) return
      setBusy(true)
      try {
        if (!party) {
          push('bad', 'Choose a party before saving.')
          return
        }
        const result = await window.api.postIssue({
          partyId: party.id,
          entryDate,
          lines: rows,
          notes: null,
          ratePerTolaOverride: rateOverride,
        })
        if (!result.ok) {
          push('bad', result.message)
          return
        }
        push(
          'ok',
          `Saved ${result.invoiceNo}. ${party.name} now ${result.balanceAfter.text}.` +
            (thenPrint ? ' Sent to printer.' : ''),
        )
        clearRows()
        setRateOverride('')
        await Promise.all([
          refreshParty(party.id),
          window.api.nextInvoiceNo().then(setInvoiceNo),
        ])
        onPosted()
      } finally {
        setBusy(false)
      }
    },
    [busy, party, entryDate, rows, rateOverride, clearRows, refreshParty, onPosted, push],
  )

  // Published so the shell's action registry can drive these buttons.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'wholesale.row.add': addRow,
      'wholesale.row.clear': clearRows,
      'wholesale.save': () => void save(false),
      'wholesale.save-and-print': () => void save(true),
      'wholesale.print': () => window.print(),
      'wholesale.cancel': () => {
        clearRows()
        setRateOverride('')
      },
      // Refresh drops a typed override and goes back to the recorded rate.
      'rate.refresh': () => setRateOverride(''),
      'wholesale.tab.new': () => setTab('new'),
      'wholesale.tab.ledger': () => setTab('ledger'),
      'wholesale.tab.return': () => setTab('settle'),
      'wholesale.tab.history': () => setTab('history'),
      'wholesale.ledger.view-full': () => setTab('ledger'),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [addRow, clearRows, save])

  const totals = useMemo(
    () => ({
      gross: preview?.grossTotalDisplay ?? '0.000',
      khalis: preview?.khalisTotalDisplay ?? '0.000',
      amount: preview?.amountTotalDisplay ?? '0.00',
    }),
    [preview],
  )

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="module-title">WHOLE SALE MODULE</h1>

        {preview?.rateMissing ? (
          <div className="banner">
            No gold rate is recorded for {toDisplayDate(entryDate)}. Set the rate for that
            day in Gold Rate before saving — every amount depends on it, and using
            today&apos;s would price this slip wrongly.
          </div>
        ) : null}
      </div>

      <div className="workspace__split screen__body">
        <div className="entry-column">
          <div className="panel">
            <div className="tabs">
              <Action id="wholesale.tab.new" variant="tab" active={tab === 'new'}>
                New Whole Sale
              </Action>
              <Action id="wholesale.tab.ledger" variant="tab" active={tab === 'ledger'}>
                Whole Sale Ledger
              </Action>
              <Action id="wholesale.tab.return" variant="tab" active={tab === 'settle'}>
                Return / Receive
              </Action>
              <Action id="wholesale.tab.history" variant="tab" active={tab === 'history'}>
                History
              </Action>
            </div>

            <div className="panel__title">ENTRY DETAILS</div>

            <div className="field-row">
              <PartySelector selected={party} onSelect={setParty} />

              <label className="field">
                <span className="field__label">Invoice No.</span>
                <span className="input-group">
                  <input className="input" value={invoiceNo} readOnly aria-label="Invoice number" />
                  <Action id="wholesale.invoice.search" variant="segment" ariaLabel="Find invoice">
                    <Icon name="search" size={16} />
                  </Action>
                </span>
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
                  {/* Editable. It was read-only, which made the service's
                      rate-override support unreachable — a shop quoting a party
                      a rate different from the day's board rate had no way to
                      enter it. Empty falls back to the recorded rate. */}
                  <input
                    className="input input--numeric"
                    value={rateOverride}
                    onChange={(e) => setRateOverride(e.target.value)}
                    placeholder={preview?.rateDisplay ?? 'No rate set'}
                    inputMode="decimal"
                    aria-label="Gold rate per tola"
                  />
                  <Action id="rate.refresh" variant="segment" ariaLabel="Refresh rate">
                    <Icon name="refresh" size={16} />
                  </Action>
                </span>
              </label>
            </div>

            {tab === 'new' ? <ActionBar busy={busy} /> : null}
          </div>

          {tab === 'new' ? (
            <>
              <div className="panel panel--fill">
                <div className="panel__title">
                  <span>ITEM DETAILS</span>
                  {/* The row tools live in the card header rather than under the
                      table. Below it they cost 56px of table height on every
                      screen size, and they are used once per slip. */}
                  <span className="toolbar__end">
                    <Action id="wholesale.row.add" variant="toolbar">
                      <Icon name="plus" size={16} /> Add Row
                    </Action>
                    <Action id="wholesale.row.clear" variant="toolbar">
                      <Icon name="cross" size={16} /> Clear Row
                    </Action>
                    <Action id="wholesale.import-from-stock" variant="toolbar">
                      <Icon name="upload" size={16} /> Import
                    </Action>
                    <Action id="wholesale.scan-barcode" variant="toolbar">
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
                        <col className="col--action" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="grid__index">#</th>
                          <th>Item Name</th>
                          <th className="numeric">Gross (g)</th>
                          <th className="numeric">Katt (r/t)</th>
                          <th className="numeric">Khalis (g)</th>
                          <th className="numeric">Rate/tola</th>
                          <th className="numeric">Amount (Rs.)</th>
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
                                  {...cell(2)}
                                />
                              </td>
                              <td className="numeric positive" title={computed?.purityDisplay}>
                                {computed?.khalisDisplay ?? '—'}
                              </td>
                              <td className="numeric">{computed?.rateDisplay ?? '—'}</td>
                              <td className="numeric">{computed?.amountDisplay ?? '—'}</td>
                              <td>
                                <input
                                  className="input input--cell"
                                  value={row.remarks ?? ''}
                                  onChange={(e) => setRow(index, { remarks: e.target.value })}
                                  placeholder="—"
                                  aria-label={`Remarks row ${index + 1}`}
                                  {...cell(3)}
                                />
                              </td>
                              <td className="grid__action">
                                <Action
                                  id="wholesale.row.delete"
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
                      {/* No parentheses. In accounting a bracketed figure means a
                          negative one, and these were bracketed AND green — two
                          contradictory signals on a number that is neither. */}
                      <tfoot>
                        <tr>
                          <td className="grid__index" />
                          <td>Total</td>
                          <td className="numeric">{totals.gross}</td>
                          <td />
                          <td className="numeric positive">{totals.khalis}</td>
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

              {/* One strip, three figures. Gross is already in the totals row,
                  the rate is in the entry card and the top bar, and the previous
                  balance is in the rail — so nothing left this screen when the
                  three stacked cards became one 60px strip. */}
              <div className="stat-strip">
                <div className="stat-cell">
                  <span className="stat-cell__label">Total Khalis</span>
                  <span className="stat-cell__value positive">{totals.khalis} g</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-cell__label">Total Amount</span>
                  <span className="stat-cell__value">Rs. {totals.amount}</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-cell__label">End Balance</span>
                  <span
                    className={`stat-cell__value ${
                      preview?.endBalance?.direction === 'shop-owes-party' ? 'negative' : 'positive'
                    }`}
                  >
                    {preview?.endBalance?.text ?? '—'}
                    {preview?.endBalance?.drCr ? ` /${preview.endBalance.drCr}` : ''}
                  </span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'settle' ? (
            <SettlementPanel
              party={party}
              balance={balance}
              entryDate={entryDate}
              onSettled={async () => {
                await refreshParty(party?.id ?? null)
                onPosted()
              }}
            />
          ) : null}

          {tab === 'ledger' || tab === 'history' ? (
            <LedgerTable rows={ledger} party={party} />
          ) : null}
        </div>

        <aside className="rail">
          <InvoicePreview
            invoiceNo={invoiceNo}
            date={entryDate}
            party={party}
            preview={preview}
          />

          <div className="panel">
            <div className="panel__title">QUICK ACTIONS</div>
            <div className="panel__body">
              <div className="quick-actions">
                <Action id="quick.wholesale-ledger" variant="quick">
                  Whole Sale Ledger
                </Action>
                <Action id="quick.return-receive" variant="quick">
                  Return / Receive
                </Action>
                <Action id="quick.print-last-invoice" variant="quick">
                  Print Last Invoice
                </Action>
                <Action id="quick.party-balance" variant="quick">
                  Party Balance
                </Action>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__title">PARTY SUMMARY</div>
            <div className="panel__body">
              {balance ? (
                <>
                  <div className="summary-line">
                    <span>Party</span>
                    <span className="summary-line__value">{balance.party.name}</span>
                  </div>
                  <div className="summary-line">
                    <span>Gold balance</span>
                    <span
                      className={`summary-line__value ${
                        balance.gold.direction === 'shop-owes-party' ? 'negative' : 'positive'
                      }`}
                    >
                      {balance.gold.text} {balance.gold.drCr ? `/${balance.gold.drCr}` : ''}
                    </span>
                  </div>
                  <div className="summary-line">
                    <span>Cash balance</span>
                    <span className="summary-line__value">{balance.cash.text}</span>
                  </div>
                </>
              ) : (
                <EmptyState
                  title="No party chosen"
                  line="Search for a party above to see what they owe."
                />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

/**
 * The five slip actions.
 *
 * One solid button and four outlined ones. Five solid colour blocks is a
 * toolbar — every control shouting at the same volume, so none of them is the
 * answer. Save is the answer; the rest keep their semantic colour on the border
 * and the label, which is enough to tell them apart without competing.
 */
function ActionBar({ busy }: { busy: boolean }) {
  return (
    <div className="action-bar">
      <Action id="wholesale.save" variant="primary" className="is-save" busy={busy}>
        <Icon name="save" size={18} />
        <span>SAVE (F5)</span>
      </Action>
      <Action
        id="wholesale.save-and-print"
        variant="outline"
        className="is-save-print"
        busy={busy}
      >
        <Icon name="print" size={18} />
        <span>SAVE &amp; PRINT (F6)</span>
      </Action>
      <Action id="wholesale.print" variant="outline" className="is-print">
        <Icon name="print" size={18} />
        <span>PRINT (F7)</span>
      </Action>
      <Action id="wholesale.hold" variant="outline" className="is-hold">
        <Icon name="pause" size={18} />
        <span>HOLD (F8)</span>
      </Action>
      <Action id="wholesale.cancel" variant="outline" className="is-cancel">
        <Icon name="cross" size={18} />
        <span>CANCEL</span>
      </Action>
    </div>
  )
}

/** The 80mm slip, showing what will actually print. */
function InvoicePreview({
  invoiceNo,
  date,
  party,
  preview,
}: {
  invoiceNo: string
  date: string
  party: PartyDto | null
  preview: PreviewDto | null
}) {
  const items = (preview?.lines ?? []).filter((line) => !line.error)
  return (
    <div className="panel">
      <div className="panel__title">INVOICE PREVIEW (80MM)</div>
      <div className="panel__body slip">
        <div className="slip__brand">
          AL-HARAM
          <br />
          GOLD JEWELLERS
        </div>
        <div className="slip__centre">Trust in Purity</div>
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Invoice No.</span>
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
        {/* The item block only prints when there are items. On the settle and
            ledger tabs an empty table with ( 0.000 ) totals would be a slip
            claiming nothing was issued, which is not what is happening. */}
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
            {/* The parentheses stay HERE and only here: this is a facsimile of
                the paper, and the thermal renderer prints them. The on-screen
                totals row does not. */}
            <div className="slip__row">
              <span>Total</span>
              <span>( {preview?.grossTotalDisplay ?? '0.000'} )</span>
              <span />
              <span>( {preview?.khalisTotalDisplay ?? '0.000'} )</span>
            </div>
          </>
        ) : null}
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Previous</span>
          <span>{preview?.previousBalance?.text ?? '—'}</span>
        </div>
        <div className="slip__row">
          <span>Current Issued</span>
          <span>{preview?.khalisTotalDisplay ?? '0.000'} g</span>
        </div>
        <div className="slip__row slip__total">
          <span>End Balance</span>
          <span>
            {preview?.endBalance?.text ?? '—'}
            {preview?.endBalance?.drCr ? ` /${preview.endBalance.drCr}` : ''}
          </span>
        </div>
        <div className="slip__rule" />
        <div className="slip__centre">Thank You! Visit Again</div>
      </div>
    </div>
  )
}

function LedgerTable({ rows, party }: { rows: readonly LedgerRowDto[]; party: PartyDto | null }) {
  return (
    <div className="panel panel--fill">
      <div className="panel__title">
        <span>PARTY WHOLE SALE LEDGER {party ? `(${party.name})` : ''}</span>
        <span className="toolbar__end">
          <Action id="wholesale.ledger.view-full" variant="toolbar">
            View Full Ledger
          </Action>
        </span>
      </div>
      <div className="panel__body panel__body--flush">
        {rows.length === 0 ? (
          <EmptyState
            title={party ? 'No entries yet' : 'No party chosen'}
            line={
              party
                ? `Nothing has been posted for ${party.name}. Saved slips and settlements appear here.`
                : 'Choose a party on the New Whole Sale tab to see their ledger.'
            }
            actionId="wholesale.tab.new"
            actionLabel="Go to New Whole Sale"
          />
        ) : (
          <div className="table-scroll">
            <table className="grid grid--fixed">
              <colgroup>
                <col className="col--rate" />
                <col />
                <col className="col--khalis" />
                <col className="col--gross" />
                <col className="col--gross" />
                <col className="col--katt" />
                <col className="col--amount" />
                <col className="col--katt" />
                <col className="col--katt" />
                <col className="col--action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice No.</th>
                  <th>Type</th>
                  <th className="numeric">Gross (g)</th>
                  <th className="numeric">Khalis (g)</th>
                  <th className="numeric">Settled Gold</th>
                  <th className="numeric">Settled Cash</th>
                  <th className="numeric">Previous</th>
                  <th className="numeric">End Balance</th>
                  <th className="grid__action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.entryId} className={row.isReversed ? 'row--reversed' : undefined}>
                    <td className="numeric">{toDisplayDate(row.date)}</td>
                    <td>{row.invoiceNo}</td>
                    <td>
                      {row.kind}
                      {row.isOverReturn ? <span className="badge badge--warn">over</span> : null}
                      {row.isReversed ? <span className="badge">reversed</span> : null}
                    </td>
                    <td className="numeric">{row.grossDisplay}</td>
                    <td className="numeric">{row.khalisDisplay}</td>
                    <td className="numeric">{row.settledGoldDisplay}</td>
                    <td className="numeric">{row.settledCashDisplay}</td>
                    <td className="numeric">{row.previousDisplay}</td>
                    <td className={`numeric ${row.endDrCr === 'CR' ? 'negative' : 'positive'}`}>
                      {row.endDisplay} {row.endDrCr ? `/${row.endDrCr}` : ''}
                    </td>
                    <td className="grid__action">
                      <Action
                        id="wholesale.ledger.view-entry"
                        variant="icon"
                        ariaLabel={`View ${row.invoiceNo}`}
                      >
                        <Icon name="eye" size={16} />
                      </Action>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
