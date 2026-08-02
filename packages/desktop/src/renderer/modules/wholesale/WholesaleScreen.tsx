import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'

/**
 * The Whole Sale screen from docs/mockup.png.
 *
 * The layout is real; none of it is wired, because Whole Sale is M2. Every
 * control here goes through the action registry and renders disabled with hover
 * text naming its module — including the two that belong to Stock Management
 * rather than to Whole Sale, which say so.
 *
 * The figures shown are the mockup's own sample values, marked as such. They are
 * static text, not a calculation: nothing on this screen computes anything, and
 * when M2 arrives the numbers will come from the application layer over IPC.
 *
 * ── One deliberate divergence from the mockup ──────────────────────────────
 * The mockup's Party Summary shows "Remaining Weight : -0.500 g" as a bare
 * minus. docs/DECISIONS.md §4, which you approved, says a balance is never
 * shown with a bare minus sign because a busy shopkeeper misreads it — it is
 * shown as a magnitude with an explicit label. So this renders
 * "0.500 g (we owe)". The approved rule wins over the mockup; flagging it here
 * rather than silently picking one.
 */

const SAMPLE_ROWS = [
  { n: 1, item: 'Gold Chain', purity: '22K', given: '500.000', cut: '125.500', remaining: '374.500', rate: '8,950', amount: '4,471,750' },
  { n: 2, item: 'Gold Ring', purity: '22K', given: '200.000', cut: '50.000', remaining: '150.000', rate: '8,950', amount: '1,342,500' },
  { n: 3, item: 'Gold Bangles', purity: '22K', given: '300.000', cut: '75.000', remaining: '225.000', rate: '8,950', amount: '2,013,750' },
]

const LEDGER_ROWS = [
  { date: '15-07-2026', invoice: 'WS-10025', type: 'Given', given: '700.000', returned: '0.000', cut: '250.500', remaining: '449.500', amount: '7,828,000', paid: '7,828,000', balance: '0' },
  { date: '18-07-2026', invoice: 'RT-10008', type: 'Return', given: '0.000', returned: '250.000', cut: '0.000', remaining: '199.500', amount: '-2,237,500', paid: '-2,237,500', balance: '0' },
  { date: '21-07-2026', invoice: 'RT-10012', type: 'Return', given: '0.000', returned: '200.000', cut: '0.000', remaining: '-0.500', amount: '-1,790,000', paid: '-1,790,000', balance: '0' },
]

