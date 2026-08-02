import { useCallback, useEffect, useMemo, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
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
 */

const EMPTY_ROW: LineInputDto = { itemName: '', grossGrams: '', kattRatti: '', remarks: null }

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
  const [preview, setPreview] = useState<PreviewDto | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('—')
  const [ledger, setLedger] = useState<readonly LedgerRowDto[]>([])
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

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
    const request = { partyId: party?.id ?? '', entryDate, lines: rows, notes: null }
    void window.api.previewWholesale(request).then(setPreview)
  }, [rows, entryDate, party])

  const setRow = (index: number, patch: Partial<LineInputDto>): void =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )

  const addRow = useCallback(() => setRows((c) => [...c, { ...EMPTY_ROW }]), [])
  const clearRows = useCallback(
    () => setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]),
    [],
  )
  const deleteRow = (index: number): void =>
    setRows((current) =>
      current.length <= 1 ? [{ ...EMPTY_ROW }] : current.filter((_, i) => i !== index),
    )

  const save = useCallback(
    async (thenPrint: boolean) => {
      if (busy) return
      setBusy(true)
      setMessage(null)
      try {
        if (!party) {
          setMessage({ kind: 'bad', text: 'Choose a party before saving.' })
          return
        }
        const result = await window.api.postIssue({
          partyId: party.id,
          entryDate,
          lines: rows,
          notes: null,
        })
        if (!result.ok) {
          setMessage({ kind: 'bad', text: result.message })
          return
        }
        setMessage({
          kind: 'ok',
          text:
            `Saved ${result.invoiceNo}. ${party.name} now ${result.balanceAfter.text}.` +
            (thenPrint ? ' Sent to printer.' : ''),
        })
        clearRows()
        await Promise.all([
          refreshParty(party.id),
          window.api.nextInvoiceNo().then(setInvoiceNo),
        ])
        onPosted()
      } finally {
        setBusy(false)
      }
    },
    [busy, party, entryDate, rows, clearRows, refreshParty, onPosted],
  )

  // Published so the shell's action registry can drive these buttons.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'wholesale.row.add': addRow,
      'wholesale.row.clear': clearRows,
      'wholesale.save': () => void save(false),
      'wholesale.save-and-print': () => void save(true),
      'wholesale.print': () => window.print(),
      'wholesale.cancel': clearRows,
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
    <>
      <h1 className="module-title">WHOLE SALE MODULE</h1>

      {preview?.rateMissing ? (
        <div className="banner">
          No gold rate is recorded for {entryDate}. Set the rate for that day in Gold Rate
          before saving — every amount depends on it, and using today&apos;s would price
          this slip wrongly.
        </div>
      ) : null}

      {message ? (
        <div className={message.kind === 'ok' ? 'banner banner--good' : 'banner banner--bad'}>
          {message.text}
        </div>
      ) : null}

      <div className="workspace__split">
        <div>
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

            <div className="field-row">
              <PartySelector selected={party} onSelect={setParty} />

              <label className="field">
                <span className="field__label">Invoice No.</span>
                <span className="field__control">
                  <input className="input" value={invoiceNo} readOnly aria-label="Invoice number" />
                  <Action id="wholesale.invoice.search" variant="toolbar" ariaLabel="Find invoice">
                    <Icon name="search" size={13} />
                  </Action>
                </span>
              </label>

              <label className="field">
                <span className="field__label">Date</span>
                <input
                  className="input"
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  aria-label="Entry date"
                />
              </label>

              <label className="field">
                <span className="field__label">Gold Rate (Per Tola)</span>
                <span className="field__control">
                  <input
                    className="input input--numeric"
                    value={preview?.rateDisplay ?? 'No rate set'}
                    readOnly
                    aria-label="Gold rate per tola"
                  />
                  <Action id="rate.refresh" variant="toolbar" ariaLabel="Refresh rate">
                    <Icon name="refresh" size={13} />
                  </Action>
                </span>
              </label>
            </div>
          </div>

          {tab === 'new' ? (
            <>
              <div className="panel" style={{ marginTop: 10 }}>
                <div className="panel__title">ITEM DETAILS</div>
                <div className="panel__body">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>#</th>
                        <th>Item Name</th>
                        <th style={{ width: 96 }}>Gross Weight (g)</th>
                        <th style={{ width: 104 }}>Katt (ratti/tola)</th>
                        <th style={{ width: 96 }}>Khalis Weight (g)</th>
                        <th style={{ width: 92 }}>Rate (per tola)</th>
                        <th style={{ width: 110 }}>Amount (Rs.)</th>
                        <th style={{ width: 90 }}>Remarks</th>
                        <th style={{ width: 46 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => {
                        const computed = preview?.lines[index]
                        return (
                          <tr key={index} className={computed?.error ? 'row--error' : undefined}>
                            <td style={{ textAlign: 'center' }}>{index + 1}</td>
                            <td>
                              <input
                                className="input input--cell"
                                value={row.itemName}
                                onChange={(e) => setRow(index, { itemName: e.target.value })}
                                aria-label={`Item name row ${index + 1}`}
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
                                aria-label={`Remarks row ${index + 1}`}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="action action--icon"
                                data-action="wholesale.row.delete"
                                data-action-state="ready"
                                title="Delete this row"
                                aria-label={`Delete row ${index + 1}`}
                                onClick={() => deleteRow(index)}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Total</td>
                        <td className="numeric">( {totals.gross} )</td>
                        <td />
                        <td className="numeric positive">( {totals.khalis} )</td>
                        <td />
                        <td className="numeric">{totals.amount}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>

                  {preview?.lines.some((l) => l.error) ? (
                    <p className="hint hint--bad">
                      {preview.lines.find((l) => l.error)?.error}
                    </p>
                  ) : null}

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Action id="wholesale.row.add" variant="toolbar">
                      <Icon name="plus" size={13} /> Add Row
                    </Action>
                    <Action id="wholesale.row.clear" variant="toolbar">
                      <Icon name="cross" size={13} /> Clear Row
                    </Action>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <Action id="wholesale.import-from-stock" variant="toolbar">
                        <Icon name="upload" size={13} /> Import from Stock
                      </Action>
                      <Action id="wholesale.scan-barcode" variant="toolbar">
                        <Icon name="barcode" size={13} /> Scan Barcode
                      </Action>
                    </span>
                  </div>
                </div>
              </div>

              <div className="summary-row">
                <div className="panel">
                  <div className="panel__title">WEIGHT SUMMARY</div>
                  <div className="panel__body">
                    <div className="summary-line">
                      <span>Total Gross Weight</span>
                      <span className="summary-line__value">{totals.gross} g</span>
                    </div>
                    <div className="summary-line">
                      <span>Total Khalis Weight</span>
                      <span className="summary-line__value positive">{totals.khalis} g</span>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel__title">AMOUNT SUMMARY</div>
                  <div className="panel__body">
                    <div className="summary-line">
                      <span>Rate (per tola)</span>
                      <span className="summary-line__value">
                        {preview?.rateDisplay ?? '—'}
                      </span>
                    </div>
                    <div className="summary-line">
                      <span>Total Amount</span>
                      <span className="summary-line__value">Rs. {totals.amount}</span>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel__title">BALANCE</div>
                  <div className="panel__body">
                    <div className="summary-line">
                      <span>Previous</span>
                      <span className="summary-line__value">
                        {preview?.previousBalance?.text ?? '—'}
                      </span>
                    </div>
                    <div className="summary-line">
                      <span>Current Issued</span>
                      <span className="summary-line__value">{totals.khalis} g</span>
                    </div>
                    <div className="summary-line">
                      <span>End Balance</span>
                      <span
                        className={`summary-line__value ${
                          preview?.endBalance?.direction === 'shop-owes-party'
                            ? 'negative'
                            : 'positive'
                        }`}
                      >
                        {preview?.endBalance?.text ?? '—'}{' '}
                        {preview?.endBalance?.drCr ? `/${preview.endBalance.drCr}` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="action-bar">
                <Action
                  id="wholesale.save"
                  variant="primary"
                  style={{ background: 'var(--colour-action-save)' }}
                >
                  <Icon name="save" size={17} />
                  <span>SAVE (F5)</span>
                </Action>
                <Action
                  id="wholesale.save-and-print"
                  variant="primary"
                  style={{ background: 'var(--colour-action-save-print)' }}
                >
                  <Icon name="print" size={17} />
                  <span>SAVE &amp; PRINT (F6)</span>
                </Action>
                <Action
                  id="wholesale.print"
                  variant="primary"
                  style={{ background: 'var(--colour-action-print)' }}
                >
                  <Icon name="print" size={17} />
                  <span>PRINT (F7)</span>
                </Action>
                <Action
                  id="wholesale.hold"
                  variant="primary"
                  style={{ background: 'var(--colour-action-hold)' }}
                >
                  <Icon name="pause" size={17} />
                  <span>HOLD (F8)</span>
                </Action>
                <Action
                  id="wholesale.cancel"
                  variant="primary"
                  style={{ background: 'var(--colour-action-cancel)' }}
                >
                  <Icon name="cross" size={17} />
                  <span>CANCEL</span>
                </Action>
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

          {tab === 'new' ? <LedgerTable rows={ledger} party={party} compact /> : null}
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
                <p className="hint">Choose a party to see their balance.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
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
  return (
    <div className="panel">
      <div className="panel__title">INVOICE PREVIEW (80mm)</div>
      <div className="panel__body slip">
        <div style={{ textAlign: 'center', fontWeight: 700 }}>
          AL-HARAM
          <br />
          GOLD JEWELLERS
        </div>
        <div style={{ textAlign: 'center' }}>Trust in Purity</div>
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Invoice No.</span>
          <span>{invoiceNo}</span>
        </div>
        <div className="slip__row">
          <span>Date</span>
          <span>{date}</span>
        </div>
        <div className="slip__row">
          <span>Party</span>
          <span>{party?.name ?? '—'}</span>
        </div>
        <div className="slip__row">
          <span>Rate</span>
          <span>{preview?.rateDisplay ? `${preview.rateDisplay}/tola` : '—'}</span>
        </div>
        <div className="slip__rule" />
        <div className="slip__row slip__head">
          <span>ITEM</span>
          <span>GR</span>
          <span>KATT</span>
          <span>PR</span>
        </div>
        {(preview?.lines ?? [])
          .filter((line) => !line.error)
          .map((line, index) => (
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
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Previous</span>
          <span>{preview?.previousBalance?.text ?? '—'}</span>
        </div>
        <div className="slip__row">
          <span>Current Issued</span>
          <span>{preview?.khalisTotalDisplay ?? '0.000'} g</span>
        </div>
        <div className="slip__row" style={{ fontWeight: 700 }}>
          <span>End Balance</span>
          <span>
            {preview?.endBalance?.text ?? '—'}
            {preview?.endBalance?.drCr ? ` /${preview.endBalance.drCr}` : ''}
          </span>
        </div>
        <div className="slip__rule" />
        <div style={{ textAlign: 'center' }}>Thank You! Visit Again</div>
      </div>
    </div>
  )
}

function LedgerTable({
  rows,
  party,
  compact,
}: {
  rows: readonly LedgerRowDto[]
  party: PartyDto | null
  compact?: boolean
}) {
  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="panel__title" style={{ display: 'flex', alignItems: 'center' }}>
        <span>PARTY WHOLE SALE LEDGER {party ? `(${party.name})` : ''}</span>
        <span style={{ marginLeft: 'auto' }}>
          <Action id="wholesale.ledger.view-full" variant="toolbar">
            View Full Ledger
          </Action>
        </span>
      </div>
      <div className="panel__body">
        {rows.length === 0 ? (
          <p className="hint">
            {party ? 'No entries yet for this party.' : 'Choose a party to see their ledger.'}
          </p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice No.</th>
                <th>Type</th>
                <th>Gross (g)</th>
                <th>Khalis (g)</th>
                <th>Settled Gold (g)</th>
                <th>Settled Cash (Rs)</th>
                <th>Previous</th>
                <th>End Balance</th>
                <th style={{ width: 46 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {(compact ? rows.slice(-4) : rows).map((row) => (
                <tr key={row.entryId} className={row.isReversed ? 'row--reversed' : undefined}>
                  <td>{row.date}</td>
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
                  <td style={{ textAlign: 'center' }}>
                    <Action
                      id="wholesale.ledger.view-entry"
                      variant="icon"
                      ariaLabel={`View ${row.invoiceNo}`}
                    >
                      <Icon name="eye" size={14} />
                    </Action>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
