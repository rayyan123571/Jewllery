import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '../../components/Messages.js'
import type { RetailRoundingDto, WastageRuleDto } from '../../../shared/ipc.js'

/**
 * Settings, and the one card the retail module cannot ship without.
 *
 * ── Why the wastage rule is a setting at all ───────────────────────────────
 * Wastage can be ADDED to the metal the customer receives or TAKEN OUT of it,
 * and the percentage can be taken on the GROSS weight or on the NET. Those two
 * choices multiply out to four different invoices from identical inputs, and on
 * the worked example below the spread between them is tens of thousands of
 * rupees. Picking one silently would mean every invoice this shop issues is
 * wrong in a way nobody notices until a customer disputes one.
 *
 * So the shop states it, and until they do, the software is explicit about
 * which rule it is applying rather than quietly assuming.
 *
 * ── Why the example is computed in the main process ────────────────────────
 * Every figure in the table comes from `computeRetailLine` — the same function
 * that prices a real line — over IPC. A settings card that demonstrated the
 * rule with its own arithmetic could show one answer while the till charged
 * another, which is precisely the failure this card exists to prevent.
 */
export function SettingsScreen() {
  const [rule, setRule] = useState<WastageRuleDto | null>(null)
  const [rounding, setRounding] = useState<RetailRoundingDto | null>(null)
  const { push } = useMessages()

  const load = useCallback(async (selection: { direction: string; basis: string } | null) => {
    setRule(await window.api.retailWastageRule(selection))
    // Reloaded alongside the rule because the rounding card's worked total is
    // priced BY the saved rule — changing the rule changes the figure the
    // rounding card is demonstrating on.
    setRounding(await window.api.retailRounding())
  }, [])

  useEffect(() => {
    void load(null)
  }, [load])

  const chooseRounding = useCallback(
    async (step: number) => {
      const result = await window.api.setRetailRounding(step)
      if (!result.ok) {
        push('bad', result.message)
        await load(null)
        return
      }
      await load(null)
      push(
        'ok',
        step === 1
          ? 'Invoice totals will be exact, to the paisa.'
          : `Invoice totals will be rounded to the nearest Rs ${step}. Lines are unchanged.`,
      )
    },
    [load, push],
  )

  const choose = useCallback(
    async (direction: string, basis: string) => {
      // Written straight through. The rule is two words and changing it back is
      // one click, so a Save button between the choice and the effect would be
      // a step that only ever gets in the way — and the whole table below stays
      // on screen showing exactly what the choice did.
      const result = await window.api.setRetailWastageRule({ direction, basis })
      if (!result.ok) {
        push('bad', result.message)
        await load(null)
        return
      }
      await load({ direction, basis })
      push('ok', 'Retail wastage rule saved. It applies to sales made from now on.')
    },
    [load, push],
  )

  return (
    <div className="screen">
      <div className="workspace__split screen__body">
        <div className="entry-column">
          <div className="panel">
            <div className="panel__title">RETAIL WASTAGE RULE</div>
            <div className="panel__body">
              <p className="callout">
                Ask the shop which of these matches a past invoice. This affects every
                retail sale.
              </p>

              <div className="field-row field-row--flush field-row--pair">
                <label className="field">
                  <span className="field__label">Wastage is…</span>
                  <select
                    className="select"
                    value={rule?.savedDirection ?? 'add'}
                    onChange={(e) => void choose(e.target.value, rule?.savedBasis ?? 'net')}
                    aria-label="Wastage direction"
                  >
                    <option value="add">Added to the net weight</option>
                    <option value="subtract">Taken out of the net weight</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">…calculated on</span>
                  <select
                    className="select"
                    value={rule?.savedBasis ?? 'net'}
                    onChange={(e) => void choose(rule?.savedDirection ?? 'add', e.target.value)}
                    aria-label="Wastage basis"
                  >
                    <option value="net">Net weight (after stone and cut)</option>
                    <option value="gross">Gross weight</option>
                  </select>
                </label>
              </div>

              {rule ? (
                <>
                  {rule.examples.map((example) => (
                    <div key={example.title}>
                      <p className="hint">
                        <strong>{example.title}</strong> — gross {example.sample.grossTola} tola
                        · stone {example.sample.stoneTola} · cut {example.sample.cutTola} ·
                        wastage {example.sample.wastagePercent}% · rate{' '}
                        {example.sample.rateDisplay}
                      </p>

                      <table className="rule-table">
                        <thead>
                          <tr>
                            <th>Rule</th>
                            <th className="numeric">Wastage</th>
                            <th className="numeric">Fine weight</th>
                            <th className="numeric">Line amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {example.options.map((option) => (
                            <tr
                              key={`${option.direction}/${option.basis}`}
                              className={option.isSaved ? 'is-current' : undefined}
                            >
                              <td>
                                {option.label}
                                {option.isSaved ? (
                                  <span className="row-badge">in use</span>
                                ) : null}
                              </td>
                              <td className="numeric">{option.wastageDisplay}</td>
                              <td className="numeric">{option.fineDisplay}</td>
                              <td className="numeric">{option.amountDisplay}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {example.note ? <p className="hint">{example.note}</p> : null}
                    </div>
                  ))}

                  <p className="hint">
                    Changing this affects future sales only. Every sale that has already
                    been posted carries the rule it was priced with on its own row, so a
                    reprint reproduces the invoice the customer is holding, whatever this
                    setting says later. That guarantee is covered by the test
                    <em> “a posted sale reprints identically after the wastage rule
                    changes”</em>.
                  </p>
                </>
              ) : null}
            </div>
          </div>

          {/* ── Rounding ────────────────────────────────────────────────────
              A reference mockup priced every amount on a round hundred. Round
              hundreds are a shop's habit, not arithmetic, so the habit is
              stated here rather than inferred — and the default states nothing:
              the total stands exactly as computed. */}
          <div className="panel">
            <div className="panel__title">INVOICE ROUNDING</div>
            <div className="panel__body">
              <p className="callout">
                Applies to the invoice total only, as the very last step. Item lines,
                weights and every subtotal stay exact, so the column on the slip always
                adds up to the figure printed under it.
              </p>

              <label className="field">
                <span className="field__label">Round the invoice total to…</span>
                <select
                  className="select"
                  value={String(rounding?.savedStep ?? 1)}
                  onChange={(e) => void chooseRounding(Number(e.target.value))}
                  aria-label="Invoice rounding"
                >
                  {(rounding?.options ?? []).map((option) => (
                    <option key={option.step} value={String(option.step)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {rounding ? (
                <>
                  <p className="hint">
                    The same piece as above, priced by the wastage rule this shop has
                    chosen. Exact total <strong>{rounding.exactDisplay}</strong>.
                  </p>

                  <table className="rule-table">
                    <thead>
                      <tr>
                        <th>Rounding</th>
                        <th>What it does</th>
                        <th className="numeric">Invoice total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rounding.options.map((option) => (
                        <tr
                          key={option.step}
                          className={option.isSaved ? 'is-current' : undefined}
                        >
                          <td>
                            {option.label}
                            {option.isSaved ? (
                              <span className="row-badge">in use</span>
                            ) : null}
                          </td>
                          <td>{option.note}</td>
                          <td className="numeric">{option.totalDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="hint">
                    Rounding is applied once, to the total, and the balance is worked out
                    from the rounded figure — so the total, the payment and the remaining
                    balance on a slip always agree with each other.
                  </p>
                </>
              ) : null}
            </div>
          </div>

          {/* ── The two facts the deleted status bar used to carry ───────── */}
          <div className="panel">
            <div className="panel__title">SYSTEM</div>
            <div className="panel__body">
              <SystemStatus />
            </div>
          </div>
        </div>

        <aside className="rail">
          <div className="panel">
            <div className="panel__title">WHAT THIS CHANGES</div>
            <div className="panel__body">
              <div className="summary-line">
                <span>Sales already posted</span>
                <span className="summary-line__value">Unchanged</span>
              </div>
              <div className="summary-line">
                <span>Reprints of those sales</span>
                <span className="summary-line__value">Unchanged</span>
              </div>
              <div className="summary-line">
                <span>The next retail sale</span>
                <span className="summary-line__value">Priced by this rule</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

/**
 * Database connected, and when the last backup ran.
 *
 * These two lines are what survived the status bar. That strip cost 32px across
 * the whole application to carry four facts, two of which nobody needed — the
 * company name is on every printed slip and the version belongs in an About
 * box. These two do matter, so they moved somewhere a person goes to LOOK for
 * them rather than sitting permanently in the corner of every screen. They also
 * appear in the account popover, which is the one place reachable without
 * leaving whatever screen you are on.
 *
 * It reads bootstrap directly rather than being handed it, so that Settings does
 * not need a prop threaded down from the shell for two strings.
 */
function SystemStatus() {
  const [status, setStatus] = useState<{
    connected: boolean
    backup: string
    version: string
  } | null>(null)

  useEffect(() => {
    void window.api
      ?.bootstrap()
      .then((boot) =>
        setStatus({
          connected: boot.databaseConnected,
          backup: boot.backup.lastBackupDisplay,
          version: boot.appVersion,
        }),
      )
      .catch(() => setStatus(null))
  }, [])

  return (
    <>
      <div className="summary-line">
        <span>Database</span>
        <span className="summary-line__value">
          {status ? (status.connected ? 'Connected' : 'Not connected') : '—'}
          <span
            className={`status-dot${status?.connected ? '' : ' status-dot--off'}`}
            aria-hidden="true"
          />
        </span>
      </div>
      <div className="summary-line">
        <span>Last backup</span>
        <span className="summary-line__value">{status?.backup ?? '—'}</span>
      </div>
      <div className="summary-line">
        <span>Version</span>
        <span className="summary-line__value">{status?.version ?? '—'}</span>
      </div>
    </>
  )
}
