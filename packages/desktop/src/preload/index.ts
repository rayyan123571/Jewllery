import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BackupStatusDto, type BootstrapDto, type LoginRequest, type LoginResponse, type RateDto, type RendererApi } from '../shared/ipc.js'

/**
 * The bridge between the sandboxed renderer and the main process.
 *
 * This is a narrow, explicit surface and nothing more. It holds no logic, makes
 * no decision and reaches no database — it forwards typed calls across the gap.
 *
 * The renderer runs with contextIsolation on, nodeIntegration off and sandbox
 * on, so it has no `require`, no `fs` and no way to reach a file. The only thing
 * it can call is what is listed here. That is what makes "a screen cannot open a
 * database connection" a runtime guarantee enforced by Chromium, rather than a
 * lint rule someone can disable.
 */

const api: RendererApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap) as Promise<BootstrapDto>,
  login: (request: LoginRequest) =>
    ipcRenderer.invoke(IPC.login, request) as Promise<LoginResponse>,
  logout: () => ipcRenderer.invoke(IPC.logout) as Promise<void>,
  currentRates: () => ipcRenderer.invoke(IPC.currentRates) as Promise<readonly RateDto[]>,
  runBackup: () => ipcRenderer.invoke(IPC.backupRun) as Promise<BackupStatusDto>,
  restoreBackup: (filePath: string) =>
    ipcRenderer.invoke(IPC.backupRestore, filePath) as Promise<BackupStatusDto>,
  quit: () => ipcRenderer.invoke(IPC.quit) as Promise<void>,
}

contextBridge.exposeInMainWorld('api', api)
