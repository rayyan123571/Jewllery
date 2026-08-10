import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createContainer, type Container } from './container.js'
import { registerIpcHandlers, type Session } from './ipc.js'
import { registerWholesaleHandlers } from './wholesaleIpc.js'
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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 853,
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

  // Both directions are reported so the maximise button can show the right
  // icon — a restore glyph on a maximised window and a maximise glyph
  // otherwise. Without this the button looks wrong after the user
  // double-clicks the drag region, which does not go through our handler.
  const reportMaximised = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_M2.windowMaximizedChanged, window.isMaximized())
    }
  }
  window.on('maximize', reportMaximised)
  window.on('unmaximize', reportMaximised)

  window.once('ready-to-show', () => {
    // Opens filling the screen, like the system it replaces. A shop counter
    // never wants a window it has to resize before it can read the grid.
    window.maximize()
    window.show()
    void runCaptureScenario(window)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../dist/index.html'))
  }

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

    registerIpcHandlers(container, session, app.getVersion(), () => app.quit())
    registerWholesaleHandlers(container, session)
    registerWindowControls()

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
 * The frameless window's own minimise / maximise / close.
 *
 * They act on the window the request came FROM rather than a captured
 * reference: with a captured one, a second window (or a window reopened on
 * macOS `activate`) would have its buttons quietly driving the first one.
 */
function registerWindowControls(): void {
  ipcMain.handle(IPC_M2.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC_M2.windowToggleMaximize, (event): boolean => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) return false
    if (target.isMaximized()) target.unmaximize()
    else target.maximize()
    return target.isMaximized()
  })

  ipcMain.handle(IPC_M2.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC_M2.windowIsMaximized, (event): boolean =>
    BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  )
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
 *
 * Each step optionally runs a snippet in the renderer, waits, then writes
 * <name>.png. With no steps it takes a single shot, as before. Inert unless the
 * environment variables are set, so it costs a shipped build nothing.
 */
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
      if (step.js) await window.webContents.executeJavaScript(step.js, true)
      await pause(step.waitMs ?? 900)
      const image = await window.webContents.capturePage()
      writeFileSync(join(dir, `${step.name}.png`), image.toPNG())
      console.log(`[capture] ${step.name}`)
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
  container?.dispose()
  container = null
})
