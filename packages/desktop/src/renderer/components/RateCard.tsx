import { useState } from 'react'
import { Action } from '../actions/Action.js'
import { Icon } from '../shell/Icon.js'
import { isoToday } from '../format/dates.js'
import type { RateDto } from '../../shared/ipc.js'

/**
 * The gold rate card — the Dashboard's, and only the Dashboard's.
 *
 * It used to be mounted on every screen that prices metal, which put a 76px
 * strip of the same four figures on Purchase, Retail, Whole Sale and Stock.
 * The shop asked for it once, in one place; every entry screen still shows the
 * rate it is pricing WITH (the header rate box), it just no longer carries the
 * board.
 *
 * ── One typed figure, three calculated ─────────────────────────────────────
 * The shop quotes pure gold. 22K is 916 parts of a thousand, 21K is 875, 18K
 * is 750 — so only the 24K cell is editable, and saving it makes the service
 * write the other three as derived rows (916/999 and so on, integer
 * arithmetic, rounded once). The derived cells display what was written and
 * say "auto"; there is deliberately no way to type into them here, because a
 * second typed figure is a second place for the typo the ordering check
 * exists to catch. A correction, if ever needed, still exists on the Gold
 * Rate screen.
 *
 * There is still exactly one rate store: saving goes through the same
 * `setRate` IPC as the Gold Rate screen, effectiveFrom = today, a new row in
 * `gold_rates` — history and the effective-date model untouched.
 */
export function RateCard({
  rates,
  onSaved,
}: {
  rates: readonly RateDto[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // A refused rate used to vanish silently: the editor closed and showed the old
  // figure, so a typo looked like it had saved.
  const [error, setError] = useState<string | null>(null)

  const begin = (display: string): void => {
    setEditing(true)
    setError(null)
    // Digits only — somebody retyping "Rs. 358,000" wants to type the number,
    // not to delete the currency and the separators first.
    setDraft(display.replace(/[^\d.]/g, ''))
  }

  const commit = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.api.setRate({
        purity: 'K24',
        ratePerTolaRupees: draft,
        effectiveFrom: isoToday(),
        note: 'edited from the rate card',
      })
      if (result.ok) {
        setError(null)
        onSaved()
      } else {
        setError(result.message)
      }
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  return (
    <div className={`rate-card${error ? ' rate-card--bad' : ''}`}>
      <div className="rate-card__head">GOLD RATE</div>
      {rates.length === 0 ? (
        // Shown as missing, never as zero. Valuing gold at a made-up price is
        // invisible on an invoice and wrong in the ledger. See DECISIONS §7.
        <div className="rate-card__empty">No rate set</div>
      ) : (
        <div className="rate-card__row">
          {rates.map((rate) => {
            const isPure = rate.purity === '24K'
            return (
              <div className="rate-card__cell" key={rate.purity}>
                <span className="rate-card__purity">{rate.purity}</span>
                <span className="rate-card__figure">
                  {isPure && editing ? (
                    <input
                      className="rate-card__input"
                      value={draft}
                      autoFocus
                      inputMode="decimal"
                      aria-label="24K rate per tola"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => void commit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commit()
                        // Escape abandons the edit without writing a rate row.
                        if (e.key === 'Escape') setEditing(false)
                      }}
                    />
                  ) : isPure ? (
                    <Action
                      id="rate.edit"
                      variant="plain"
                      className={`rate-card__value${rate.display ? '' : ' is-unset'}`}
                      ariaLabel={
                        rate.display
                          ? 'Edit 24K rate'
                          : 'Set 24K rate — none recorded'
                      }
                      onActivate={() => begin(rate.display ?? '')}
                    >
                      {rate.display ? rate.display.replace(/^Rs\.?\s*/, '') : 'Not set'}
                    </Action>
                  ) : (
                    // Derived, not typed. Showing it as plain text rather than
                    // a disabled control is deliberate: this is a FIGURE, and
                    // nothing about it is waiting to be enabled.
                    <span
                      className={`rate-card__value rate-card__value--derived${
                        rate.display ? '' : ' is-unset'
                      }`}
                      title={`Calculated from the 24K rate (${rate.purity} fineness)`}
                    >
                      {rate.display ? rate.display.replace(/^Rs\.?\s*/, '') : '—'}
                      <span className="rate-card__auto"> auto</span>
                    </span>
                  )}
                  {isPure ? (
                    <Action
                      id="rate.refresh"
                      variant="icon"
                      className="rate-card__refresh"
                      ariaLabel="Refresh rates"
                      onActivate={onSaved}
                    >
                      <Icon name="refresh" size={13} />
                    </Action>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {error ? (
        <div className="rate-card__error" role="alert" title={error}>
          Rate refused
        </div>
      ) : null}
    </div>
  )
}
