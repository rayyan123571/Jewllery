import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  IPC_M2,
  type BackupStatusDto,
  type BootstrapDto,
  type LedgerRowDto,
  type LoginRequest,
  type LoginResponse,
  type NewPartyDto,
  type PartyBalanceDto,
  type PartyDto,
  type PostIssueRequest,
  type PostResult,
  type PreviewDto,
  type RateDto,
  type RendererApi,
  type SetRateRequest,
  type SettleRequest,
} from '../shared/ipc.js'

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

  searchParties: (query: string) =>
    ipcRenderer.invoke(IPC_M2.partySearch, query) as Promise<readonly PartyDto[]>,
  createParty: (party: NewPartyDto) =>
    ipcRenderer.invoke(IPC_M2.partyCreate, party) as ReturnType<RendererApi['createParty']>,
  partyBalance: (partyId: string) =>
    ipcRenderer.invoke(IPC_M2.partyGet, partyId) as Promise<PartyBalanceDto | null>,
  rateFor: (date: string) =>
    ipcRenderer.invoke(IPC_M2.wholesaleRateFor, date) as ReturnType<RendererApi['rateFor']>,
  nextInvoiceNo: () => ipcRenderer.invoke(IPC_M2.wholesaleNextInvoice) as Promise<string>,
  previewWholesale: (request: PostIssueRequest) =>
    ipcRenderer.invoke(IPC_M2.wholesalePreview, request) as Promise<PreviewDto>,
  postIssue: (request: PostIssueRequest) =>
    ipcRenderer.invoke(IPC_M2.wholesalePostIssue, request) as Promise<PostResult>,
  settle: (request: SettleRequest) =>
    ipcRenderer.invoke(IPC_M2.wholesaleSettle, request) as Promise<PostResult>,
  partyLedger: (partyId: string) =>
    ipcRenderer.invoke(IPC_M2.wholesaleLedger, partyId) as Promise<readonly LedgerRowDto[]>,
  setRate: (request: SetRateRequest) =>
    ipcRenderer.invoke(IPC_M2.rateSet, request) as ReturnType<RendererApi['setRate']>,
}

contextBridge.exposeInMainWorld('api', api)