export function WholesaleScreen() {
  return (
    <>
      <h1 className="module-title">WHOLE SALE MODULE</h1>

      <div className="workspace__split">
        <div>
          <div className="panel">
            <div className="tabs">
              <Action id="wholesale.tab.new" variant="tab" active>
                New Whole Sale
              </Action>
              <Action id="wholesale.tab.ledger" variant="tab">
                Whole Sale Ledger
              </Action>
              <Action id="wholesale.tab.return" variant="tab">
                Return / Receive
              </Action>
              <Action id="wholesale.tab.history" variant="tab">
                History
              </Action>
            </div>

            <div className="field-row">
              <label className="field">
                <span className="field__label">Party / Customer</span>
                <span className="field__control">
                  <select className="select" disabled>
                    <option>Haji Abdul Rehman Gold House</option>
                  </select>
                  <Action id="wholesale.party.add" variant="toolbar" ariaLabel="Add party">
                    <Icon name="plus" size={13} />
                  </Action>
                </span>
              </label>

              <label className="field">
                <span className="field__label">Invoice No.</span>
                <span className="field__control">
                  <input className="input" value="WS-10025" readOnly disabled />
                  <Action id="wholesale.invoice.search" variant="toolbar" ariaLabel="Find invoice">
                    <Icon name="search" size={13} />
                  </Action>
                </span>
              </label>

              <label className="field">
                <span className="field__label">Date</span>
                <input className="input" value="15-07-2026" readOnly disabled />
              </label>

              <label className="field">
                <span className="field__label">Gold Rate (Per Gram)</span>
                <span className="field__control">
                  <input className="input input--numeric" value="8,950" readOnly disabled />
                  <Action id="rate.refresh" variant="toolbar" ariaLabel="Refresh rate">
                    <Icon name="refresh" size={13} />
                  </Action>
                </span>
              </label>

              <label className="field">
                <span className="field__label">Salesman</span>
                <select className="select" disabled>
                  <option>Admin</option>
                </select>
              </label>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel__title">ITEM DETAILS</div>
            <div className="panel__body">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item Name</th>
                    <th>Purity</th>
                    <th>Weight Given (Gram)</th>
                    <th>Cut Weight (Gram)</th>
                    <th>Remaining Weight (Gram)</th>
                    <th>Rate (Per Gram)</th>
                    <th>Amount (Rs.)</th>
                    <th>Remarks</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ROWS.map((row) => (
                    <tr key={row.n}>
                      <td style={{ textAlign: 'center' }}>{row.n}</td>
                      <td>{row.item}</td>
                      <td style={{ textAlign: 'center' }}>{row.purity}</td>
                      <td className="numeric">{row.given}</td>
                      <td className="numeric">{row.cut}</td>
                      <td className="numeric positive">{row.remaining}</td>
                      <td className="numeric">{row.rate}</td>
                      <td className="numeric">{row.amount}</td>
                      <td style={{ textAlign: 'center' }}>-</td>
                      <td style={{ textAlign: 'center' }}>
                        <Action
                          id="wholesale.row.delete"
                          variant="icon"
                          ariaLabel={`Delete row ${row.n}`}
                        >
                          <Icon name="trash" size={14} />
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

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
                  <span>Total Weight Given</span>
                  <span className="summary-line__value">700.000 g</span>
                </div>
                <div className="summary-line">
                  <span>Total Cut Weight</span>
                  <span className="summary-line__value negative">250.500 g</span>
                </div>
                <div className="summary-line">
                  <span>Total Remaining Weight</span>
                  <span className="summary-line__value positive">449.500 g</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel__title">AMOUNT SUMMARY</div>
              <div className="panel__body">
                <div className="summary-line">
                  <span>Total Amount</span>
                  <span className="summary-line__value">Rs. 7,828,000</span>
                </div>
                <div className="summary-line">
                  <span>Discount</span>
                  <span className="summary-line__value">Rs. 0</span>
                </div>
                <div className="summary-line">
                  <span>Net Amount</span>
                  <span className="summary-line__value positive">Rs. 7,828,000</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel__title">PAYMENT DETAILS</div>
              <div className="panel__body">
                <div className="summary-line">
                  <span>Payment Method</span>
                  <select className="select" style={{ width: 120 }} disabled>
                    <option>Cash</option>
                  </select>
                </div>
                <div className="summary-line">
                  <span>Paid Amount</span>
                  <span className="summary-line__value">7,828,000</span>
                </div>
                <div className="summary-line">
                  <span>Balance Amount</span>
                  <span className="summary-line__value positive">0</span>
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

          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel__title" style={{ display: 'flex', alignItems: 'center' }}>
              <span>PARTY WHOLE SALE LEDGER (Haji Abdul Rehman Gold House)</span>
              <span style={{ marginLeft: 'auto' }}>
                <Action id="wholesale.ledger.view-full" variant="toolbar">
                  View Full Ledger
                </Action>
              </span>
            </div>
            <div className="panel__body">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoice No.</th>
                    <th>Type</th>
                    <th>Weight Given (g)</th>
                    <th>Weight Returned (g)</th>
                    <th>Cut Weight (g)</th>
                    <th>Remaining Weight (g)</th>
                    <th>Amount (Rs.)</th>
                    <th>Paid (Rs.)</th>
                    <th>Balance (Rs.)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {LEDGER_ROWS.map((row) => (
                    <tr key={row.invoice}>
                      <td>{row.date}</td>
                      <td>{row.invoice}</td>
                      <td>{row.type}</td>
                      <td className="numeric">{row.given}</td>
                      <td className="numeric">{row.returned}</td>
                      <td className="numeric">{row.cut}</td>
                      <td
                        className={`numeric ${row.remaining.startsWith('-') ? 'negative' : 'positive'}`}
                      >
                        {row.remaining}
                      </td>
                      <td className="numeric">{row.amount}</td>
                      <td className="numeric">{row.paid}</td>
                      <td className="numeric">{row.balance}</td>
                      <td style={{ textAlign: 'center' }}>
                        <Action
                          id="wholesale.ledger.view-entry"
                          variant="icon"
                          ariaLabel={`View ${row.invoice}`}
                        >
                          <Icon name="eye" size={14} />
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="numeric">700.000</td>
                    <td className="numeric">450.000</td>
                    <td className="numeric">250.500</td>
                    <td className="numeric negative">-0.500</td>
                    <td className="numeric">3,800,500</td>
                    <td className="numeric">3,800,500</td>
                    <td className="numeric">0</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <aside className="rail">
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
                <span>WS-10025</span>
              </div>
              <div className="slip__row">
                <span>Date</span>
                <span>15-07-2026</span>
              </div>
              <div className="slip__row">
                <span>Party</span>
                <span>Haji Abdul Rehman</span>
              </div>
              <div className="slip__rule" />
              {SAMPLE_ROWS.map((row) => (
                <div className="slip__row" key={row.n}>
                  <span>{row.item}</span>
                  <span>{row.remaining}</span>
                </div>
              ))}
              <div className="slip__rule" />
              <div className="slip__row">
                <span>Total Given</span>
                <span>700.000 g</span>
              </div>
              <div className="slip__row">
                <span>Total Cut</span>
                <span>250.500 g</span>
              </div>
              <div className="slip__row">
                <span>Total Remaining</span>
                <span>449.500 g</span>
              </div>
              <div className="slip__rule" />
              <div style={{ textAlign: 'center' }}>Thank You! Visit Again</div>
            </div>
          </div>

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
              <div className="summary-line">
                <span>Total Weight Given</span>
                <span className="summary-line__value">700.000 g</span>
              </div>
              <div className="summary-line">
                <span>Total Weight Returned</span>
                <span className="summary-line__value">450.000 g</span>
              </div>
              <div className="summary-line">
                <span>Total Cut Weight</span>
                <span className="summary-line__value">250.500 g</span>
              </div>
              <div className="summary-line">
                <span>Remaining Weight</span>
                {/* The mockup prints "-0.500 g". DECISIONS §4 says a balance is
                    never shown with a bare minus, because it is misread at a
                    counter — magnitude plus an explicit label instead. */}
                <span className="summary-line__value negative">0.500 g (we owe)</span>
              </div>
              <div className="summary-line">
                <span>Total Amount</span>
                <span className="summary-line__value">Rs. 7,828,000</span>
              </div>
              <div className="summary-line">
                <span>Balance Amount</span>
                <span className="summary-line__value positive">Rs. 0</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}
