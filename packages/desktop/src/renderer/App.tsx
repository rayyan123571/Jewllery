import { useCallback, useEffect, useMemo, useState } from 'react'
import { Action, ActionsProvider } from './actions/Action.js'
import { createActionRegistry, type ActionId } from './actions/registry.js'
import { Icon } from './shell/Icon.js'
import { MODULES, isModuleBuilt, moduleById, type ModuleId } from './shell/modules.js'
import { ModulePlaceholder } from './shell/ModulePlaceholder.js'
import { WholesaleScreen } from './modules/wholesale/WholesaleScreen.js'
import { GoldRateScreen } from './modules/rates/GoldRateScreen.js'
import { LoginScreen } from './modules/auth/LoginScreen.js'
import { isoOf, isoToday, toDisplayDate } from './format/dates.js'
import type { BootstrapDto, UserDto } from '../shared/ipc.js'

/**
 * The application shell.
 *
 * Every module in MODULES renders from day one — sidebar and top bar both — so
 * the whole shape of the app is visible while most of it is still off. Moving to
 * an unbuilt module works and shows a screen naming the milestone that delivers
 * it; it is the controls *inside* that module which are disabled.
 */

const EMPTY_BOOTSTRAP: BootstrapDto = {
  shop: null,
  branchId: '',
  branchName: 'Main Branch',
  user: null,
  rates: [],
  backup: { lastBackupAt: null, lastBackupDisplay: 'Never', daysSince: null, integrityOk: false },
  databaseConnected: false,
  financialYear: '',
  appVersion: '0.0.0',
}

export function App() {
  const [active, setActive] = useState<ModuleId>('wholesale')
  const [boot, setBoot] = useState<BootstrapDto>(EMPTY_BOOTSTRAP)
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(true)

  useEffect(() => {
    void window.api?.bootstrap().then(setBoot).catch(() => setBoot(EMPTY_BOOTSTRAP))
  }, [])

  // Keeps the maximise glyph honest. Double-clicking the drag region maximises
  // without going through our button, so the state has to come from the window.
  useEffect(() => {
    const controls = window.api?.windowControls
    if (!controls) return
    void controls.isMaximized().then(setMaximized)
    return controls.onMaximizedChange(setMaximized)
  }, [])

  // The mockup shows a live clock in the top bar.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const reload = useCallback(async () => {
    const next = await window.api.bootstrap()
    setBoot(next)
  }, [])

  const refreshRates = useCallback(async () => {
    const rates = await window.api.currentRates()
    setBoot((current) => ({ ...current, rates }))
  }, [])

  const runBackup = useCallback(async () => {
    setBusy('Backing up…')
    try {
      const backup = await window.api.runBackup()
      setBoot((current) => ({ ...current, backup }))
    } finally {
      setBusy(null)
    }
  }, [])

  const registry = useMemo(
    () =>
      createActionRegistry({
        navigate: setActive,
        exit: () => void window.api?.quit(),
        refreshRates,
        runBackup,
        // Restore needs a file chooser, which belongs to the Backup screen
        // rather than the shell. Wired when that screen is built.
        restoreBackup: async () => {
          await Promise.resolve()
        },
        toggleUserMenu: () => {
          /* the menu itself is part of Users & Permissions */
        },
        // Handed to whichever screen is mounted. The screen owns the state, so
        // the registry never has to know what any of these actually do.
        minimizeWindow: () => void window.api?.windowControls.minimize(),
        toggleMaximizeWindow: () => void window.api?.windowControls.toggleMaximize(),
        closeWindow: () => void window.api?.windowControls.close(),
        dispatch: (id) =>
          window.dispatchEvent(
            id === 'wholesale.party.add'
              ? new CustomEvent('jewellery:add-party')
              : new CustomEvent('jewellery:action', { detail: id }),
          ),
      }),
    [refreshRates, runBackup],
  )

  // The shell is not drawn until someone is signed in. Every IPC handler that
  // writes anything refuses without a session anyway; this is so the header
  // never shows "Not signed in" over a working screen.
  if (!boot.user) {
    return (
      <LoginScreen
        onSignedIn={(user: UserDto) => {
          setBoot((current) => ({ ...current, user }))
          void reload()
        }}
      />
    )
  }

  // Local date, not toISOString(). The rate service resolves "today" with
  // businessDayOf(), which uses the machine's own calendar because the shop PC
  // sits in the shop. toISOString() is UTC, so for part of every day the two
  // disagreed and a rate could be saved against the wrong business day —
  // showing as "No rate set" on a slip dated today. See format/dates.ts.
  const today = isoToday()

  return (
    <ActionsProvider registry={registry}>
      <div className="app">
        <div className="app__body">
          <Sidebar active={active} />
          <div className="workspace">
            <TopBar boot={boot} now={now} maximized={maximized} onRateSaved={() => void reload()} />
            <main className="content">
              {busy ? <div className="banner">{busy}</div> : null}
              {active === 'wholesale' ? (
                <WholesaleScreen today={today} onPosted={() => void reload()} />
              ) : active === 'gold-rate' ? (
                <GoldRateScreen
                  rates={boot.rates}
                  today={today}
                  onSaved={() => void reload()}
                />
              ) : (
                <ModulePlaceholder id={active} />
              )}
            </main>
          </div>
        </div>
        <StatusBar boot={boot} />
      </div>
    </ActionsProvider>
  )
}

