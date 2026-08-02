import { useCallback, useEffect, useRef, useState } from 'react'
import { Action } from '../../actions/Action.js'
import { GhostInput } from '../../components/GhostInput.js'
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
        <span className="field__control">
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
            placeholder="Search by name or code"
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
          <Action id="wholesale.party.add" variant="toolbar" ariaLabel="Add a new party">
            <Icon name="plus" size={13} />
          </Action>
        </span>

        {open && matches.length > 0 ? (
          <ul className="party__list">
            {matches.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  className="party__option"
                  data-action="wholesale.party.pick"
                  data-action-state="ready"
                  title={`Select ${match.name}`}
                  onMouseDown={(event) => {
                    // mousedown, not click: blur would close the list first.
                    event.preventDefault()
                    pick(match)
                  }}
                >
                  <span className="party__code">{match.code}</span>
                  <span>{match.name}</span>
                  {match.city ? <span className="party__city">{match.city}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </label>

      <label className="field party__codefield">
        <span className="field__label">Code</span>
        <input
          className="input"
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
    <div className="modal" role="dialog" aria-label="Add party">
      <div className="modal__card">
        <div className="panel__title">ADD PARTY</div>
        <div className="panel__body">
          <div className="field-row" style={{ gridTemplateColumns: '1fr 2fr', padding: 0 }}>
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

          <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr', padding: 0 }}>
            <label className="field">
              <span className="field__label">Mobile</span>
              <input
                className="input"
                value={form.mobile}
                onChange={(e) => set('mobile')(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">City</span>
              <input
                className="input"
                value={form.city}
                onChange={(e) => set('city')(e.target.value)}
              />
            </label>
          </div>

          <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr', padding: 0 }}>
            <label className="field">
              <span className="field__label">Opening gold (g)</span>
              <input
                className="input input--numeric"
                value={form.openingGoldGrams}
                onChange={(e) => set('openingGoldGrams')(e.target.value)}
                placeholder="0.000"
              />
            </label>
            <label className="field">
              <span className="field__label">Opening cash (Rs)</span>
              <input
                className="input input--numeric"
                value={form.openingCashRupees}
                onChange={(e) => set('openingCashRupees')(e.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>

          <p className="hint">
            Opening balances are what the party already owed when the shop started using
            this system. Positive means they owe you. They cannot be edited afterwards —
            a correction is a ledger entry, so slips already printed keep their meaning.
          </p>

          {error ? <div className="login__error">{error}</div> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="action action--toolbar"
              data-action="party.add.cancel"
              data-action-state="ready"
              title="Cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="login__submit"
              data-action="party.add.save"
              data-action-state="ready"
              title="Save party"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save party'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
