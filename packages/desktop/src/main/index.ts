import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { createContainer, type Container } from './container.js'
import { registerIpcHandlers, type Session } from './ipc.js'

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
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../../dist/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  // The database lives in the app's own user data directory — never on a
  // network share (docs/DECISIONS.md §5).
  container = createContainer({ dataDirectory: app.getPath('userData') })

  registerIpcHandlers(container, session, app.getVersion(), () => app.quit())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// Close the connection cleanly so the WAL is folded back into the .sqlite file
// and the database is self-contained for anyone copying it.
app.on('will-quit', () => {
  container?.dispose()
  container = null
})