function Sidebar({ active }: { active: ModuleId }) {
  return (
    <nav className="sidebar" aria-label="Main menu">
      <div className="sidebar__brand">
        <span className="sidebar__crest">AH</span>
        <span className="sidebar__name">
          AL-HARAM
          <br />
          GOLD JEWELLERS
        </span>
      </div>
      <div className="sidebar__section">MAIN MENU</div>
      <div className="sidebar__items">
        {MODULES.map((module) => (
          <Action
            key={module.id}
            id={`nav.${module.id}` as ActionId}
            variant="sidebar"
            active={active === module.id}
          >
            <Icon name={module.icon} />
            <span>{module.label}</span>
          </Action>
        ))}
      </div>
      <div className="sidebar__foot">
        <Action id="app.exit" variant="sidebar" className="sidebar__exit">
          <Icon name="exit" />
          <span>EXIT</span>
        </Action>
      </div>
    </nav>
  )
}

function TopBar({
  boot,
  now,
  maximized,
  onRateSaved,
}: {
  boot: BootstrapDto
  now: Date
  maximized: boolean
  onRateSaved: () => void
}) {
  return (
    <header className="top-bar">
      {/* No module buttons here. Every module is already in the sidebar, and
          listing them twice cost a whole band of screen height for nothing.

          The rate leads, hard against the sidebar edge: it is the figure every
          amount on the screen below is derived from. It used to float in the
          middle with 450px of dead bar to its left. The drag region is now the
          gap between the rate and the clock, so there is still somewhere to
          grab the window. */}
      <RatePanel boot={boot} onSaved={onRateSaved} />

      <div className="top-bar__drag" />

      <div className="top-bar__aside">
        <Clock now={now} />
        <UserChip boot={boot} />
        <WindowControls maximized={maximized} />
      </div>
    </header>
  )
}

/**
 * Minimise / maximise / close for the frameless window.
 *
 * They live at the right of the module bar rather than in a strip of their own,
 * so the application has ONE bar across the top instead of the OS chrome plus
 * ours plus the modules. The bar itself is the drag region; these buttons opt
 * out of it, or they would move the window instead of being clickable.
 */
