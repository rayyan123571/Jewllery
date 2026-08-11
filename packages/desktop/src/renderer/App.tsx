import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Action, ActionsProvider } from './actions/Action.js'
import { createActionRegistry, type ActionId } from './actions/registry.js'
import { Icon } from './shell/Icon.js'
import { MODULES, isModuleBuilt, moduleById, type ModuleId } from './shell/modules.js'
import { ModulePlaceholder } from './shell/ModulePlaceholder.js'
import { WholesaleScreen } from './modules/wholesale/WholesaleScreen.js'
import { RetailScreen } from './modules/retail/RetailScreen.js'
import { GoldRateScreen } from './modules/rates/GoldRateScreen.js'
import { SettingsScreen } from './modules/settings/SettingsScreen.js'
import { MessageRegion, MessagesProvider } from './components/Messages.js'
import { isoToday } from './format/dates.js'
import type { BootstrapDto } from '../shared/ipc.js'

/**
 * The application shell.
 *
 * Every module in MODULES renders from day one — sidebar and top bar both — so
 * the whole shape of the app is visible while most of it is still off. Moving to
 * an unbuilt module works and shows a screen naming the milestone that delivers
 * it; it is the controls *inside* that module which are disabled.
 */

const EMPTY_BOOTSTRAP: BootstrapDto = {
  branchId: '',
  branchName: 'Main Branch',
  user: null,
  users: [],
  rates: [],
  backup: { lastBackupAt: null, lastBackupDisplay: 'Never', daysSince: null, integrityOk: false },
  databaseConnected: false,
  sidebarCollapsed: null,
}

/**
 * Modules that open with the sidebar collapsed to its 64px icon rail.
 *
 * Retail is the densest screen in the application and the one that has to fit a
 * whole sale — header, slips, item columns, summary and the action row — into
 * 830px with no page scrollbar. The 184px the expanded sidebar costs is worth
 * more to the sale than to the menu, and navigation does not disappear: the rail
 * keeps every icon, and the toggle (or Ctrl+B) brings the labels straight back.
 *
 * It is a DEFAULT, not a lock. A stored manual choice still wins over it —
 * see `collapsed` below.
 */
const COLLAPSE_BY_DEFAULT: ReadonlySet<ModuleId> = new Set<ModuleId>(['sale-retail'])

/**
 * Below this the sidebar collapses itself.
 *
 * Matches theme.size.sidebarAutoCollapseBelow. It is duplicated here as a
 * number because a media query cannot set React state and this rule has to be
 * one the toggle can overrule — see `collapsed` below.
 */
const SIDEBAR_AUTO_COLLAPSE_BELOW = 1280

/**
 * The provider seam. Kept as a thin wrapper so the shell below it can call
 * useMessages from anywhere, and so <App /> stays self-contained — the shell
 * test renders it directly and must not have to know about the providers.
 */
export function App() {
  return (
    <MessagesProvider>
      <AppShell />
    </MessagesProvider>
  )
}

