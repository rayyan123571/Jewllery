import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  IPC_M2,
  IPC_RETAIL,
  type BackupStatusDto,
  type BootstrapDto,
  type CustomerDto,
  type LedgerRowDto,
  type LoginRequest,
  type LoginResponse,
  type NewCustomerDto,
  type NewPartyDto,
  type PartyBalanceDto,
  type PartyDto,
  type PostIssueRequest,
  type PostResult,
  type PreviewDto,
  type RateDto,
  type RendererApi,
  type RetailCalculateRequest,
  type RetailCalculationDto,
  type RetailListRequest,
  type RetailLoadRequest,
  type RetailPostRequest,
  type RetailPostResult,
  type RetailSaleDto,
  type RetailRoundingDto,
  type RetailSaleSummaryDto,
  type SalesmanDto,
  type SetRateRequest,
  type SettleRequest,
  type WastageRuleChoice,
  type WastageRuleDto,
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
  selectUser: (userId: string) =>
    ipcRenderer.invoke(IPC.userSelect, userId) as Promise<LoginResponse>,
  setSidebarCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke(IPC.setSidebarCollapsed, collapsed) as Promise<void>,
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
  rateHistory: () =>
    ipcRenderer.invoke(IPC_M2.rateHistory) as ReturnType<RendererApi['rateHistory']>,
  changePassword: (current: string, next: string) =>
    ipcRenderer.invoke(IPC_M2.changePassword, current, next) as ReturnType<
      RendererApi['changePassword']
    >,

  // M5 — Sale (Retail). Every one of these forwards and nothing else: the
  // arithmetic, the validation and the formatting all happen on the far side.
  retailCalculate: (request: RetailCalculateRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.calculate, request) as Promise<RetailCalculationDto>,
  retailSave: (request: RetailPostRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.save, request) as Promise<RetailPostResult>,
  retailHold: (request: RetailPostRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.hold, request) as Promise<RetailPostResult>,
  retailLoad: (reference: RetailLoadRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.load, reference) as Promise<RetailSaleDto | null>,
  retailList: (filter: RetailListRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.list, filter) as Promise<readonly RetailSaleSummaryDto[]>,
  retailVoid: (saleId: string, reason: string) =>
    ipcRenderer.invoke(IPC_RETAIL.void, saleId, reason) as ReturnType<
      RendererApi['retailVoid']
    >,
  retailNextInvoiceNo: () =>
    ipcRenderer.invoke(IPC_RETAIL.nextInvoiceNo) as Promise<string>,
  retailReceipt: (saleId: string) =>
    ipcRenderer.invoke(IPC_RETAIL.receipt, saleId) as Promise<string | null>,
  searchCustomers: (query: string) =>
    ipcRenderer.invoke(IPC_RETAIL.customerSearch, query) as Promise<readonly CustomerDto[]>,
  createCustomer: (input: NewCustomerDto) =>
    ipcRenderer.invoke(IPC_RETAIL.customerCreate, input) as ReturnType<
      RendererApi['createCustomer']
    >,
  listSalesmen: () =>
    ipcRenderer.invoke(IPC_RETAIL.salesmenList) as Promise<readonly SalesmanDto[]>,
  retailWastageRule: (selection: WastageRuleChoice | null) =>
    ipcRenderer.invoke(IPC_RETAIL.wastageRule, selection) as Promise<WastageRuleDto>,
  setRetailWastageRule: (rule: WastageRuleChoice) =>
    ipcRenderer.invoke(IPC_RETAIL.wastageRuleSet, rule) as ReturnType<
      RendererApi['setRetailWastageRule']
    >,
  retailRounding: () =>
    ipcRenderer.invoke(IPC_RETAIL.rounding) as Promise<RetailRoundingDto>,
  setRetailRounding: (step: number) =>
    ipcRenderer.invoke(IPC_RETAIL.roundingSet, step) as ReturnType<
      RendererApi['setRetailRounding']
    >,
  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_RETAIL.openExternal, url) as ReturnType<
      RendererApi['openExternal']
    >,

  windowControls: {
    minimize: () => ipcRenderer.invoke(IPC_M2.windowMinimize) as Promise<void>,
    toggleFullscreen: () =>
      ipcRenderer.invoke(IPC_M2.windowToggleFullscreen) as Promise<boolean>,
    close: () => ipcRenderer.invoke(IPC_M2.windowClose) as Promise<void>,
    isFullscreen: () => ipcRenderer.invoke(IPC_M2.windowIsFullscreen) as Promise<boolean>,
    onFullscreenChange: (listener: (fullscreen: boolean) => void) => {
      // The listener is wrapped rather than passed through, so the renderer
      // never receives Electron's IpcRendererEvent — that object carries a
      // `sender` which would be a hole straight back out of the sandbox.
      const handler = (_event: unknown, fullscreen: boolean): void => listener(fullscreen)
      ipcRenderer.on(IPC_M2.windowFullscreenChanged, handler)
      return () => ipcRenderer.removeListener(IPC_M2.windowFullscreenChanged, handler)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
