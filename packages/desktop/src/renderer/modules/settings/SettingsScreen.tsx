import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Action } from '../../actions/Action.js'
import { useMessages } from '../../components/Messages.js'
import { Icon } from '../../shell/Icon.js'
import type {
  PrintSettingsDto,
  RetailRoundingDto,
  ShopProfileDto,
  WastageRuleDto,
} from '../../../shared/ipc.js'

/**
 * Settings, as four questions rather than one long page.
 *
 * ── Why it is sectioned ────────────────────────────────────────────────────
 * Everything here used to be stacked in one column, so the shopkeeper looking
 * for "change my shop's name" scrolled past two tables of worked arithmetic to
 * find it. The four groups below are the four reasons anybody opens this
 * screen, and only one is on screen at a time.
 *
 * ── Why the words are short ────────────────────────────────────────────────
 * This screen is read by the person who owns the shop, not by whoever wrote it.
 * Every explanation is one line, in the words a counter uses — no rule names,
 * no references to how it is stored, and nothing that only makes sense if you
 * already know the answer.
 *
 * ── What is still computed rather than written down ────────────────────────
 * The two tables under PRICING. Every figure in them comes from the main
 * process, from the same functions that price a real sale — so the example
 * cannot claim one thing while the till charges another. That is why they stay,
 * even on a screen this one is trying to keep short.
 */

type SectionId = 'shop' | 'printing' | 'pricing' | 'system'

interface Section {
  readonly id: SectionId
  readonly label: string
  /** One line, on the button, saying what is inside. */
  readonly hint: string
  readonly icon: string
}

const SECTIONS: readonly Section[] = [
  { id: 'shop', label: 'Shop Details', hint: 'Name, phone, address', icon: 'home' },
  { id: 'printing', label: 'Printing', hint: 'Receipt and numbers', icon: 'print' },
  { id: 'pricing', label: 'Pricing', hint: 'Polish and rounding', icon: 'scale' },
  { id: 'system', label: 'System', hint: 'Data and backup', icon: 'shield' },
]

