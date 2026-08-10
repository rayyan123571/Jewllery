import { useRef, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { EmptyState } from '../../components/EmptyState.js'
import { Icon } from '../../shell/Icon.js'
import { toDisplayDate } from '../../format/dates.js'
import type { PartyBalanceDto, PartyDto } from '../../../shared/ipc.js'

/**
 * Settling a gold debt — in gold, in cash, or part and part.
 *
 * All three reduce the **gold** debt (docs/DECISIONS.md §10). Cash handed over
 * in place of gold is a gold-debt transaction, not a cash credit, so the cash
 * box here sits beside the gold box in one form and posts as one entry.
 *
 * The over-return case is a **Continue button on a sentence the operator can
 * act on**, never a dismiss box. The main process refuses the first attempt and
 * returns the consequence in plain words; this shows it with Continue and Go
 * back, and only Continue retries with confirmation. That is warn-and-allow
 * surviving all the way to the glass.
 */
export function SettlementPanel({
  party,
  balance,
  entryDate,
  onSettled,
}: {
  party: PartyDto | null
  balance: PartyBalanceDto | null
  entryDate: string
  onSettled: () => Promise<void> | void
}) {
  const [gold, setGold] = useState('')
  const [cash, setCash] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Double-post guard: a second click can land before the button re-renders.
  const posting = useRef(false)

  async function post(confirmed: boolean): Promise<void> {
    if (posting.current || !party) return
    posting.current = true
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.api.settle({
        partyId: party.id,
        entryDate,
        goldGrams: gold,
        cashRupees: cash,
        notes: null,
        ...(confirmed ? { confirmedOverReturn: true } : {}),
      })

      if (result.ok) {
        setConfirming(null)
        setMessage({
          kind: 'ok',
          text: `Settled as ${result.invoiceNo}. ${party.name} now ${result.balanceAfter.text}.`,
        })
        setGold('')
        setCash('')
        await onSettled()
        return
      }

      if ('needsConfirmation' in result) {
        // Not an error. A question with a Continue button.
        setConfirming(result.message)
        return
      }
      setMessage({ kind: 'bad', text: result.message })
    } finally {
      posting.current = false
      setBusy(false)
    }
  }

  const kind =
    gold.trim() && cash.trim()
      ? 'part gold and part cash'
      : cash.trim()
        ? 'cash'
        : gold.trim()
          ? 'khalis gold'
          : null

  return (
    <div className="panel">
      <div className="panel__title">RETURN / RECEIVE — SETTLE A GOLD DEBT</div>
      <div className="panel__body">
        {!party ? (
          <EmptyState
            title="No party chosen"
            line="Settling reduces a party's gold debt, so there has to be a party. Choose one on the New Whole Sale tab."
            actionId="wholesale.tab.new"
            actionLabel="Go to New Whole Sale"
          />
        ) : (
          <>
            <div className="stat-strip">
              <div className="stat-cell">
                <span className="stat-cell__label">Currently owed</span>
                <span
                  className={`stat-cell__value ${
                    balance?.gold.direction === 'shop-owes-party' ? 'negative' : 'positive'
                  }`}
                >
                  {balance?.gold.text ?? '—'}
                  {balance?.gold.drCr ? ` /${balance.gold.drCr}` : ''}
                </span>
              </div>
            </div>

            <div className="field-row field-row--flush field-row--pair">
              <label className="field">
                <span className="field__label">Khalis gold given (g)</span>
                <input
                  className="input input--numeric"
                  value={gold}
                  onChange={(e) => setGold(e.target.value)}
                  placeholder="0.000"
                  inputMode="decimal"
                  aria-label="Khalis gold given"
                />
              </label>
              <label className="field">
                <span className="field__label">Cash given (Rs)</span>
                <input
                  className="input input--numeric"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label="Cash given"
                />
              </label>
            </div>

            <p className="hint">
              {kind
                ? `Settling in ${kind}. Both portions reduce the gold debt — cash is converted at the rate for ${toDisplayDate(entryDate)}, which is stored on the entry so this settlement always means the same thing.`
                : 'Enter gold, cash, or both. Whichever you use, the gold debt is what reduces.'}
            </p>

            {confirming ? (
              <div className="confirm" role="alertdialog" aria-label="Confirm over-return">
                <div className="confirm__text">{confirming}</div>
                <div className="confirm__actions">
                  <Action
                    id="wholesale.settle.back"
                    variant="ghost"
                    onActivate={() => setConfirming(null)}
                  >
                    Go back
                  </Action>
                  <Action
                    id="wholesale.settle.confirm"
                    className="login__submit"
                    busy={busy}
                    onActivate={() => void post(true)}
                  >
                    Continue
                  </Action>
                </div>
              </div>
            ) : (
              <div className="panel__foot panel__foot--flush">
                <Action
                  id="wholesale.settle"
                  className="login__submit"
                  busy={busy || (!gold.trim() && !cash.trim())}
                  onActivate={() => void post(false)}
                >
                  <Icon name="save" size={16} />
                  {busy ? 'Posting…' : 'Post settlement'}
                </Action>
              </div>
            )}

            {message ? (
              <div
                className={message.kind === 'ok' ? 'banner banner--good' : 'banner banner--bad'}
              >
                {message.text}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
