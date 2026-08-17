import { useCallback, useEffect, useMemo, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { DateField } from '../../components/DateField.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { toDisplayDate } from '../../format/dates.js'
import type {
  StockLedgerRowDto,
  StockSummaryDto,
} from '../../../shared/ipc.js'
import { ItemsPanel } from './ItemsPanel.js'
import { SetupPanel } from './SetupPanel.js'
import { InventoryPanel } from './InventoryPanel.js'
import { OpeningPanel } from './OpeningPanel.js'

/**
 * Stock Management: what the shop is holding, told by the ledger.
 *
 * Three views over one append-only table:
 *
 *   Summary    — current gross and khalis per bucket, plus the valuation at
 *                this moment's 24K rate. The rate and the timestamp are shown
 *                beside it because the valuation is only true for that moment.
 *   Ledger     — every movement, newest first, with running balances in the
 *                rightmost columns. Clicking a reference opens the purchase
 *                that produced the movement.
 *   Adjustment — a manual correction, written as an ADJUSTMENT row like any
 *                other. It requires a reason, because it is the row everyone
 *                will read later.
 *
 * A negative bucket is SHOWN — "2 buckets negative", the rows marked — never
 * blocked and never hidden. Blocking it means the shop stops using the
 * software; hiding it means the books quietly stop being true.
 */

type Tab = 'inventory' | 'opening' | 'summary' | 'ledger' | 'adjust' | 'items' | 'setup'

const BUCKETS = ['SCRAP', 'FINISHED', 'BULLION'] as const
const KINDS = [
  'OPENING',
  'PURCHASE_IN',
  'SALE_OUT',
  'MELT_IN',
  'MELT_OUT',
  'ADJUSTMENT',
] as const

export function StockScreen({
  today,
  onOpenPurchase,
}: {
  today: string
  /** Hands a purchase number to the shell, which opens the Purchase screen on it. */
  onOpenPurchase: (invoiceNumber: number) => void
}) {
  // The morning screen first: what the shop is holding, piece by piece.
  const [tab, setTab] = useState<Tab>('inventory')
  /** Bumped when opening stock posts, so the inventory summary re-reads. */
  const [reloadKey, setReloadKey] = useState(0)
  const [summary, setSummary] = useState<StockSummaryDto | null>(null)
  const [ledger, setLedger] = useState<readonly StockLedgerRowDto[]>([])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [bucketFilter, setBucketFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const { push } = useMessages()

  // ── adjustment form ───────────────────────────────────────────────────────
  const [adjBucket, setAdjBucket] = useState<string>('SCRAP')
  const [adjDirection, setAdjDirection] = useState<'add' | 'remove'>('add')
  const [adjGross, setAdjGross] = useState('')
  const [adjKatt, setAdjKatt] = useState('')
  const [adjItem, setAdjItem] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [saving, setSaving] = useState(false)

  const filter = useMemo(
    () => ({
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(bucketFilter ? { bucket: bucketFilter } : {}),
      ...(kindFilter ? { kind: kindFilter } : {}),
    }),
    [fromDate, toDate, bucketFilter, kindFilter],
  )

  const refresh = useCallback(async () => {
    const [nextSummary, nextLedger] = await Promise.all([
      window.api.stockSummary(),
      window.api.stockLedger(filter),
    ])
    setSummary(nextSummary)
    setLedger(nextLedger)
  }, [filter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const saveAdjustment = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.api.stockAdjust({
        bucket: adjBucket,
        direction: adjDirection,
        grossGrams: adjGross,
        kattRatti: adjKatt,
        itemName: adjItem.trim() || null,
        reason: adjReason,
      })
      if (!result.ok) {
        push('bad', result.message)
        return
      }
      push(
        'ok',
        `Adjustment recorded: ${adjGross || '0'} g gross ` +
          `(${result.khalisDisplay} g khalis) ${adjDirection === 'add' ? 'into' : 'out of'} ` +
          `${adjBucket}. It is a ledger row like any other.`,
      )
      setAdjGross('')
      setAdjKatt('')
      setAdjItem('')
      setAdjReason('')
      await refresh()
      setTab('ledger')
    } finally {
      setSaving(false)
    }
  }, [saving, adjBucket, adjDirection, adjGross, adjKatt, adjItem, adjReason, refresh, push])

  // The shell's registry drives the tab and save buttons, like every screen.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'stock.tab.inventory': () => setTab('inventory'),
      'stock.tab.opening': () => setTab('opening'),
      'stock.tab.summary': () => setTab('summary'),
      'stock.tab.ledger': () => setTab('ledger'),
      'stock.tab.adjust': () => setTab('adjust'),
      'stock.tab.items': () => setTab('items'),
      'stock.tab.setup': () => setTab('setup'),
      'stock.refresh': () => void refresh(),
      'stock.adjust.save': () => void saveAdjustment(),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [refresh, saveAdjustment])

  const negativeCount = summary?.negativeBuckets.length ?? 0

  return (
    <div className="screen stock">
      <div className="screen__head">
        {negativeCount > 0 ? (
          <div className="banner">
            {negativeCount} bucket{negativeCount > 1 ? 's' : ''} negative:{' '}
            {summary?.negativeBuckets.join(', ')}. The books say more metal left than
            arrived — usually a piece sold while still being made, or a missing
            purchase. The rows are in the ledger; nothing is hidden.
          </div>
        ) : null}
      </div>

      <div className="screen__body">
        <div className="entry-column">
          <div className="panel panel--fill">
            <div className="tabs">
              <Action id="stock.tab.inventory" variant="tab" active={tab === 'inventory'}>
                Inventory
              </Action>
              <Action id="stock.tab.opening" variant="tab" active={tab === 'opening'}>
                Opening Stock
              </Action>
              <Action id="stock.tab.summary" variant="tab" active={tab === 'summary'}>
                Metal
              </Action>
              <Action id="stock.tab.ledger" variant="tab" active={tab === 'ledger'}>
                Ledger
              </Action>
              <Action id="stock.tab.adjust" variant="tab" active={tab === 'adjust'}>
                Adjustment
              </Action>
              <Action id="stock.tab.items" variant="tab" active={tab === 'items'}>
                Items
              </Action>
              <Action id="stock.tab.setup" variant="tab" active={tab === 'setup'}>
                Categories &amp; Locations
              </Action>
              <span className="toolbar__end">
                <Action id="stock.refresh" variant="toolbar">
                  <Icon name="refresh" size={16} /> Refresh
                </Action>
              </span>
            </div>

            {tab === 'inventory' ? <InventoryPanel reloadKey={reloadKey} /> : null}
            {tab === 'opening' ? (
              <OpeningPanel
                today={today}
                onPosted={() => {
                  setReloadKey((key) => key + 1)
                  void refresh()
                  setTab('inventory')
                }}
              />
            ) : null}
            {tab === 'summary' ? <SummaryView summary={summary} /> : null}
            {tab === 'items' ? <ItemsPanel /> : null}
            {tab === 'setup' ? <SetupPanel /> : null}
            {tab === 'ledger' ? (
              <>
                {/* The filters narrow what is SHOWN. The running balance is
                    computed over the whole book, so the rightmost column always
                    agrees with the summary. */}
                <div className="field-row">
                  <DateField
                    value={fromDate}
                    onChange={setFromDate}
                    label="From"
                    ariaLabel="Ledger from date"
                  />
                  <DateField
                    value={toDate}
                    onChange={setToDate}
                    label="To"
                    ariaLabel="Ledger to date"
                  />
                  <label className="field">
                    <span className="field__label">Bucket</span>
                    <select
                      className="input"
                      value={bucketFilter}
                      onChange={(e) => setBucketFilter(e.target.value)}
                      aria-label="Filter by bucket"
                    >
                      <option value="">All buckets</option>
                      {BUCKETS.map((bucket) => (
                        <option key={bucket} value={bucket}>
                          {bucket}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Kind</span>
                    <select
                      className="input"
                      value={kindFilter}
                      onChange={(e) => setKindFilter(e.target.value)}
                      aria-label="Filter by kind"
                    >
                      <option value="">All kinds</option>
                      {KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <LedgerView rows={ledger} onOpenPurchase={onOpenPurchase} />
              </>
            ) : null}
            {tab === 'adjust' ? (
              <div className="panel__body">
                <p className="callout">
                  A physical count found something the books do not show. Record the
                  difference here — it is written as an ADJUSTMENT row in the ledger,
                  as visible as every purchase, and it never overwrites anything.
                </p>
                <div className="field-row">
                  <label className="field">
                    <span className="field__label">Bucket</span>
                    <select
                      className="input"
                      value={adjBucket}
                      onChange={(e) => setAdjBucket(e.target.value)}
                      aria-label="Adjustment bucket"
                    >
                      {BUCKETS.map((bucket) => (
                        <option key={bucket} value={bucket}>
                          {bucket}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Direction</span>
                    <select
                      className="input"
                      value={adjDirection}
                      onChange={(e) =>
                        setAdjDirection(e.target.value === 'remove' ? 'remove' : 'add')
                      }
                      aria-label="Adjustment direction"
                    >
                      <option value="add">Count found MORE — add to stock</option>
                      <option value="remove">Count found LESS — remove from stock</option>
                    </select>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span className="field__label">Gross (g)</span>
                    <input
                      className="input input--numeric"
                      value={adjGross}
                      onChange={(e) => setAdjGross(e.target.value)}
                      placeholder="0.000"
                      inputMode="decimal"
                      aria-label="Adjustment gross weight"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Katt (r/t)</span>
                    <input
                      className="input input--numeric"
                      value={adjKatt}
                      onChange={(e) => setAdjKatt(e.target.value)}
                      placeholder="0.000"
                      inputMode="decimal"
                      aria-label="Adjustment katt"
                    />
                    <span className="field__hint">
                      Khalis is computed from gross and katt — the same arithmetic as a
                      purchase line. Empty katt means the khalis equals the gross.
                    </span>
                  </label>
                  <label className="field">
                    <span className="field__label">Item (optional)</span>
                    <input
                      className="input"
                      value={adjItem}
                      onChange={(e) => setAdjItem(e.target.value)}
                      placeholder="e.g. Filings tray"
                      aria-label="Adjustment item name"
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field__label">Reason (required)</span>
                  <input
                    className="input"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="e.g. Monthly count — scrap tray weighed 0.4 g short"
                    aria-label="Adjustment reason"
                  />
                </label>
                <div className="panel__foot panel__foot--flush">
                  <Action
                    id="stock.adjust.save"
                    variant="primary"
                    busy={saving}
                    onActivate={() => void saveAdjustment()}
                  >
                    Record Adjustment
                  </Action>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryView({ summary }: { summary: StockSummaryDto | null }) {
  if (!summary) {
    return (
      <div className="panel__body">
        <EmptyState title="Loading" line="Reading the stock ledger…" />
      </div>
    )
  }
  return (
    <div className="panel__body">
      <div className="table-scroll">
        <table className="grid grid--fixed">
          <colgroup>
            <col />
            <col className="col--amount" />
            <col className="col--amount" />
            <col className="col--remarks" />
          </colgroup>
          <thead>
            <tr>
              <th>Bucket</th>
              <th className="numeric">Gross g</th>
              <th className="numeric">Khalis g</th>
              <th>Standing</th>
            </tr>
          </thead>
          <tbody>
            {summary.buckets.map((bucket) => (
              <tr key={bucket.bucket} className={bucket.isNegative ? 'row--error' : undefined}>
                <td>{bucket.bucket}</td>
                <td className="numeric">{bucket.grossDisplay}</td>
                <td className="numeric">{bucket.khalisDisplay}</td>
                <td>
                  {bucket.isNegative ? (
                    <span className="badge badge--warn">negative</span>
                  ) : (
                    <span className="muted">in hand</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="numeric">{summary.totalGrossDisplay}</td>
              <td className="numeric">{summary.totalKhalisDisplay}</td>
              <td>{summary.totalIsNegative ? <span className="badge badge--warn">negative</span> : null}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* The valuation names its rate and its moment, because it is only true
          for that moment — the same figure an hour later is a different figure. */}
      <div className="stat-strip">
        <div className="stat-cell">
          <span className="stat-cell__label">Valuation (24K, khalis)</span>
          <span className="stat-cell__value">
            {summary.valuationDisplay ?? 'No 24K rate recorded'}
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell__label">At rate</span>
          <span className="stat-cell__value">{summary.valuationRateDisplay ?? '—'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell__label">As of</span>
          <span className="stat-cell__value">{summary.valuationAtDisplay || '—'}</span>
        </div>
      </div>
    </div>
  )
}

function LedgerView({
  rows,
  onOpenPurchase,
}: {
  rows: readonly StockLedgerRowDto[]
  onOpenPurchase: (invoiceNumber: number) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="panel__body">
        <EmptyState
          title="No movements"
          line="Nothing matches these filters. Posted purchases and adjustments appear here."
        />
      </div>
    )
  }
  return (
    <div className="panel__body panel__body--flush">
      <div className="table-scroll">
        <table className="grid grid--fixed">
          <colgroup>
            <col className="col--rate" />
            <col className="col--khalis" />
            <col className="col--khalis" />
            <col />
            <col className="col--gross" />
            <col className="col--katt" />
            <col className="col--gross" />
            <col className="col--rate" />
            <col className="col--gross" />
            <col className="col--gross" />
          </colgroup>
          <thead>
            <tr>
              <th>Date</th>
              <th>Kind</th>
              <th>Bucket</th>
              <th>Item</th>
              <th className="numeric">Gross g</th>
              <th className="numeric">Katt</th>
              <th className="numeric">Khalis g</th>
              <th>Reference</th>
              <th className="numeric">Run. Gross</th>
              <th className="numeric">Run. Khalis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.direction === 'out' ? 'row--reversed' : undefined}>
                <td className="numeric" title={row.atDisplay}>
                  {toDisplayDate(row.date)}
                </td>
                <td>
                  {row.kind}
                  {row.direction === 'out' ? <span className="badge">out</span> : null}
                </td>
                <td>{row.bucket}</td>
                <td title={row.note ?? undefined}>{row.itemName ?? row.note ?? '—'}</td>
                <td className="numeric">{row.grossDisplay}</td>
                <td className="numeric">{row.kattDisplay ?? '—'}</td>
                <td className="numeric">{row.khalisDisplay}</td>
                <td>
                  {row.refInvoiceNumber !== null && row.refDisplay ? (
                    <Action
                      id="stock.ledger.open-ref"
                      variant="plain"
                      className="link"
                      ariaLabel={`Open ${row.refDisplay}`}
                      onActivate={() => {
                        if (row.refInvoiceNumber !== null) onOpenPurchase(row.refInvoiceNumber)
                      }}
                    >
                      {row.refDisplay}
                    </Action>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className={`numeric${row.runningIsNegative ? ' negative' : ''}`}>
                  {row.runningGrossDisplay}
                  {row.runningIsNegative ? ' (short)' : ''}
                </td>
                <td className={`numeric${row.runningIsNegative ? ' negative' : ''}`}>
                  {row.runningKhalisDisplay}
                  {row.runningIsNegative ? ' (short)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
