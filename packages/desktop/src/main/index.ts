import { BrowserWindow, Menu, app, dialog, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { toPublicUser } from '@jewellery/domain'
import { createContainer, type Container } from './container.js'
import { registerIpcHandlers, type Session } from './ipc.js'
import { registerWholesaleHandlers } from './wholesaleIpc.js'
import { registerRetailHandlers } from './retailIpc.js'
import { registerPurchaseHandlers } from './purchaseIpc.js'
import { registerInventoryHandlers } from './inventoryIpc.js'
import { fetchLiveGoldOnce, getLastLiveGold, startLiveGold, stopLiveGold } from './liveGold.js'
import { IPC_M2 } from '../shared/ipc.js'

/**
 * Application lifecycle.
 *
 * The window's webPreferences are the security boundary, not a default worth
 * skimming. contextIsolation on, nodeIntegration off and sandbox on together
 * mean the renderer has no `require`, no `fs`, and no route to a file. A React
 * component cannot open the database because Chromium gives it no means to —
 * the runtime half of the rule in docs/ARCHITECTURE.md.
 */

let container: Container | null = null
const session: Session = { user: null }

/**
 * Where the window should open.
 *
 * A saved position is not trusted: a laptop undocked from a second monitor has
 * bounds pointing at a screen that no longer exists, and a window opening at
 * x = 2400 on a single 1920 display is a window the shop cannot find and cannot
 * drag back. `getDisplayMatching` picks the nearest display to those bounds and
 * the size is clamped into its work area — never the full screen area, or the
 * title bar ends up under the taskbar.
 */
function openingBounds(): { x?: number; y?: number; width: number; height: number } {
  const fallback = { width: 1280, height: 853 }
  const saved = container?.settings.windowState().bounds
  if (!saved) return fallback

  const work = screen.getDisplayMatching(saved).workArea
  const width = Math.min(Math.max(saved.width, 1100), work.width)
  const height = Math.min(Math.max(saved.height, 700), work.height)
  return {
    width,
    height,
    x: Math.min(Math.max(saved.x, work.x), work.x + work.width - width),
    y: Math.min(Math.max(saved.y, work.y), work.y + work.height - height),
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...openingBounds(),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#FFFCF4',
    title: 'Gold Jewellery Management System',
    // Frameless: the application draws its own title bar, so there is one bar
    // at the top of the screen instead of the OS chrome plus ours.
    frame: false,
    // Belt and braces on Windows — without it Alt still reveals the menu strip
    // even though setApplicationMenu(null) removed its contents.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  /**
   * The glyph is driven by the WINDOW, not by our button.
   *
   * F11 and Esc change the same state, and so does anything the OS does on its
   * own. A button that only updated its own icon would be showing the wrong
   * glyph the moment the keyboard was used — which is exactly the state a user
   * then presses it in.
   */
  const reportFullscreen = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_M2.windowFullscreenChanged, window.isFullScreen())
    }
  }
  window.on('enter-full-screen', reportFullscreen)
  window.on('leave-full-screen', reportFullscreen)

  // Remembered across restarts. Debounced, because a drag fires `resize` on
  // every frame and a settings write per frame is a write per frame.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const rememberWindowState = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (window.isDestroyed() || !container) return
      const fullscreen = window.isFullScreen()
      const maximized = window.isMaximized()
      container.settings.setWindowState({
        mode: fullscreen ? 'fullscreen' : maximized ? 'maximized' : 'normal',
        // Only a genuinely restored window has bounds worth keeping: the bounds
        // of a maximised or fullscreen window are the screen, and restoring
        // those as a "normal" size would give a window with no edges to grab.
        bounds: fullscreen || maximized ? null : window.getBounds(),
      })
    }, 400)
  }
  window.on('resize', rememberWindowState)
  window.on('move', rememberWindowState)
  window.on('maximize', rememberWindowState)
  window.on('unmaximize', rememberWindowState)
  window.on('enter-full-screen', rememberWindowState)
  window.on('leave-full-screen', rememberWindowState)

  window.once('ready-to-show', () => {
    // A capture asks for an exact CONTENT size in CSS pixels, and it has to be
    // applied INSTEAD of maximising rather than after it: on Windows
    // `unmaximize()` is asynchronous, so the window manager restores the
    // pre-maximise bounds after any setContentSize and the figure asked for is
    // silently ignored. Found by capturing at 1550×830 and getting 1600×1020.
    const captureSize = captureContentSize()
    if (captureSize) {
      window.setContentSize(captureSize.width, captureSize.height)
    } else {
      // Whatever it was last left as. The default is MAXIMISED — filling the
      // work area with the taskbar still visible — because that is the state a
      // till should be in when nobody has asked for anything: a counter never
      // wants a window it has to resize before it can read the grid, and it
      // does not want the clock and the taskbar gone either unless it said so.
      const mode = container?.settings.windowState().mode ?? 'maximized'
      if (mode === 'fullscreen') window.setFullScreen(true)
      else if (mode === 'maximized') window.maximize()
    }
    window.show()
    void runCaptureScenario(window)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../dist/index.html'))
  }

  // Started after the page has something to receive a push, never before —
  // the first poll is async and must not compete with startup for anything.
  window.webContents.once('did-finish-load', () => {
    if (process.env.JEWELLERY_NO_TICKER !== '1') startLiveGold(window)
  })

  return window
}

