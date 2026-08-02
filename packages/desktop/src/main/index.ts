import { BrowserWindow, app, dialog } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createContainer, type Container } from './container.js'
import { registerIpcHandlers, type Session } from './ipc.js'
import { registerWholesaleHandlers } from './wholesaleIpc.js'

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
    backgroundColor: '#1B2A4A',
    title: 'Gold Jewellery Management System',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => {
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
    // The database lives in the app's own user data directory — never on a
    // network share (docs/DECISIONS.md §5).
    container = createContainer({ dataDirectory: app.getPath('userData') })

    registerIpcHandlers(container, session, app.getVersion(), () => app.quit())
    registerWholesaleHandlers(container, session)

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