function WindowControls({ maximized }: { maximized: boolean }) {
  return (
    <div className="window-controls">
      <Action id="window.minimize" variant="window" ariaLabel="Minimise">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <rect x="1" y="5" width="9" height="1.3" fill="currentColor" />
        </svg>
      </Action>
      <Action id="window.maximize" variant="window" ariaLabel={maximized ? 'Restore' : 'Maximise'}>
        {maximized ? (
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <rect x="1" y="3" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M3.4 3V1.4h6.2v6.2H8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <rect x="1.2" y="1.2" width="8.6" height="8.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </Action>
      <Action id="window.close" variant="window" className="window-controls__close" ariaLabel="Close">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </Action>
    </div>
  )
}

/**
 * The rate panel, with each figure editable in place.
 *
 * Saving goes through the SAME setRate IPC the Gold Rate screen uses, with
 * effectiveFrom = today — there is no second rate store and no shortcut. A rate
 * set here is a new row in gold_rates exactly as if it had been typed on the
 * full screen, so history and the effective-date model are untouched.
 */
function RatePanel({ boot, onSaved }: { boot: BootstrapDto; onSaved: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // A refused rate used to vanish silently: the panel closed and showed the old
  // figure, so a typo that broke the purity ordering looked like it had saved.
  const [error, setError] = useState<string | null>(null)

  const begin = (purity: string, display: string): void => {
    setEditing(purity)
    setError(null)
    // Seed with digits only — a user editing "Rs. 358,000" wants to retype the
    // number, not delete the currency and the separators first.
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
        note: 'edited from the rate panel',
      })
      if (result.ok) {
        setError(null)
        onSaved()
      } else {
        // Refused — most often a purity-ordering conflict (RateService rejects
        // a lower purity priced above a higher one). Say so rather than closing
        // the editor as though it had been accepted.
        setError(result.message)
      }
    } finally {
      setSaving(false)
      setEditing(null)
    }
  }

  return (
    <div className={`rate-panel${error ? ' rate-panel--bad' : ''}`}>
      <div className="rate-panel__title">
        Gold Rate (Per Tola){' '}
        <Action id="rate.refresh" variant="icon" ariaLabel="Refresh gold rate">
          <Icon name="refresh" size={12} />
        </Action>
      </div>
      {boot.rates.length === 0 ? (
        // A missing rate is shown as missing, never as zero. Valuing gold at a
        // made-up price is invisible; an empty panel is not. See DECISIONS §7.
        <div className="rate-panel__empty">No rate set</div>
      ) : (
        boot.rates.map((rate) => (
          <div className="rate-panel__row" key={rate.purity}>
            <span>{rate.purity}</span>
            {editing === rate.purity ? (
              <input
                className="rate-panel__input"
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
                className="rate-panel__value"
                ariaLabel={`Edit ${rate.purity} rate`}
                onActivate={() => begin(rate.purity, rate.display)}
              >
                {rate.display}
              </Action>
            )}
          </div>
        ))
      )}
      {error ? (
        // The bar has no room for a sentence, so the panel carries the short
        // form and the full message is one hover away. The Gold Rate screen
        // shows the same message in full.
        <div className="rate-panel__error" role="alert" title={error}>
          Rate refused
        </div>
      ) : null}
    </div>
  )
}

function Clock({ now }: { now: Date }) {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' })
  // DD-MM-YYYY, the one date format in the application. "10 August 2026" here
  // while the slip below said 2026-08-10 and the picker said 10/08/2026 gave
  // the operator three formats to reconcile on one screen.
  const date = toDisplayDate(isoOf(now))
  const time = now.toLocaleTimeString('en-GB', { hour12: true })
  return (
    <div className="clock">
      <div className="clock__day">{day}</div>
      <div className="clock__date">{date}</div>
      <div className="clock__time">{time}</div>
    </div>
  )
}

function UserChip({ boot }: { boot: BootstrapDto }) {
  return (
    <Action id="app.user-menu" variant="plain" className="user-chip">
      <Icon name="user" size={20} />
      <span className="user-chip__text">
        <strong className="user-chip__name">{boot.user?.name ?? 'Not signed in'}</strong>
        <span className="user-chip__role">{boot.user?.role ?? '—'}</span>
      </span>
      <Icon name="chevron" size={14} />
    </Action>
  )
}

function StatusBar({ boot }: { boot: BootstrapDto }) {
  return (
    <footer className="status-bar">
      <span>
        <strong>Company :</strong> {boot.shop?.name ?? 'Not set'}
      </span>
      <span>
        <strong>Financial Year :</strong> {boot.financialYear || '—'}
      </span>
      <span>
        <strong>Database :</strong> {boot.databaseConnected ? 'Connected' : 'Not connected'}
        <span
          className={`status-bar__dot${boot.databaseConnected ? '' : ' status-bar__dot--off'}`}
        />
      </span>
      <span>
        <strong>Backup :</strong> {boot.backup.lastBackupDisplay}
      </span>
      <span className="status-bar__version">
        <strong>Version :</strong> {boot.appVersion}
      </span>
    </footer>
  )
}

/** Re-exported for the shell test, which asserts against the real module list. */
export { MODULES, isModuleBuilt, moduleById }
