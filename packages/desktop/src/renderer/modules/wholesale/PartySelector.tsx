import { useCallback, useEffect, useRef, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { EmptyState } from '../../components/EmptyState.js'
import { GhostInput } from '../../components/GhostInput.js'
import { Modal } from '../../components/Modal.js'
import { Icon } from '../../shell/Icon.js'
import type { PartyDto } from '../../../shared/ipc.js'

/**
 * The party selector, carried across from the reference's CustomerEntry.
 *
 * Three behaviours worth keeping, each earned:
 *
 *   - **Strict prefix autocomplete**, via GhostInput. A suggestion that appears
 *     mid-word cannot be predicted, so it stops being trusted.
 *   - **A debounced lookup** (150 ms), so a fast typist does not fire a query per
 *     keystroke.
 *   - **A double-save guard** on the inline add form. Without it, a second click
 *     while the first is still in flight creates two parties with the same
 *     details, and the ledger then has two accounts for one shop — which is
 *     invisible until the balances disagree.
 *
 * The code field is separate from the name field on purpose: at a counter people
 * know the code, and typing it should not have to compete with name matches.
 */
export function PartySelector({
  selected,
  onSelect,
  disabled,
}: {
  selected: PartyDto | null
  onSelect: (party: PartyDto | null) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [code, setCode] = useState('')
  const [matches, setMatches] = useState<readonly PartyDto[]>([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selected) {
      setQuery(selected.name)
      setCode(selected.code)
    }
  }, [selected])

  // Debounced, so a fast typist fires one query rather than one per keystroke.
  useEffect(() => {
    if (query.trim().length === 0) {
      setMatches([])
      return
    }
    const timer = setTimeout(() => {
      void window.api.searchParties(query).then(setMatches)
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  const pick = useCallback(
    (party: PartyDto) => {
      onSelect(party)
      setQuery(party.name)
      setCode(party.code)
      setOpen(false)
    },
    [onSelect],
  )

  return (
    <div className="party">
      <label className="field">
        <span className="field__label">Party / Customer</span>
        {/* The type-ahead and its "add" button share ONE outline and focus
            together. They were two separate boxes of two different heights
            sitting next to each other, which read as two unrelated controls. */}
        <span className="input-group">
          <GhostInput
            value={query}
            onChange={(next) => {
              setQuery(next)
              setOpen(true)
              // Typing past a chosen party clears the selection, so the slip can
              // never be saved against a party the box no longer shows.
              if (selected && next !== selected.name) onSelect(null)
            }}
            onAccept={(accepted) => {
              const found = matches.find((m) => m.name === accepted)
              if (found) pick(found)
            }}
            suggestions={matches.map((m) => m.name)}
            className="input"
            placeholder="Search name or code"
            inputRef={nameRef}
            disabled={disabled ?? false}
            ariaLabel="Party"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) {
                event.preventDefault()
                pick(matches[0])
              }
              if (event.key === 'Escape') setOpen(false)
            }}
          />
          <Action id="wholesale.party.add" variant="segment" ariaLabel="Add a new party">
            <Icon name="plus" size={16} />
          </Action>
        </span>

        {/* A search that finds nothing says so and offers the way out. Silently
            not rendering the list left the operator typing into a box that had
            stopped responding, with no way to tell "no such party" from "still
            looking". */}
        {open && matches.length === 0 && query.trim().length > 0 ? (
          <div className="party__list party__list--empty">
            <EmptyState
              title="No party matches"
              line={`Nothing found for "${query.trim()}".`}
              actionId="wholesale.party.add"
              actionLabel="Add New Party"
            />
          </div>
        ) : null}

        {open && matches.length > 0 ? (
          <ul className="party__list">
            {matches.map((match) => (
              <li key={match.id}>
                {/* mousedown, not click: blur would close the list first. */}
                <Action
                  id="wholesale.party.pick"
                  variant="plain"
                  className="party__option"
                  ariaLabel={`Select ${match.name}`}
                  activateOnMouseDown
                  onActivate={() => pick(match)}
                >
                  <span className="party__code">{match.code}</span>
                  <span>{match.name}</span>
                  {match.city ? <span className="party__city">{match.city}</span> : null}
                </Action>
              </li>
            ))}
          </ul>
        ) : null}
      </label>

      {/* Derived, not broken. It fills itself in from the party above, so it
          shows a dash and a dashed, flat ground rather than the same grey an
          unavailable control uses. */}
      <label className="field party__codefield">
        <span className="field__label">Code</span>
        <input
          className="input input--derived"
          value={code}
          readOnly
          disabled
          placeholder="—"
          aria-label="Party code"
        />
      </label>

      {adding ? <AddPartyDialog onClose={() => setAdding(false)} onCreated={pick} /> : null}
      <PartyAddBridge onOpen={() => setAdding(true)} />
    </div>
  )
}

/**
 * Lets the registry's `wholesale.party.add` action open the dialog.
 *
 * The Action component owns the button so the no-dead-buttons test can see it;
 * this listens for the event that action raises. Keeps the button inside the
 * registry without the registry needing to know about this screen's state.
 */
function PartyAddBridge({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const handler = (): void => onOpen()
    window.addEventListener('jewellery:add-party', handler)
    return () => window.removeEventListener('jewellery:add-party', handler)
  }, [onOpen])
  return null
}

function AddPartyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (party: PartyDto) => void
}) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    mobile: '',
    city: '',
    openingGoldGrams: '',
    openingCashRupees: '',
  })
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
      const result = await window.api.createParty({
        code: form.code,
        name: form.name,
        mobile: form.mobile.trim() || null,
        city: form.city.trim() || null,
        openingGoldGrams: form.openingGoldGrams,
        openingCashRupees: form.openingCashRupees,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      onCreated(result.party)
      onClose()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <Modal label="Add New Party" onClose={onClose} onConfirm={() => void save()} wide>
      <h2 className="modal__title">Add New Party</h2>
      <p className="modal__subtitle">
        A wholesale account. The code is what you will type at the counter to find them.
      </p>

      <div className="modal__sections">
        <section>
          <div className="form-section__title">Identity</div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Code</span>
              <input
                className="input"
                value={form.code}
                onChange={(e) => set('code')(e.target.value)}
                placeholder="CHJ"
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
                placeholder="CHAUDHARY JEWELLER"
              />
            </label>
          </div>
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
            </label>
            <label className="field">
              <span className="field__label">City</span>
              <input
                className="input"
                value={form.city}
                onChange={(e) => set('city')(e.target.value)}
                placeholder="Lahore"
              />
            </label>
          </div>
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
              />
            </label>
          </div>
          {/* Not grey small print. This is the one thing on the dialog that
              cannot be undone, so it is a callout the eye lands on. */}
          <p className="callout">
            Opening balances are what the party already owed when the shop started using
            this system. Positive means they owe you. They cannot be edited afterwards —
            a correction is a ledger entry, so slips already printed keep their meaning.
          </p>
        </section>
      </div>

      {error ? (
        <div className="login__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="modal__foot">
        <Action id="wholesale.party.cancel" variant="ghost" onActivate={onClose}>
          Cancel
        </Action>
        <Action
          id="wholesale.party.save"
          className="login__submit"
          busy={busy}
          onActivate={() => void save()}
        >
          {busy ? 'Saving…' : 'Save Party'}
        </Action>
      </div>
    </Modal>
  )
}