function AppShell() {
  const [active, setActive] = useState<ModuleId>('wholesale')
  const [boot, setBoot] = useState<BootstrapDto>(EMPTY_BOOTSTRAP)
  const [busy, setBusy] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  /**
   * The manual choice about the sidebar, or null for "follow the window width".
   *
   * Three states, because two cannot express it: the width rule has to be able
   * to act when nobody has expressed a preference, and stop acting the moment
   * somebody has. `?? narrow` below is the whole rule.
   */
  const [sidebarChoice, setSidebarChoice] = useState<boolean | null>(null)
  const [narrow, setNarrow] = useState(
    () => window.innerWidth < SIDEBAR_AUTO_COLLAPSE_BELOW,
  )
  /** Set when the operator asks to change who is working. */
  const [switching, setSwitching] = useState(false)
  /**
   * The active module, readable from a callback that must not be rebuilt when it
   * changes. `toggleSidebar` is handed to the action registry, which is memoised
   * — making it depend on `active` would rebuild every action on every
   * navigation for the sake of one read.
   */
  const activeRef = useRef<ModuleId>(active)
  activeRef.current = active

  useEffect(() => {
    void window.api
      ?.bootstrap()
      .then((next) => {
        setBoot(next)
        setSidebarChoice(next.sidebarCollapsed ?? null)
      })
      .catch(() => setBoot(EMPTY_BOOTSTRAP))
  }, [])

  // Keeps the fullscreen glyph honest. F11 and Esc change the same state
  // without going through our button, so the state has to come from the window.
  useEffect(() => {
    const controls = window.api?.windowControls
    if (!controls) return
    void controls.isFullscreen().then(setFullscreen)
    return controls.onFullscreenChange(setFullscreen)
  }, [])

  useEffect(() => {
    const onResize = (): void =>
      setNarrow(window.innerWidth < SIDEBAR_AUTO_COLLAPSE_BELOW)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
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

  // Three inputs, in priority order: the operator's stored choice wins over
  // everything; failing that, a module that asks to open collapsed; failing
  // that, the window width.
  const collapsed = sidebarChoice ?? (COLLAPSE_BY_DEFAULT.has(active) || narrow)

  const toggleSidebar = useCallback(() => {
    setSidebarChoice((current) => {
      // Toggling from "no choice yet" has to flip whatever is CURRENTLY showing,
      // which is the module default or the width rule — not a fixed assumption.
      const showing =
        current ??
        (COLLAPSE_BY_DEFAULT.has(activeRef.current) ||
          window.innerWidth < SIDEBAR_AUTO_COLLAPSE_BELOW)
      const next = !showing
      // Written through, so the answer survives a restart. Nothing waits on it.
      void window.api?.setSidebarCollapsed(next)
      return next
    })
  }, [])

  const toggleFullscreen = useCallback(() => {
    void window.api?.windowControls.toggleFullscreen()
  }, [])

  /**
   * The keyboard shortcuts the chrome owns.
   *
   * Escape is the careful one. A dialog handles it first, in the capture phase,
   * and calls preventDefault — so `defaultPrevented` is exactly "a dialog has
   * already used this". The four things that legitimately own Escape are named
   * explicitly rather than guessed at, because leaving fullscreen while a
   * calendar is open would close the wrong thing and look like a bug.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'F11') {
        event.preventDefault()
        toggleFullscreen()
        return
      }
      if (event.ctrlKey && (event.key === 'b' || event.key === 'B')) {
        event.preventDefault()
        toggleSidebar()
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented || !fullscreen) return
      const ownsEscape = document.querySelector(
        '.modal, .calendar, .party__list, .customer__list',
      )
      if (ownsEscape) return
      event.preventDefault()
      toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, toggleFullscreen, toggleSidebar])

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
        toggleFullscreenWindow: toggleFullscreen,
        closeWindow: () => void window.api?.windowControls.close(),
        toggleSidebar,
        switchUser: () => setSwitching(true),
        // Two controls open a dialog owned by a selector rather than by the
        // screen, so they raise their own event; everything else is handed to
        // whichever screen is mounted.
        dispatch: (id) =>
          window.dispatchEvent(
            id === 'wholesale.party.add'
              ? new CustomEvent('jewellery:add-party')
              : id === 'retail.customer.add'
                ? new CustomEvent('jewellery:add-customer')
                : new CustomEvent('jewellery:action', { detail: id }),
          ),
      }),
    [refreshRates, runBackup, toggleFullscreen, toggleSidebar],
  )

  const chooseUser = async (userId: string): Promise<void> => {
    const result = await window.api.selectUser(userId)
    if (!result.ok) return
    setSwitching(false)
    await reload()
  }

  /**
   * There is still no sign-in screen. This is identification, not a password
   * wall: one click, no field to type into.
   *
   * It appears in exactly two situations, and never otherwise — a one-person
   * shop sees nothing at all, because the main process picks the only active
   * user silently:
   *
   *   - more than one active user and nobody chosen yet (`boot.user` is null)
   *   - the operator asked to switch
   *
   * The cost is one click a shift. What it buys is `created_by` naming the
   * person who actually made the entry, and the role permissions applying to
   * them rather than to whichever account the app happened to start as.
   */
  if (!boot.user || switching) {
    return (
      <ActionsProvider registry={registry}>
        <div className="login">
          <div className="login__card login__card--users">
            <div className="login__brand">
              <span className="sidebar__crest">AH</span>
              <span className="sidebar__name">
                AL-HARAM
                <br />
                GOLD JEWELLERS
              </span>
              <span className="login__tagline">Trust in Purity</span>
            </div>
            {boot.users.length > 0 ? (
              <>
                <h1 className="login__title">Who is working?</h1>
                <p className="login__note">
                  Every sale records who entered it. Pick your name to carry on — there
                  is no password.
                </p>
                <div className="user-picker">
                  {boot.users.map((user) => (
                    <Action
                      key={user.id}
                      id="user.pick"
                      variant="plain"
                      className="user-picker__card"
                      ariaLabel={`Continue as ${user.name}`}
                      onActivate={() => void chooseUser(user.id)}
                    >
                      <span className="user-chip__avatar" aria-hidden="true">
                        {initialsOf(user.name)}
                      </span>
                      <span className="user-picker__text">
                        <strong className="user-picker__name">{user.name}</strong>
                        <span className="user-picker__role">{user.role}</span>
                      </span>
                    </Action>
                  ))}
                </div>
              </>
            ) : (
              // Not a login prompt — this is what shows if the main process
              // could not name a user at all, which means it could not
              // attribute an entry either. That is a fault, and it says so.
              <p className="login__note">Starting up…</p>
            )}
          </div>
        </div>
      </ActionsProvider>
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
      <div className={`app${collapsed ? ' is-collapsed' : ''}`}>
        <Sidebar active={active} collapsed={collapsed} boot={boot} />
        <div className="workspace">
          {/*
            The drag region, and the whole of it.

            The top bar used to be what you grabbed to move a frameless window.
            With it gone, this 28px strip along the top edge of the content area
            takes the job — and it is a REAL element, not a CSS afterthought,
            because -webkit-app-region only applies to something that occupies
            space. Double-click-to-maximise comes with it: Windows gives that to
            any drag region, the same way it does to a native title bar.

            The three window buttons float at its right and opt back out with
            no-drag, or they would move the window instead of being clickable.
          */}
          <div className="drag-strip">
            <WindowControls fullscreen={fullscreen} />
          </div>
          {/* One region for what just happened, so a confirmation appears in
              the same place whichever screen raised it. */}
          <MessageRegion />
          <main className="content">
            {busy ? <div className="banner">{busy}</div> : null}
            {active === 'wholesale' ? (
              <WholesaleScreen
                today={today}
                rates={boot.rates}
                onRateSaved={() => void reload()}
                onPosted={() => void reload()}
              />
            ) : active === 'sale-retail' ? (
              <RetailScreen
                today={today}
                rates={boot.rates}
                onRateSaved={() => void reload()}
                onPosted={() => void reload()}
              />
            ) : active === 'gold-rate' ? (
              <GoldRateScreen
                rates={boot.rates}
                today={today}
                onSaved={() => void reload()}
              />
            ) : active === 'settings' ? (
              <SettingsScreen />
            ) : (
              <ModulePlaceholder id={active} />
            )}
          </main>
        </div>
      </div>
    </ActionsProvider>
  )
}

function Sidebar({
  active,
  collapsed,
  boot,
}: {
  active: ModuleId
  collapsed: boolean
  boot: BootstrapDto
}) {
  return (
    <nav className="sidebar" aria-label="Main menu">
      <div className="sidebar__brand">
        <span className="sidebar__crest">AH</span>
        {/* The wordmark and the tagline are hidden by CSS at 64px, not removed
            from the DOM: the crest stays, and so does everything a test or a
            screen reader can reach. */}
        <span className="sidebar__lockup">
          <span className="sidebar__name">
            AL-HARAM
            <br />
            GOLD JEWELLERS
          </span>
          <span className="sidebar__tagline">Trust in Purity</span>
        </span>
        <Action
          id="app.sidebar-toggle"
          variant="icon"
          className="sidebar__toggle"
          ariaLabel={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
        </Action>
      </div>
      <div className="sidebar__items">
        {/* MODULES is walked in its own order and a heading is emitted where
            the group changes. The groups are contiguous runs of the existing
            list, so nothing is reordered — grouping is presentation only. */}
        {MODULES.map((module, index) => {
          const previous = index === 0 ? undefined : MODULES[index - 1]?.group
          return (
            <Fragment key={module.id}>
              {module.group && module.group !== previous ? (
                <div className="sidebar__section">{module.group}</div>
              ) : null}
              <Action
                id={`nav.${module.id}` as ActionId}
                variant="sidebar"
                active={active === module.id}
              >
                <Icon name={module.icon} size={20} />
                <span>{module.label}</span>
              </Action>
            </Fragment>
          )
        })}
      </div>
      <div className="sidebar__foot">
        {/* The user chip came down here when the top bar went. It is the one
            control that has to be reachable from every screen without taking a
            band of height off all of them, and the sidebar foot is the only
            piece of permanent chrome left. */}
        <UserChip boot={boot} collapsed={collapsed} />
        <Action id="app.exit" variant="sidebar" className="sidebar__exit">
          <Icon name="exit" />
          <span>EXIT</span>
        </Action>
      </div>
    </nav>
  )
}

/**
 * Minimise / fullscreen / close for the frameless window.
 *
 * They live at the right of the module bar rather than in a strip of their own,
 * so the application has ONE bar across the top instead of the OS chrome plus
 * ours plus the modules. The bar itself is the drag region; these buttons opt
 * out of it, or they would move the window instead of being clickable.
 *
 * The middle button is FULLSCREEN, which is not what a Windows user expects
 * from that position — so it does not wear the maximise glyph. Four corners
 * pointing out means "take the whole display"; four pointing in means "give it
 * back". Both are what the OS itself uses, and the aria-label and the hover
 * text say the word as well.
 */
function WindowControls({ fullscreen }: { fullscreen: boolean }) {
  return (
    <div className="window-controls">
      <Action id="window.minimize" variant="window" ariaLabel="Minimise">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <rect x="1" y="5" width="9" height="1.3" fill="currentColor" />
        </svg>
      </Action>
      <Action
        id="window.maximize"
        variant="window"
        ariaLabel={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fullscreen ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            aria-hidden="true"
          >
            <path d="M4.4 1.2v3.2H1.2M6.6 1.2v3.2h3.2M4.4 9.8V6.6H1.2M6.6 9.8V6.6h3.2" />
          </svg>
        ) : (
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            aria-hidden="true"
          >
            <path d="M1.2 4.2V1.2h3M9.8 4.2V1.2h-3M1.2 6.8v3h3M9.8 6.8v3h-3" />
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
 * Who is working, and the two facts the status bar used to carry.
 *
 * Database connected and last backup live here as well as in Settings, and the
 * duplication is the point: this is the one place they are reachable without
 * leaving whatever screen you are on, which is what the strip along the bottom
 * was actually for. What it is NOT is a permanent 32px band across every screen
 * to say "Connected" on a machine that is connected.
 */
function UserChip({ boot, collapsed }: { boot: BootstrapDto; collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = boot.user?.name ?? 'Not signed in'

  return (
    <div
      className={`user-chip-wrap${collapsed ? ' is-collapsed' : ''}`}
      ref={wrapper}
    >
      <Action
        id="app.user-menu"
        variant="plain"
        className="user-chip"
        // Named for the rail, where the chip renders as an avatar disc alone.
        ariaLabel={`Account — ${name}`}
        onActivate={() => setOpen((current) => !current)}
      >
        <span className="user-chip__avatar" aria-hidden="true">
          {initialsOf(name)}
        </span>
        {/* Hidden by CSS at the 64px rail, not removed from the DOM — the
            avatar stays, and so does everything a test or a screen reader
            can reach. Same rule as the sidebar wordmark. */}
        <span className="user-chip__text">
          <strong className="user-chip__name">{name}</strong>
          <span className="user-chip__role">{boot.user?.role ?? '—'}</span>
        </span>
        <Icon name="chevron" size={12} />
      </Action>
      {open ? (
        <div className="popover popover--up" role="menu" aria-label="Account">
          <div className="popover__status">
            <span className="popover__status-line">
              <span>Database</span>
              <span>
                {boot.databaseConnected ? 'Connected' : 'Not connected'}
                <span
                  className={`status-dot${boot.databaseConnected ? '' : ' status-dot--off'}`}
                  aria-hidden="true"
                />
              </span>
            </span>
            <span className="popover__status-line">
              <span>Last backup</span>
              <span>{boot.backup.lastBackupDisplay}</span>
            </span>
          </div>
          {/* Switching who is working needs the "Who is working?" card, which
              exists. Sign out belongs to Users & Permissions, whose screen is
              not drawn — so it is shown and visibly off rather than omitted. */}
          <Action id="users.switch" variant="menu">
            <Icon name="users" size={16} />
            <span>Switch user</span>
          </Action>
          <Action id="users.sign-out" variant="menu">
            <Icon name="exit" size={16} />
            <span>Sign out</span>
          </Action>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Up to two initials for the avatar.
 *
 * "Administrator" gives A, "Haji Abdul Rehman" gives HR — the first and last
 * word, which is how a name is abbreviated at a counter.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** Re-exported for the shell test, which asserts against the real module list. */
export { MODULES, isModuleBuilt, moduleById }
