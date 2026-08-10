import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { DateField } from '../../components/DateField.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { toDisplayDate } from '../../format/dates.js'
import type { RateDto, RateHistoryDto } from '../../../shared/ipc.js'

/**
 * Setting the gold rate.
 *
 * The rate is entered and shown **per tola**, because that is the unit the trade
 * quotes and the unit it is stored in. It is never converted to per-gram
 * anywhere — Rs 358,000 per tola is not a whole number of paisa per gram, and
 * rounding it at storage time loses money silently on every transaction.
 *
 * Recording a rate never overwrites an earlier one. A rate is a fact about a
 * period of time, so a correction is a new row with a note and the history stays
 * readable — the same principle as never editing a posted transaction. That is
 * why the history table below matters: it is the only place a mistyped rate that
 * has since been corrected is still visible.
 */
export function GoldRateScreen({
  rates,
  today,
  onSaved,
}: {
  rates: readonly RateDto[]
  today: string
  onSaved: () => void
}) {
  const [purity, setPurity] = useState('K22')
  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { push } = useMessages()
  const [history, setHistory] = useState<readonly RateHistoryDto[]>([])

  const loadHistory = useCallback(async () => {
    setHistory(await window.api.rateHistory())
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  async function save(): Promise<void> {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const result = await window.api.setRate({
        purity,
        ratePerTolaRupees: amount,
        effectiveFrom,
        note: note.trim() || null,
      })
      if (!result.ok) {
        // Includes the purity-ordering refusal: a lower purity may never be
        // worth more per tola than a higher one.
        setError(result.message)
        return
      }
      push(
        'ok',
        `${purity.slice(1)}K set to Rs ${amount} per tola from ${toDisplayDate(effectiveFrom)}.`,
      )
      setAmount('')
      setNote('')
      await loadHistory()
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the rate.')
    } finally {
      setBusy(false)
    }
  }

  // Enter saves from any field, as it did when this was a <form>. Done
  // explicitly for the same reason as on the sign-in screen: implicit
  // submission is not something to rely on once the button is a real control.
  const onEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    }
  }

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="module-title">GOLD RATE</h1>
      </div>

      <div className="workspace__split screen__body">
        <div className="entry-column">
          <div className="panel">
            <div className="panel__title">SET RATE (PER TOLA)</div>
            <div className="panel__body">
              <div className="field-row field-row--flush">
                <label className="field">
                  <span className="field__label">Purity</span>
                  <select
                    className="select"
                    value={purity}
                    onChange={(e) => setPurity(e.target.value)}
                  >
                    {['K24', 'K22', 'K21', 'K18'].map((p) => (
                      <option key={p} value={p}>
                        {p.slice(1)}K
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">Rate (Rs per tola)</span>
                  <input
                    className="input input--numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={onEnter}
                    placeholder="358000"
                    inputMode="decimal"
                  />
                </label>

                <DateField
                  value={effectiveFrom}
                  onChange={setEffectiveFrom}
                  label="Effective from"
                  ariaLabel="Effective from"
                />

                <label className="field">
                  <span className="field__label">Note (optional)</span>
                  <input
                    className="input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={onEnter}
                    placeholder="market drop"
                  />
                </label>
              </div>

              <p className="hint">
                A rate applies from its effective date onward. Anything already posted keeps
                the rate it was posted at — setting a rate today never reprices yesterday.
              </p>

              {error ? (
                <div className="login__error" role="alert">
                  {error}
                </div>
              ) : null}
            </div>
            <div className="panel__foot">
              <Action id="goldrate.set" className="login__submit" busy={busy} onActivate={save}>
                {busy ? 'Saving…' : 'Save rate'}
              </Action>
            </div>
          </div>

          <div className="panel panel--fill">
            <div className="panel__title">RATE HISTORY</div>
            <div className="panel__body panel__body--flush">
              {history.length === 0 ? (
                <EmptyState
                  title="No rate recorded yet"
                  line="Every rate you set is kept here with its effective date, so a correction never hides what was quoted before it."
                />
              ) : (
                <div className="table-scroll">
                  <table className="grid grid--fixed">
                    <colgroup>
                      <col className="col--rate" />
                      <col className="col--index" />
                      <col className="col--amount" />
                      <col />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Effective</th>
                        <th>Purity</th>
                        <th className="numeric">Rate / tola</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id}>
                          <td className="numeric">{toDisplayDate(row.effectiveFrom)}</td>
                          <td>{row.purity}</td>
                          <td className="numeric">{row.display}</td>
                          <td>{row.note ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="rail">
          <div className="panel">
            <div className="panel__title">CURRENT RATES (PER TOLA)</div>
            <div className="panel__body">
              {rates.length === 0 ? (
                <EmptyState
                  title="No rate set"
                  line="Whole Sale cannot compute an amount until one is recorded — it refuses rather than guessing."
                />
              ) : (
                rates.map((rate) => (
                  <div className="summary-line" key={rate.purity}>
                    <span>{rate.purity}</span>
                    <span className="summary-line__value">{rate.display}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
