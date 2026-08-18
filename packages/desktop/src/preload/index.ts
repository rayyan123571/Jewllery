import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  IPC_INVENTORY,
  IPC_M2,
  IPC_PIECES,
  IPC_PURCHASE,
  IPC_RETAIL,
  IPC_STOCK,
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
  type RetailBillCalculateRequest,
  type RetailBillCalculationDto,
  type RetailBillDraftDto,
  type RetailBillPostResult,
  type RetailDraftFoundDto,
  type RetailDraftSaveRequest,
  type RetailRoundingDto,
  type RetailSaleSummaryDto,
  type SetRateRequest,
  type SettleRequest,
  type WastageRuleChoice,
  type WastageRuleDto,
  type CategoryNodeDto,
  type DeductionForRequest,
  type InventorySetupResult,
  type InventorySummaryDto,
  type ItemDto,
  type LiveGoldDto,
  type LocationDto,
  type OpeningPostRequest,
  type OpeningPostResult,
  type OpeningPreviewDto,
  type PieceDto,
  type PieceHistoryDto,
  type PieceListRequest,
  type SaveItemRequest,
  type SaveItemResult,
  type PrintSettingsDto,
  type PurchaseEntryDto,
  type PurchaseNeighboursDto,
  type PurchasePreviewDto,
  type PurchaseSaveResult,
  type SavePurchaseRequest,
  type ShopProfileDto,
  type StockAdjustRequest,
  type StockAdjustResult,
  type StockLedgerRequest,
  type StockLedgerRowDto,
  type StockSummaryDto,
  type WholesaleEntryDto,
  type WholesaleNeighboursDto,
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
  wholesaleNeighbours: (current: number | null, includeReversed: boolean) =>
    ipcRenderer.invoke(
      IPC_M2.wholesaleNeighbours,
      current,
      includeReversed,
    ) as Promise<WholesaleNeighboursDto>,
  wholesaleLoadAsDraft: (invoiceNumber: number) =>
    ipcRenderer.invoke(
      IPC_M2.wholesaleLoadAsDraft,
      invoiceNumber,
    ) as Promise<WholesaleEntryDto | null>,
  setRate: (request: SetRateRequest) =>
    ipcRenderer.invoke(IPC_M2.rateSet, request) as ReturnType<RendererApi['setRate']>,
  rateHistory: () =>
    ipcRenderer.invoke(IPC_M2.rateHistory) as ReturnType<RendererApi['rateHistory']>,
  changePassword: (current: string, next: string) =>
    ipcRenderer.invoke(IPC_M2.changePassword, current, next) as ReturnType<
      RendererApi['changePassword']
    >,

  // M6 — Purchase. Forwarding only, like everything else here.
  purchaseNextInvoiceNo: () =>
    ipcRenderer.invoke(IPC_PURCHASE.nextInvoiceNo) as Promise<string>,
  purchasePreview: (request: SavePurchaseRequest) =>
    ipcRenderer.invoke(IPC_PURCHASE.preview, request) as Promise<PurchasePreviewDto>,
  purchaseSave: (request: SavePurchaseRequest) =>
    ipcRenderer.invoke(IPC_PURCHASE.save, request) as Promise<PurchaseSaveResult>,
  purchaseHold: (request: SavePurchaseRequest) =>
    ipcRenderer.invoke(IPC_PURCHASE.hold, request) as Promise<PurchaseSaveResult>,
  purchaseCancel: (entryId: string, reason: string) =>
    ipcRenderer.invoke(IPC_PURCHASE.cancel, entryId, reason) as ReturnType<
      RendererApi['purchaseCancel']
    >,
  purchaseNeighbours: (current: number | null, includeCancelled: boolean) =>
    ipcRenderer.invoke(
      IPC_PURCHASE.neighbours,
      current,
      includeCancelled,
    ) as Promise<PurchaseNeighboursDto>,
  purchaseLoadAsDraft: (invoiceNumber: number) =>
    ipcRenderer.invoke(
      IPC_PURCHASE.loadAsDraft,
      invoiceNumber,
    ) as Promise<PurchaseEntryDto | null>,
  purchaseRateFor: (date: string) =>
    ipcRenderer.invoke(IPC_PURCHASE.rateFor, date) as ReturnType<
      RendererApi['purchaseRateFor']
    >,

  // M4 — Stock.
  stockSummary: () => ipcRenderer.invoke(IPC_STOCK.summary) as Promise<StockSummaryDto>,
  stockLedger: (filter: StockLedgerRequest) =>
    ipcRenderer.invoke(IPC_STOCK.ledger, filter) as Promise<readonly StockLedgerRowDto[]>,
  stockAdjust: (request: StockAdjustRequest) =>
    ipcRenderer.invoke(IPC_STOCK.adjust, request) as Promise<StockAdjustResult>,

  // M4 stage 1 — the item master, categories and locations.
  inventoryItems: (query: string, includeInactive: boolean) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.itemSearch,
      query,
      includeInactive,
    ) as Promise<readonly ItemDto[]>,
  inventoryItemCreate: (request: SaveItemRequest) =>
    ipcRenderer.invoke(IPC_INVENTORY.itemCreate, request) as Promise<SaveItemResult>,
  inventoryItemUpdate: (itemId: string, request: SaveItemRequest) =>
    ipcRenderer.invoke(IPC_INVENTORY.itemUpdate, itemId, request) as Promise<SaveItemResult>,
  inventoryItemSetActive: (itemId: string, isActive: boolean) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.itemSetActive,
      itemId,
      isActive,
    ) as Promise<InventorySetupResult>,
  inventoryCategoryTree: (includeInactive: boolean) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.categoryTree,
      includeInactive,
    ) as Promise<readonly CategoryNodeDto[]>,
  inventoryCategoryCreate: (parentId: string | null, name: string) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.categoryCreate,
      parentId,
      name,
    ) as Promise<InventorySetupResult>,
  inventoryCategoryRename: (categoryId: string, name: string) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.categoryRename,
      categoryId,
      name,
    ) as Promise<InventorySetupResult>,
  inventoryCategorySetActive: (categoryId: string, isActive: boolean) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.categorySetActive,
      categoryId,
      isActive,
    ) as Promise<InventorySetupResult>,
  inventoryLocations: (includeInactive: boolean) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.locationList,
      includeInactive,
    ) as Promise<readonly LocationDto[]>,
  inventoryLocationCreate: (name: string) =>
    ipcRenderer.invoke(IPC_INVENTORY.locationCreate, name) as Promise<InventorySetupResult>,
  inventoryLocationRename: (locationId: string, name: string) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.locationRename,
      locationId,
      name,
    ) as Promise<InventorySetupResult>,
  inventoryLocationSetActive: (locationId: string, isActive: boolean) =>
    ipcRenderer.invoke(
      IPC_INVENTORY.locationSetActive,
      locationId,
      isActive,
    ) as Promise<InventorySetupResult>,

  // M4 stage 2 — the pieces.
  inventorySummary: (groupBy: string) =>
    ipcRenderer.invoke(IPC_PIECES.summary, groupBy) as Promise<InventorySummaryDto>,
  pieceList: (filter: PieceListRequest) =>
    ipcRenderer.invoke(IPC_PIECES.list, filter) as Promise<readonly PieceDto[]>,
  pieceHistory: (pieceId: string) =>
    ipcRenderer.invoke(IPC_PIECES.history, pieceId) as Promise<PieceHistoryDto | null>,
  pieceMove: (pieceId: string, locationId: string | null) =>
    ipcRenderer.invoke(
      IPC_PIECES.move,
      pieceId,
      locationId,
    ) as Promise<InventorySetupResult>,
  openingNextTag: () => ipcRenderer.invoke(IPC_PIECES.nextTag) as Promise<string>,
  openingPreview: (request: OpeningPostRequest) =>
    ipcRenderer.invoke(IPC_PIECES.openingPreview, request) as Promise<OpeningPreviewDto>,
  openingPost: (request: OpeningPostRequest) =>
    ipcRenderer.invoke(IPC_PIECES.openingPost, request) as Promise<OpeningPostResult>,

  // M5 — Sale (Retail). Every one of these forwards and nothing else: the
  // arithmetic, the validation and the formatting all happen on the far side.
  retailCalculate: (request: RetailCalculateRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.calculate, request) as Promise<RetailCalculationDto>,
  retailDeductionFor: (request: DeductionForRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.deductionFor, request) as ReturnType<
      RendererApi['retailDeductionFor']
    >,
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
  retailNeighbours: (current: number | null, includeVoid: boolean) =>
    ipcRenderer.invoke(IPC_RETAIL.neighbours, current, includeVoid) as ReturnType<
      RendererApi['retailNeighbours']
    >,
  retailLoadAsDraft: (invoiceNumber: number) =>
    ipcRenderer.invoke(IPC_RETAIL.loadAsDraft, invoiceNumber) as ReturnType<
      RendererApi['retailLoadAsDraft']
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
  retailWastageRule: (selection: WastageRuleChoice | null) =>
    ipcRenderer.invoke(IPC_RETAIL.wastageRule, selection) as Promise<WastageRuleDto>,
  setRetailWastageRule: (rule: WastageRuleChoice) =>
    ipcRenderer.invoke(IPC_RETAIL.wastageRuleSet, rule) as ReturnType<
      RendererApi['setRetailWastageRule']
    >,
  retailBillCalculate: (request: RetailBillCalculateRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.billCalculate, request) as Promise<RetailBillCalculationDto>,
  retailBillSave: (request: { draft: RetailBillDraftDto }) =>
    ipcRenderer.invoke(IPC_RETAIL.billSave, request) as Promise<RetailBillPostResult>,
  retailBillNextNo: () => ipcRenderer.invoke(IPC_RETAIL.billNextNo) as Promise<string>,
  retailBillReceipt: (billId: string) =>
    ipcRenderer.invoke(IPC_RETAIL.billReceipt, billId) as Promise<string | null>,
  retailDraftSave: (request: RetailDraftSaveRequest) =>
    ipcRenderer.invoke(IPC_RETAIL.draftSave, request) as ReturnType<
      RendererApi['retailDraftSave']
    >,
  retailDraftFind: () =>
    ipcRenderer.invoke(IPC_RETAIL.draftFind) as Promise<RetailDraftFoundDto | null>,
  retailDraftDiscard: () =>
    ipcRenderer.invoke(IPC_RETAIL.draftDiscard) as ReturnType<
      RendererApi['retailDraftDiscard']
    >,
  retailRounding: () =>
    ipcRenderer.invoke(IPC_RETAIL.rounding) as Promise<RetailRoundingDto>,
  setRetailRounding: (step: number) =>
    ipcRenderer.invoke(IPC_RETAIL.roundingSet, step) as ReturnType<
      RendererApi['setRetailRounding']
    >,
  shopProfile: () =>
    ipcRenderer.invoke(IPC_RETAIL.shopProfile) as Promise<ShopProfileDto>,
  setShopProfile: (profile: ShopProfileDto) =>
    ipcRenderer.invoke(IPC_RETAIL.shopProfileSet, profile) as ReturnType<
      RendererApi['setShopProfile']
    >,
  printSettings: () =>
    ipcRenderer.invoke(IPC_RETAIL.printSettings) as Promise<PrintSettingsDto>,
  setPrintSettings: (changes: Partial<PrintSettingsDto>) =>
    ipcRenderer.invoke(IPC_RETAIL.printSettingsSet, changes) as ReturnType<
      RendererApi['setPrintSettings']
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

  liveGold: {
    get: () => ipcRenderer.invoke(IPC_M2.liveGoldGet) as Promise<LiveGoldDto>,
    onUpdate: (listener: (data: LiveGoldDto) => void) => {
      const handler = (_event: unknown, data: LiveGoldDto): void => listener(data)
      ipcRenderer.on(IPC_M2.liveGoldPush, handler)
      return () => ipcRenderer.removeListener(IPC_M2.liveGoldPush, handler)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
