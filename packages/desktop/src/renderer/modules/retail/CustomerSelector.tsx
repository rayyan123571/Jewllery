import { useCallback, useEffect, useRef, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { EmptyState } from '../../components/EmptyState.js'
import { GhostInput } from '../../components/GhostInput.js'
import { Modal } from '../../components/Modal.js'
import { useDebouncedSearch } from '../../components/useDebouncedSearch.js'
import { Icon } from '../../shell/Icon.js'
import type { CustomerDto } from '../../../shared/ipc.js'

/**
 * The retail customer field.
 *
 * The same three behaviours the party selector earned, from the same two
 * components rather than a second copy of either: strict prefix autocomplete
 * (GhostInput), a 150 ms debounced lookup (useDebouncedSearch), and a
 * double-save guard on the add form.
 *
 * What differs is the walk-in. A retail sale can be made to somebody who has no
 * account at all, and that changes what the sale is allowed to do — there is no
 * ledger for a balance to live on, so a walk-in sale has to be paid in full.
 * The list therefore marks a walk-in, and the add dialog offers it as a choice
 * rather than hiding it: typing a name into a box and getting an account the
 * shop then has to maintain is not what a counter wants at eleven at night.
 *
 * The field is free text as well as a lookup. A walk-in who is never added at
 * all still needs a name on the invoice, so what is typed here is carried onto
 * the sale as the name snapshot whether or not a customer row is chosen.
 */
export function CustomerSelector({
  selected,
  typedName,
  onTypedName,
  onSelect,
  /**
   * `baseline` draws it as a label and a rule with no box, which is how the
   * retail header strip shows the visit's facts. It is a skin: the prefix
   * autocomplete, the debounce, the walk-in fallback and the Add Customer
   * dialog are all unchanged, because a second implementation of a type-ahead
   * is a second one to keep correct.
   */
  variant = 'field',
}: {
  selected: CustomerDto | null
  typedName: string
  onTypedName: (name: string) => void
  onSelect: (customer: CustomerDto | null) => void
  variant?: 'field' | 'baseline'
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const matches = useDebouncedSearch(typedName, (term) => window.api.searchCustomers(term))

  const pick = useCallback(
    (customer: CustomerDto) => {
      onSelect(customer)
      onTypedName(customer.name)
      setOpen(false)
    },
    [onSelect, onTypedName],
  )

  const baseline = variant === 'baseline'
  return (
    <div className={`customer ${baseline ? 'baseline-field' : 'field'}`}>
      <span className={baseline ? 'baseline-field__label' : 'field__label'}>
        {baseline ? 'Customer :' : 'Customer'}
      </span>
      <span className="input-group">
        <GhostInput
          value={typedName}
          onChange={(next) => {
            onTypedName(next)
            setOpen(true)
            // Typing past a chosen customer clears the selection, so a sale can
            // never be posted against an account the box no longer shows.
            if (selected && next !== selected.name) onSelect(null)
          }}
          onAccept={(accepted) => {
            const found = matches.find((m) => m.name === accepted)
            if (found) pick(found)
          }}
          suggestions={matches.map((m) => m.name)}
          className={baseline ? 'baseline-field__input' : 'input'}
          placeholder={baseline ? 'Walk In Customer' : 'Name, code or mobile — or type a walk-in name'}
          inputRef={nameRef}
          ariaLabel="Customer"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault()
              pick(matches[0])
            }
            if (event.key === 'Escape') setOpen(false)
          }}
        />
        <Action id="retail.customer.add" variant="segment" ariaLabel="Add a new customer">
          <Icon name="plus" size={16} />
        </Action>
      </span>

      {/* A search that finds nothing says so and offers the way out, rather
          than leaving the operator typing into a box that stopped answering. */}
      {open && matches.length === 0 && typedName.trim().length > 0 ? (
        <div className="customer__list customer__list--empty">
          <EmptyState
            title="No customer matches"
            line={`Nothing found for "${typedName.trim()}". Leave it as typed for a walk-in, or add an account.`}
            actionId="retail.customer.add"
            actionLabel="Add New Customer"
          />
        </div>
      ) : null}

      {open && matches.length > 0 ? (
        <ul className="customer__list">
          {matches.map((match) => (
            <li key={match.id}>
              {/* mousedown, not click: blur would close the list first. */}
              <Action
                id="retail.customer.pick"
                variant="plain"
                className="party__option"
                ariaLabel={`Select ${match.name}`}
                activateOnMouseDown
                onActivate={() => pick(match)}
              >
                <span className="party__code">{match.code}</span>
                <span>{match.name}</span>
                {match.isWalkIn ? (
                  <span className="customer__walkin">walk-in</span>
                ) : match.city ? (
                  <span className="party__city">{match.city}</span>
                ) : null}
              </Action>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <AddCustomerDialog
          initialName={typedName}
          onClose={() => setAdding(false)}
          onCreated={pick}
        />
      ) : null}
      <CustomerAddBridge onOpen={() => setAdding(true)} />
    </div>
  )
}

/**
 * Lets the registry's `retail.customer.add` action open the dialog.
 *
 * The Action component owns the button so the no-dead-buttons test can see it;
 * this listens for the event that action raises. Same shape as the wholesale
 * one, and for the same reason: the registry stays a flat list of controls and
 * never learns about this screen's state.
 */
function CustomerAddBridge({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const handler = (): void => onOpen()
    window.addEventListener('jewellery:add-customer', handler)
    return () => window.removeEventListener('jewellery:add-customer', handler)
  }, [onOpen])
  return null
}

function AddCustomerDialog({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string
  onClose: () => void
  onCreated: (customer: CustomerDto) => void
}) {
  const [form, setForm] = useState({
    name: initialName,
    mobile: '',
    address: '',
    city: '',
    cnic: '',
    openingGoldGrams: '',
    openingCashRupees: '',
  })
  const [isWalkIn, setIsWalkIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The double-save guard. A ref, not state: a second click can arrive before
  // React has re-rendered with a disabled button, and the ref is already set.
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  async function save(): Promise<void> {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.createCustomer({ ...form, isWalkIn })
      if (!result.ok) {
        setError(result.message)
        return
      }
      onCreated(result.customer)
      onClose()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <Modal label="Add New Customer" onClose={onClose} onConfirm={() => void save()} wide>
      <h2 className="modal__title">Add New Customer</h2>
      <p className="modal__subtitle">
        An account customer can carry a balance. A walk-in cannot — the sale has to be
        paid in full, because there is no ledger for the balance to sit on.
      </p>

      <div className="modal__sections">
        <section>
          <div className="form-section__title">Identity</div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                placeholder="IMRAN SAHIB"
                autoFocus
              />
              <span className="field__hint">This is what prints on the invoice.</span>
            </label>
            <label className="field">
              <span className="field__label">CNIC (optional)</span>
              <input
                className="input"
                value={form.cnic}
                onChange={(e) => set('cnic')(e.target.value)}
                placeholder="35202-0000000-0"
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: 'var(--space-12)' }}>
            <span className="field__label">Account type</span>
            <select
              className="select"
              value={isWalkIn ? 'walkin' : 'account'}
              onChange={(e) => setIsWalkIn(e.target.value === 'walkin')}
              aria-label="Account type"
            >
              <option value="account">Account customer — can carry a balance</option>
              <option value="walkin">Walk-in — must pay in full</option>
            </select>
          </label>
        </section>

        <section>
          <div className="form-section__title">Contact</div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Mobile</span>
              <input
                className="input"
                value={form.mobile}
                onChange={(e) => set('mobile')(e.target.value)}
                placeholder="0300 0000000"
              />
              <span className="field__hint">How a lost receipt gets found again.</span>
            </label>
            <label className="field">
              <span className="field__label">City</span>
              <input
                className="input"
                value={form.city}
                onChange={(e) => set('city')(e.target.value)}
                placeholder="Lahore"
                disabled={isWalkIn}
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: 'var(--space-12)' }}>
            <span className="field__label">Address</span>
            <input
              className="input"
              value={form.address}
              onChange={(e) => set('address')(e.target.value)}
              placeholder="Sona Bazaar"
              disabled={isWalkIn}
            />
          </label>
        </section>

        <section>
          <div className="form-section__title">Opening Balances</div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Opening gold (g)</span>
              <input
                className="input input--numeric"
                value={form.openingGoldGrams}
                onChange={(e) => set('openingGoldGrams')(e.target.value)}
                placeholder="0.000"
                inputMode="decimal"
                disabled={isWalkIn}
              />
            </label>
            <label className="field">
              <span className="field__label">Opening cash (Rs)</span>
              <input
                className="input input--numeric"
                value={form.openingCashRupees}
                onChange={(e) => set('openingCashRupees')(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                disabled={isWalkIn}
              />
            </label>
          </div>
          <p className="callout">
            {isWalkIn
              ? 'A walk-in deliberately cannot carry an opening balance. An opening balance is a claim that money or metal was already owed, and a customer with no account has no history for that claim to sit in.'
              : 'Opening balances are what the customer already owed when the shop started using this system. Positive means they owe you. They cannot be edited afterwards — a correction is a ledger entry, so invoices already printed keep their meaning.'}
          </p>
        </section>
      </div>

      {error ? (
        <div className="login__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="modal__foot">
        <Action id="retail.customer.cancel" variant="ghost" onActivate={onClose}>
          Cancel
        </Action>
        <Action
          id="retail.customer.save"
          className="login__submit"
          busy={busy}
          onActivate={() => void save()}
        >
          {busy ? 'Saving…' : 'Save Customer'}
        </Action>
      </div>
    </Modal>
  )
}
