import { useState } from 'react'
import { Action } from '../actions/Action.js'
import { Icon } from '../shell/Icon.js'
import { isoToday } from '../format/dates.js'
import type { RateDto } from '../../shared/ipc.js'

/**
 * The gold rate, as a card inside a module screen.
 *
 * ── Why this is a component and not a bar ──────────────────────────────────
 * It used to live in the top bar, which cost every screen 76px of height to
 * carry a figure only two screens actually need. The bar is gone; the rate moved
 * INTO the screens that price things by it, where it sits beside the numbers it
 * governs instead of above every screen in the application.
 *
 * ── There is still exactly one rate store ──────────────────────────────────
 * Saving here goes through the SAME `setRate` IPC the Gold Rate screen uses,
 * with effectiveFrom = today. A rate typed into this card is a new row in
 * `gold_rates` exactly as if it had been typed on the full screen — history and
 * the effective-date model are untouched, and there is no second place a rate
 * can live and drift.
 *
 * Every module that prices metal gets this same component. Wholesale keeps its
 * rate control by mounting this, not by growing a private copy.
 */
export function RateCard({
  rates,
  onSaved,
}: {
  rates: readonly RateDto[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // A refused rate used to vanish silently: the editor closed and showed the old
  // figure, so a typo that broke the purity ordering looked like it had saved.
  const [error, setError] = useState<string | null>(null)

  const begin = (purity: string, display: string): void => {
    setEditing(purity)
    setError(null)
    // Digits only — somebody retyping "Rs. 358,000" wants to type the number,
    // not to delete the currency and the separators first.
    setDraft(display.replace(/[^\d.]/g, ''))
  }

  const commit = async (purityLabel: string): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      // "22K" is the display form; the service wants the stored form, "K22".
      const purity = `K${purityLabel.replace(/K$/i, '')}`
      const result = await window.api.setRate({
        purity,
        ratePerTolaRupees: draft,
        effectiveFrom: isoToday(),
        note: 'edited from the rate card',
      })
      if (result.ok) {
        setError(null)
        onSaved()
      } else {
        // Most often a purity-ordering conflict — RateService refuses a lower
        // purity priced above a higher one. Say so, rather than closing the
        // editor as though the figure had been accepted.
        setError(result.message)
      }
    } finally {
      setSaving(false)
      setEditing(null)
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
          {rates.map((rate) => (
            <div className="rate-card__cell" key={rate.purity}>
              <span className="rate-card__purity">{rate.purity}</span>
              <span className="rate-card__figure">
                {editing === rate.purity ? (
                  <input
                    className="rate-card__input"
                    value={draft}
                    autoFocus
                    inputMode="decimal"
                    aria-label={`${rate.purity} rate per tola`}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commit(rate.purity)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commit(rate.purity)
                      // Escape abandons the edit without writing a rate row.
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <Action
                    id="rate.edit"
                    variant="plain"
                    className={`rate-card__value${rate.display ? '' : ' is-unset'}`}
                    ariaLabel={
                      rate.display
                        ? `Edit ${rate.purity} rate`
                        : `Set ${rate.purity} rate — none recorded`
                    }
                    onActivate={() => begin(rate.purity, rate.display ?? '')}
                  >
                    {/* Every purity the shop deals in is listed, whether or not
                        it has a rate. An unset one shows as unset and invites
                        the rate — never as a zero, which is a price. */}
                    {rate.display ? rate.display.replace(/^Rs\.?\s*/, '') : 'Not set'}
                  </Action>
                )}
                {/* Its own refresh, per purity — the mockup shows four, and one
                    shared control could not say which figure it had re-read. */}
                <Action
                  id="rate.refresh"
                  variant="icon"
                  className="rate-card__refresh"
                  ariaLabel={`Refresh ${rate.purity} rate`}
                  onActivate={onSaved}
                >
                  <Icon name="refresh" size={13} />
                </Action>
              </span>
            </div>
          ))}
        </div>
      )}
      {error ? (
        // The card has no room for a sentence, so it carries the short form and
        // the full message is one hover away. Gold Rate shows it in full.
        <div className="rate-card__error" role="alert" title={error}>
          Rate refused
        </div>
      ) : null}
    </div>
  )
}
