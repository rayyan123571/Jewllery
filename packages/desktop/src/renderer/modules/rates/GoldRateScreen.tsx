import { useState, type FormEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { DateField } from '../../components/DateField.js'
import { toDisplayDate } from '../../format/dates.js'
import type { RateDto } from '../../../shared/ipc.js'

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
 * readable — the same principle as never editing a posted transaction.
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
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setSaved(null)
    setBusy(true)
    try {
      const result = await window.api.setRate({
        purity,
        ratePerTolaRupees: amount,
        effectiveFrom,
        note: note.trim() || null,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSaved(`${purity} set to Rs ${amount} per tola from ${toDisplayDate(effectiveFrom)}.`)
      setAmount('')
      setNote('')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the rate.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="module-title">GOLD RATE</h1>

      <div className="workspace__split">
        <form className="panel" onSubmit={save}>
          <div className="panel__title">SET RATE (PER TOLA)</div>
          <div className="panel__body">
            <div className="field-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', padding: 0 }}>
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
                  placeholder="market drop"
                />
              </label>
            </div>

            <p className="hint">
              A rate applies from its effective date onward. Anything already posted keeps
              the rate it was posted at — setting a rate today never reprices yesterday.
            </p>

            {/* Goes through <Action> like every other control now. It was a
                hand-written <button> carrying a data-action attribute, which
                satisfied the test without satisfying the rule the test exists
                for. `type="submit"` keeps Enter-in-a-field submitting. */}
            <Action id="goldrate.set" className="login__submit" type="submit" busy={busy}>
              {busy ? 'Saving…' : 'Save rate'}
            </Action>

            {error ? <div className="login__error">{error}</div> : null}
            {saved ? <div className="banner banner--good">{saved}</div> : null}
          </div>
        </form>

        <aside className="rail">
          <div className="panel">
            <div className="panel__title">CURRENT RATES (PER TOLA)</div>
            <div className="panel__body">
              {rates.length === 0 ? (
                <p className="hint">
                  No rate set. Wholesale cannot compute an amount until one is recorded —
                  it will refuse rather than guess.
                </p>
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
    </>
  )
}