app.whenReady().then(
  () => {
    // No File/Edit/View strip. This is a till, not a document editor — those
    // menus offer nothing a shopkeeper needs and a stray Ctrl+W closes the app.
    Menu.setApplicationMenu(null)

    // The database lives in the app's own user data directory — never on a
    // network share (docs/DECISIONS.md §5).
    container = createContainer({ dataDirectory: app.getPath('userData') })

    /**
     * There is still no sign-in screen, and there is still a session.
     *
     * The shop asked for the login page to go, and on a single-PC counter that
     * is a reasonable call: the machine is behind the counter, the person using
     * it unlocked the building, and a password typed forty times a day becomes
     * a sticky note on the monitor.
     *
     * What could not go with it is the attribution. Every write records who
     * made it — `created_by` is NOT NULL and a foreign key to `users` on both
     * wholesale entries and retail sales, and the audit log keys on the same
     * id. So the session is IDENTIFIED rather than authenticated:
     *
     *   one active user   → it is chosen here, silently, and nothing is put in
     *                       front of a one-person shop
     *   several           → left null, and the shell asks "Who is working?"
     *                       once, as tappable cards with no password field
     *   none usable       → defaultUser() throws, loudly, at startup
     *
     * The permission model runs against whoever is chosen, so a salesman is a
     * salesman and cannot void a sale. That is the whole reason the card exists:
     * without it, every entry in a shop with staff is attributed to the same
     * account and the audit trail names nobody in particular.
     */
    const active = container.activeUsers()
    const only = active.length === 1 ? active[0] : undefined
    session.user = only
      ? toPublicUser(only)
      : active.length > 1
        ? null
        : container.defaultUser()

    registerIpcHandlers(container, session, () => app.quit())
    registerWholesaleHandlers(container, session)
    registerRetailHandlers(container, session)
    registerPurchaseHandlers(container, session)
    registerInventoryHandlers(container, session)
    registerWindowControls()
    registerLiveGoldHandler()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  },
  // Without this the rejection is swallowed and the user gets a blank screen
  // with no message and nothing in a log — the worst possible failure for an
  // offline app, because there is no server-side trace to go and read.
  reportFatal,
)

/**
 * The frameless window's own minimise / fullscreen / close.
 *
 * They act on the window the request came FROM rather than a captured
 * reference: with a captured one, a second window (or a window reopened on
 * macOS `activate`) would have its buttons quietly driving the first one.
 *
 * The middle button is TRUE FULLSCREEN, not maximise. That is a deliberate
 * departure from the Windows convention — maximise there respects the taskbar,
 * and the shop wants the whole display at the counter. Because it departs from
 * what people expect, the renderer also binds F11 and Esc to the same state, so
 * there are two ways out that need no aiming.
 *
 * Minimise is left completely standard: the window goes to the taskbar and
 * comes back as whatever it was, fullscreen included, because Windows restores
 * the state it minimised rather than a state we invented.
 */
function registerWindowControls(): void {
  ipcMain.handle(IPC_M2.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC_M2.windowToggleFullscreen, (event): boolean => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) return false
    target.setFullScreen(!target.isFullScreen())
    return target.isFullScreen()
  })

  ipcMain.handle(IPC_M2.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC_M2.windowIsFullscreen, (event): boolean =>
    BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false,
  )
}

/**
 * On-demand fetch+parse of the live gold spot — used by the renderer to seed
 * its ticker box on mount, before the first background push arrives.
 */
