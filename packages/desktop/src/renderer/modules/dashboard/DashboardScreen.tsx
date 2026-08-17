import { useCallback, useEffect, useState } from 'react'
import { RateCard } from '../../components/RateCard.js'
import { EmptyState } from '../../components/EmptyState.js'
import type { InventorySummaryDto, RateDto } from '../../../shared/ipc.js'

/**
 * The Dashboard: the one place the gold rate lives, and the shop's holdings
 * at a glance.
 *
 * The rate card used to sit on every screen that prices metal. It sits here
 * now, alone: the shop types today's 24K figure once, the other three karats
 * are calculated from it (916/999, 875/999, 750/999), and every module prices
 * off the same store it always did — nothing about the effective-date model
 * changed, only where the board hangs.
 */
export function DashboardScreen({
  rates,
  onRateSaved,
}: {
  rates: readonly RateDto[]
  onRateSaved: () => void
}) {
  const [inventory, setInventory] = useState<InventorySummaryDto | null>(null)

  const refresh = useCallback(async () => {
    setInventory(await window.api.inventorySummary('category'))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, rates])

  return (
    <div className="screen dashboard">
      <div className="screen__head">
        <RateCard rates={rates} onSaved={onRateSaved} />
      </div>

      <div className="screen__body">
        <div className="entry-column">
          <div className="stat-strip">
            <div className="stat-cell">
              <span className="stat-cell__label">Pieces in stock</span>
              <span className="stat-cell__value">{inventory?.totalCount ?? '—'}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell__label">Khalis in stock</span>
              <span className="stat-cell__value">
                {inventory ? `${inventory.totalKhalisDisplay} g` : '—'}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell__label">Valuation (24K)</span>
              <span className="stat-cell__value">
                {inventory?.valuationDisplay ?? 'No 24K rate recorded'}
              </span>
            </div>
          </div>

          <div className="panel panel--fill">
            <div className="panel__title">STOCK AT A GLANCE</div>
            <div className="panel__body">
              {!inventory || inventory.rows.length === 0 ? (
                <EmptyState
                  title="Nothing in stock yet"
                  line="Pieces arrive through Opening Stock on the Stock Management screen. The summary they build shows here every morning."
                  actionId="nav.stock"
                  actionLabel="Open Stock Management"
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
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Category · Purity</th>
                          <th className="numeric">Quantity</th>
                          <th className="numeric">Gross g</th>
                          <th className="numeric">Khalis g</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.rows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            <td className="numeric">{row.count}</td>
                            <td className="numeric">{row.grossDisplay}</td>
                            <td className="numeric">{row.khalisDisplay}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Total</td>
                          <td className="numeric">{inventory.totalCount}</td>
                          <td className="numeric">{inventory.totalGrossDisplay}</td>
                          <td className="numeric">{inventory.totalKhalisDisplay}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {inventory.valuationRateDisplay ? (
                    <p className="hint">
                      Valuation at {inventory.valuationRateDisplay}, as of{' '}
                      {inventory.valuationAtDisplay} — true for that moment only.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