export function SettingsScreen() {
  const [section, setSection] = useState<SectionId>('shop')

  return (
    <div className="screen settings">
      <div className="settings__split screen__body">
        {/* The four reasons somebody opens this screen, as a list they can read
            at a glance rather than a row of one-word tabs. */}
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((entry) => (
            <Action
              key={entry.id}
              id="settings.section"
              variant="plain"
              className="settings-nav__item"
              active={section === entry.id}
              onActivate={() => setSection(entry.id)}
            >
              <Icon name={entry.icon} size={20} />
              <span className="settings-nav__text">
                <span className="settings-nav__label">{entry.label}</span>
                <span className="settings-nav__hint">{entry.hint}</span>
              </span>
            </Action>
          ))}
        </nav>

        <div className="settings-body">
          {section === 'shop' ? <ShopSection /> : null}
          {section === 'printing' ? <PrintingSection /> : null}
          {section === 'pricing' ? <PricingSection /> : null}
          {section === 'system' ? <SystemSection /> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The shop's own details — what prints at the top of every receipt.
 *
 * Anything left blank is left off the paper, so a shop with one owner and one
 * phone number gets a clean receipt rather than two empty lines. The name is the
 * one field that cannot be blank: without it the customer cannot tell whose
 * receipt they are holding.
 *
 * It saves on a button rather than as you type, because this is eight boxes
 * edited together — saving each keystroke would spend the time in between
 * describing a shop that does not exist.
 */
function ShopSection() {
  const [form, setForm] = useState<ShopProfileDto | null>(null)
  const [saving, setSaving] = useState(false)
  const { push } = useMessages()

  useEffect(() => {
    void window.api.shopProfile().then(setForm)
  }, [])

  const set = (key: keyof ShopProfileDto) => (value: string) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const save = async (): Promise<void> => {
    if (!form || saving) return
    setSaving(true)
    try {
      const result = await window.api.setShopProfile(form)
      if (!result.ok) {
        push('bad', result.message)
        return
      }
      // The menu's wordmark and the slip preview read these too, so they are
      // told rather than left showing the old name until the next restart.
      window.dispatchEvent(new CustomEvent('jewellery:shop-updated'))
      push('ok', 'Saved. Your receipts and the menu now show these details.')
    } finally {
      setSaving(false)
    }
  }

  const field = (
    key: keyof ShopProfileDto,
    label: string,
    placeholder: string,
  ): ReactNode => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="input"
        value={form?.[key] ?? ''}
        onChange={(e) => set(key)(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  )

  return (
    <>
      <SectionHead
        title="Shop Details"
        line="This is what prints at the top of every receipt. Leave anything blank and it simply will not be printed."
      />

      <div className="settings-grid">
        <div className="panel">
          <div className="panel__title">YOUR SHOP</div>
          <div className="panel__body">
            <div className="field-row field-row--flush field-row--pair">
              {field('name', 'Shop name', 'AL-HARAM GOLD JEWELLERS')}
              {field('tagline', 'Tagline (optional)', 'Trust in Purity')}
            </div>
            <div className="field-row field-row--flush field-row--pair">
              {field('ownerName', 'Owner', 'Haji Abdul Rehman')}
              {field('secondOwnerName', 'Second owner (optional)', '—')}
            </div>
            <div className="field-row field-row--flush field-row--pair">
              {field('phone1', 'Phone', '0300-0000000')}
              {field('phone2', 'Phone 2 (optional)', '—')}
            </div>
            <div className="field-row field-row--flush field-row--pair">
              {field('phone3', 'Phone 3 (optional)', '—')}
              {field('address', 'Address', 'Sona Bazaar, Lahore')}
            </div>

            <div className="panel__foot panel__foot--flush">
              <Action
                id="settings.shop-profile.save"
                variant="primary"
                busy={saving}
                onActivate={() => void save()}
              >
                Save
              </Action>
            </div>
          </div>
        </div>

        {/* The paper, as it will print. Built from the same fields the receipt
            reads, so what is shown here and what comes out of the printer
            cannot drift apart. */}
        <div className="panel">
          <div className="panel__title">HOW YOUR RECEIPT WILL LOOK</div>
          <div className="panel__body">
            <div className="shop-preview" aria-label="Receipt header preview">
              <div className="shop-preview__name">{form?.name.trim() || 'Your shop name'}</div>
              {form?.tagline.trim() ? (
                <div className="shop-preview__line">{form.tagline}</div>
              ) : null}
              {form?.ownerName.trim() || form?.phone1.trim() ? (
                <div className="shop-preview__line">
                  {[form?.ownerName.trim(), form?.phone1.trim()].filter(Boolean).join('  ☎ ')}
                </div>
              ) : null}
              {form?.secondOwnerName.trim() || form?.phone2.trim() ? (
                <div className="shop-preview__line">
                  {[form?.secondOwnerName.trim(), form?.phone2.trim()]
                    .filter(Boolean)
                    .join('  ☎ ')}
                </div>
              ) : null}
              {form?.phone3.trim() ? (
                <div className="shop-preview__line">☎ {form.phone3}</div>
              ) : null}
              {form?.address.trim() ? (
                <div className="shop-preview__line">{form.address}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * The printer, and what a receipt number looks like.
 *
 * The prefix boxes are the only part that needs a word of explanation, and it
 * is one word: a number is stored as 1, 2, 3 and the prefix is only printed in
 * front of it. Changing it renames nothing that has already been sold.
 */
function PrintingSection() {
  const [form, setForm] = useState<PrintSettingsDto | null>(null)
  const [saving, setSaving] = useState(false)
  const { push } = useMessages()

  useEffect(() => {
    void window.api.printSettings().then(setForm)
  }, [])

  const set = <K extends keyof PrintSettingsDto>(
    key: K,
    value: PrintSettingsDto[K],
  ): void => setForm((current) => (current ? { ...current, [key]: value } : current))

  const save = async (): Promise<void> => {
    if (!form || saving) return
    setSaving(true)
    try {
      const result = await window.api.setPrintSettings(form)
      if (!result.ok) {
        push('bad', result.message)
        return
      }
      window.dispatchEvent(new CustomEvent('jewellery:shop-updated'))
      push('ok', 'Saved.')
    } finally {
      setSaving(false)
    }
  }

  const example = (prefix: string): string => `${prefix.trim()}7`

  return (
    <>
      <SectionHead
        title="Printing"
        line="How receipts come out of the printer, and what is printed in front of a receipt number."
      />

      <div className="settings-grid">
        <div className="panel">
          <div className="panel__title">PRINTER</div>
          <div className="panel__body">
            <div className="field-row field-row--flush field-row--pair">
              <label className="field">
                <span className="field__label">Paper size</span>
                <select
                  className="select"
                  value={String(form?.paperWidthMm ?? 80)}
                  onChange={(e) => set('paperWidthMm', Number(e.target.value))}
                  aria-label="Paper size"
                >
                  <option value="80">80 mm (normal roll)</option>
                  <option value="58">58 mm (small roll)</option>
                </select>
              </label>

              <label className="field">
                <span className="field__label">Copies</span>
                <select
                  className="select"
                  value={String(form?.copies ?? 1)}
                  onChange={(e) => set('copies', Number(e.target.value))}
                  aria-label="Copies"
                >
                  <option value="1">1 — customer</option>
                  <option value="2">2 — customer and shop</option>
                  <option value="3">3</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span className="field__label">Print automatically after saving a sale</span>
              <select
                className="select"
                value={form?.printAfterSave ? 'yes' : 'no'}
                onChange={(e) => set('printAfterSave', e.target.value === 'yes')}
                aria-label="Print after save"
              >
                <option value="no">No — I will press PRINT</option>
                <option value="yes">Yes — print every sale</option>
              </select>
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="panel__title">WORDS ON THE RECEIPT</div>
          <div className="panel__body">
            <label className="field">
              <span className="field__label">Conditions (printed under the items)</span>
              <input
                className="input"
                value={form?.terms ?? ''}
                onChange={(e) => set('terms', e.target.value)}
                placeholder="Leave empty to print nothing"
                aria-label="Receipt conditions"
              />
            </label>

            <label className="field">
              <span className="field__label">Last line</span>
              <input
                className="input"
                value={form?.footer ?? ''}
                onChange={(e) => set('footer', e.target.value)}
                placeholder="Thank you — please visit again"
                aria-label="Receipt last line"
              />
            </label>
          </div>
        </div>

        <div className="panel settings-grid__wide">
          <div className="panel__title">RECEIPT NUMBERS</div>
          <div className="panel__body">
            <p className="callout">
              Numbers count 1, 2, 3. Anything you type below is only printed in front of
              the number — leave the boxes empty for plain numbers.
            </p>

            <div className="field-row field-row--flush">
              <label className="field">
                <span className="field__label">Retail sale</span>
                <input
                  className="input"
                  value={form?.retailPrefix ?? ''}
                  onChange={(e) => set('retailPrefix', e.target.value)}
                  placeholder="empty"
                  aria-label="Retail invoice prefix"
                />
                <span className="field__hint">Shows as {example(form?.retailPrefix ?? '')}</span>
              </label>
              <label className="field">
                <span className="field__label">Whole sale slip</span>
                <input
                  className="input"
                  value={form?.wholesalePrefix ?? ''}
                  onChange={(e) => set('wholesalePrefix', e.target.value)}
                  placeholder="empty"
                  aria-label="Wholesale slip prefix"
                />
                <span className="field__hint">
                  Shows as {example(form?.wholesalePrefix ?? '')}
                </span>
              </label>
              <label className="field">
                <span className="field__label">Return / receive</span>
                <input
                  className="input"
                  value={form?.settlementPrefix ?? ''}
                  onChange={(e) => set('settlementPrefix', e.target.value)}
                  placeholder="empty"
                  aria-label="Settlement prefix"
                />
                <span className="field__hint">
                  Shows as {example(form?.settlementPrefix ?? '')}
                </span>
              </label>
              <label className="field">
                <span className="field__label">Purchase</span>
                <input
                  className="input"
                  value={form?.purchasePrefix ?? ''}
                  onChange={(e) => set('purchasePrefix', e.target.value)}
                  placeholder="empty"
                  aria-label="Purchase prefix"
                />
                <span className="field__hint">
                  Shows as {example(form?.purchasePrefix ?? '')}
                </span>
              </label>
            </div>

            <div className="panel__foot panel__foot--flush">
              <Action
                id="settings.print.save"
                variant="primary"
                busy={saving}
                onActivate={() => void save()}
              >
                Save
              </Action>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * The two pricing habits a shop has to state.
 *
 * Both change what a sale comes to, so both are shown against a worked example
 * priced by the main process — the same code that prices a real sale. Ask the
 * shop to compare the table with an old receipt and pick the row that matches.
 */
function PricingSection() {
  const [rule, setRule] = useState<WastageRuleDto | null>(null)
  const [rounding, setRounding] = useState<RetailRoundingDto | null>(null)
  const { push } = useMessages()

  const load = useCallback(async (selection: { direction: string; basis: string } | null) => {
    setRule(await window.api.retailWastageRule(selection))
    // Reloaded alongside the rule: the rounding example is priced BY the saved
    // rule, so changing one changes the figure the other is demonstrating on.
    setRounding(await window.api.retailRounding())
  }, [])

  useEffect(() => {
    void load(null)
  }, [load])

  const choose = useCallback(
    async (direction: string, basis: string) => {
      const result = await window.api.setRetailWastageRule({ direction, basis })
      if (!result.ok) {
        push('bad', result.message)
        await load(null)
        return
      }
      await load({ direction, basis })
      push('ok', 'Saved. It applies to new sales.')
    },
    [load, push],
  )

  const chooseRounding = useCallback(
    async (step: number) => {
      const result = await window.api.setRetailRounding(step)
      if (!result.ok) {
        push('bad', result.message)
        await load(null)
        return
      }
      await load(null)
      push('ok', 'Saved. It applies to new sales.')
    },
    [load, push],
  )

  const first = rule?.examples[0]

  return (
    <>
      <SectionHead
        title="Pricing"
        line="Two habits that change what a sale comes to. Sales already made never change."
      />

      <div className="settings-grid">
        <div className="panel settings-grid__wide">
          <div className="panel__title">POLISH (WASTAGE)</div>
          <div className="panel__body">
            <p className="callout">
              Compare the table with an old receipt of yours and choose the row that
              matches it.
            </p>

            <div className="field-row field-row--flush field-row--pair">
              <label className="field">
                <span className="field__label">Polish is…</span>
                <select
                  className="select"
                  value={rule?.savedDirection ?? 'add'}
                  onChange={(e) => void choose(e.target.value, rule?.savedBasis ?? 'net')}
                  aria-label="Wastage direction"
                >
                  <option value="add">Added to the weight</option>
                  <option value="subtract">Taken off the weight</option>
                </select>
              </label>

              <label className="field">
                <span className="field__label">…counted on</span>
                <select
                  className="select"
                  value={rule?.savedBasis ?? 'net'}
                  onChange={(e) => void choose(rule?.savedDirection ?? 'add', e.target.value)}
                  aria-label="Wastage basis"
                >
                  <option value="net">Weight after stone and cut</option>
                  <option value="gross">Full weight</option>
                </select>
              </label>
            </div>

            {first ? (
              <>
                <p className="hint">
                  On one piece of {first.sample.grossTola} tola with{' '}
                  {first.sample.wastagePercent}% polish, at {first.sample.rateDisplay}:
                </p>

                <table className="rule-table">
                  <thead>
                    <tr>
                      <th>Choice</th>
                      <th className="numeric">Polish</th>
                      <th className="numeric">Weight charged</th>
                      <th className="numeric">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {first.options.map((option) => (
                      <tr
                        key={`${option.direction}/${option.basis}`}
                        className={option.isSaved ? 'is-current' : undefined}
                      >
                        <td>
                          {option.label}
                          {option.isSaved ? <span className="row-badge">chosen</span> : null}
                        </td>
                        <td className="numeric">{option.wastageDisplay}</td>
                        <td className="numeric">{option.fineDisplay}</td>
                        <td className="numeric">{option.amountDisplay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        </div>

        <div className="panel settings-grid__wide">
          <div className="panel__title">ROUNDING</div>
          <div className="panel__body">
            <p className="callout">
              Only the final total is rounded. Weights and item amounts stay exact.
            </p>

            <label className="field">
              <span className="field__label">Round the total to</span>
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
                  The same piece as above comes to <strong>{rounding.exactDisplay}</strong>{' '}
                  exactly. With rounding it prints as:
                </p>

                <table className="rule-table">
                  <thead>
                    <tr>
                      <th>Choice</th>
                      <th className="numeric">Total on the receipt</th>
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
                          {option.isSaved ? <span className="row-badge">chosen</span> : null}
                        </td>
                        <td className="numeric">{option.totalDisplay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}

function SystemSection() {
  return (
    <>
      <SectionHead
        title="System"
        line="Where your data is, and when it was last copied somewhere safe."
      />
      <div className="settings-grid">
        <div className="panel">
          <div className="panel__title">STATUS</div>
          <div className="panel__body">
            <SystemStatus />
          </div>
        </div>
      </div>
    </>
  )
}

/** A section's title and its one line of explanation. */
function SectionHead({ title, line }: { title: string; line: string }) {
  return (
    <header className="settings-head">
      <h2 className="settings-head__title">{title}</h2>
      <p className="settings-head__line">{line}</p>
    </header>
  )
}

/**
 * Whether the database is open, and when the last backup ran.
 *
 * It reads bootstrap directly rather than being handed it, so Settings does not
 * need a prop threaded down from the shell for two lines.
 */
function SystemStatus() {
  const [status, setStatus] = useState<{ connected: boolean; backup: string } | null>(null)

  useEffect(() => {
    void window.api.bootstrap().then((boot) =>
      setStatus({
        connected: boot.databaseConnected,
        backup: boot.backup.lastBackupDisplay,
      }),
    )
  }, [])

  return (
    <>
      <div className="summary-line">
        <span>Data file</span>
        <span className="summary-line__value">
          {status?.connected ? 'Open and working' : 'Not open'}
        </span>
      </div>
      <div className="summary-line">
        <span>Last backup</span>
        <span className="summary-line__value">{status?.backup ?? '—'}</span>
      </div>
      <p className="hint">
        Take a backup from Backup / Restore in the menu. It copies everything to a file
        you can keep somewhere else.
      </p>
    </>
  )
}