function registerLiveGoldHandler(): void {
  ipcMain.handle(IPC_M2.liveGoldGet, async () => {
    try {
      return await fetchLiveGoldOnce()
    } catch {
      return getLastLiveGold()
    }
  })
}

/**
 * Anything that stops the application from starting.
 *
 * Startup can fail for reasons the shopkeeper can act on — a database file
 * locked by another copy of the app, a disk that is full, a folder they have no
 * permission to write. Each of those deserves a message they can read, not a
 * window that never appears.
 */
function reportFatal(error: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  console.error('[startup] failed:', detail)

  // Also written to a file, because an offline application has no server-side
  // log for anyone to go and read, and a GUI process on Windows is not attached
  // to a console — so the dialog below is otherwise the only record, and it
  // disappears when the user clicks OK.
  try {
    writeFileSync(
      join(app.getPath('userData'), 'startup-error.log'),
      `${new Date().toISOString()}\n${detail}\n`,
      { flag: 'a' },
    )
  } catch {
    // Nothing useful left to do — the dialog is still shown below.
  }

  dialog.showErrorBox(
    'Gold Jewellery Manager could not start',
    'The application could not open its database.\n\n' +
      detail +
      '\n\nIf another copy of the application is already running, close it and ' +
      'try again. Your data has not been changed.',
  )
  app.quit()
}

/**
 * Diagnostic capture, for verifying the built application rather than only its
 * tests — the same idea as GoldLab's dry-run print dump.
 *
 *   JEWELLERY_CAPTURE       directory to write PNGs into
 *   JEWELLERY_CAPTURE_STEPS JSON: [{ name, js?, waitMs? }, ...]
 *   JEWELLERY_CAPTURE_SIZE  "1550x830" — CONTENT size in CSS pixels
 *
 * Each step optionally runs a snippet in the renderer, waits, then writes
 * <name>.png. With no steps it takes a single shot, as before. Inert unless the
 * environment variables are set, so it costs a shipped build nothing.
 *
 * The size is content size, not window size, and that distinction is the whole
 * reason it exists: a no-page-scroll claim is a claim about a number of CSS
 * pixels, and "maximised on whichever monitor happened to be attached" is not
 * a number. setContentSize takes device-independent pixels, which are CSS
 * pixels, so the figure asked for is the figure the layout gets.
 */
function captureContentSize(): { width: number; height: number } | null {
  if (!process.env.JEWELLERY_CAPTURE) return null
  const size = /^(\d+)x(\d+)$/.exec(process.env.JEWELLERY_CAPTURE_SIZE ?? '')
  return size ? { width: Number(size[1]), height: Number(size[2]) } : null
}

async function runCaptureScenario(window: BrowserWindow): Promise<void> {
  const dir = process.env.JEWELLERY_CAPTURE
  if (!dir) return

  const steps: Array<{ name: string; js?: string; waitMs?: number }> = process.env
    .JEWELLERY_CAPTURE_STEPS
    ? (JSON.parse(process.env.JEWELLERY_CAPTURE_STEPS) as Array<{
        name: string
        js?: string
        waitMs?: number
      }>)
    : [{ name: 'shell', waitMs: 2500 }]

  const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))

  for (const step of steps) {
    try {
      // Whatever the snippet returns is logged. A capture that only produces a
      // PNG cannot answer "does this fit?" — a scrollHeight can, and it is a
      // number rather than an impression of one.
      const reported: unknown = step.js
        ? await window.webContents.executeJavaScript(step.js, true)
        : undefined
      await pause(step.waitMs ?? 900)
      const image = await window.webContents.capturePage()
      writeFileSync(join(dir, `${step.name}.png`), image.toPNG())
      const [width, height] = window.getContentSize()
      console.log(
        `[capture] ${step.name} at ${width}x${height} CSS` +
          (reported === undefined ? '' : ` ${JSON.stringify(reported)}`),
      )
    } catch (error) {
      console.error(`[capture] ${step.name} failed:`, error)
    }
  }
  app.quit()
}

process.on('uncaughtException', reportFatal)
process.on('unhandledRejection', reportFatal)

app.on('window-all-closed', () => {
  app.quit()
})

// Close the connection cleanly so the WAL is folded back into the .sqlite file
// and the database is self-contained for anyone copying it.
app.on('will-quit', () => {
  stopLiveGold()
  container?.dispose()
  container = null
})
