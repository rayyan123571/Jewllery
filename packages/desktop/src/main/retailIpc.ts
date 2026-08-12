import { ipcMain, shell } from 'electron'
import { Settings } from '@jewellery/application'
import { IPC_RETAIL } from '../shared/ipc.js'
import type {
  NewCustomerDto,
  RetailBillCalculateRequest,
  RetailBillDraftDto,
  RetailCalculateRequest,
  RetailDraftSaveRequest,
  RetailListRequest,
  RetailLoadRequest,
  RetailPostRequest,
  WastageRuleChoice,
} from '../shared/ipc.js'
import type { Container } from './container.js'
import type { Session } from './session.js'
import {
  checkExternalUrl,
  customerCreate,
  customerSearch,
  messageOf,
  retailBillCalculate,
  retailBillNextNo,
  retailBillReceipt,
  retailBillSave,
  retailCalculate,
  retailDraftDiscard,
  retailDraftFind,
  retailDraftSave,
  retailHold,
  retailList,
  retailLoad,
  retailNextInvoiceNo,
  retailReceipt,
  retailRounding,
  retailRoundingSet,
  retailSave,
  retailVoid,
  retailWastageRule,
  retailWastageRuleSet,
  type RetailHandlerDeps,
} from './retailHandlers.js'

/**
 * One handler per retail channel, and nothing else.
 *
 * Every body here is a single call into `retailHandlers.ts`, which is where the
 * logic lives and where it is tested. This file exists only because
 * `ipcMain.handle` needs an Electron process, and a function that needs an
 * Electron process cannot be exercised by `npm run test` — so the two are kept
 * apart rather than the tests being given up.
 *
 * Follows `wholesaleIpc.ts` in every other respect: the renderer gets plain,
 * preformatted, serializable data; nothing throws across the boundary; and no
 * handler performs a calculation of its own.
 */
export function registerRetailHandlers(container: Container, session: Session): void {
  const deps: RetailHandlerDeps = {
    branchId: container.branchId,
    retail: container.retail,
    customers: container.retailCustomers,
    settings: new Settings(container.repositories.settings),
    shopProfile: () => container.repositories.shop.get(),
    session,
  }

  ipcMain.handle(IPC_RETAIL.calculate, (_event, request: RetailCalculateRequest) =>
    retailCalculate(deps, request),
  )

  ipcMain.handle(IPC_RETAIL.save, (_event, request: RetailPostRequest) =>
    retailSave(deps, request),
  )

  ipcMain.handle(IPC_RETAIL.hold, (_event, request: RetailPostRequest) =>
    retailHold(deps, request),
  )

  ipcMain.handle(IPC_RETAIL.load, (_event, reference: RetailLoadRequest) =>
    retailLoad(deps, reference),
  )

  ipcMain.handle(IPC_RETAIL.list, (_event, filter: RetailListRequest) =>
    retailList(deps, filter),
  )

  ipcMain.handle(IPC_RETAIL.void, (_event, saleId: string, reason: string) =>
    retailVoid(deps, saleId, reason),
  )

  ipcMain.handle(IPC_RETAIL.nextInvoiceNo, () => retailNextInvoiceNo(deps))

  ipcMain.handle(IPC_RETAIL.receipt, (_event, saleId: string) => retailReceipt(deps, saleId))

  ipcMain.handle(IPC_RETAIL.customerSearch, (_event, query: string) =>
    customerSearch(deps, query),
  )

  ipcMain.handle(IPC_RETAIL.customerCreate, (_event, input: NewCustomerDto) =>
    customerCreate(deps, input),
  )

  ipcMain.handle(IPC_RETAIL.wastageRule, (_event, selection: WastageRuleChoice | null) =>
    retailWastageRule(deps, selection),
  )

  ipcMain.handle(IPC_RETAIL.wastageRuleSet, (_event, rule: WastageRuleChoice) =>
    retailWastageRuleSet(deps, rule),
  )

  ipcMain.handle(IPC_RETAIL.billCalculate, (_event, request: RetailBillCalculateRequest) =>
    retailBillCalculate(deps, request),
  )

  ipcMain.handle(IPC_RETAIL.billSave, (_event, request: { draft: RetailBillDraftDto }) =>
    retailBillSave(deps, request),
  )

  ipcMain.handle(IPC_RETAIL.billNextNo, () => retailBillNextNo(deps))

  ipcMain.handle(IPC_RETAIL.billReceipt, (_event, billId: string) =>
    retailBillReceipt(deps, billId),
  )

  ipcMain.handle(IPC_RETAIL.draftSave, (_event, request: RetailDraftSaveRequest) =>
    retailDraftSave(deps, request),
  )

  ipcMain.handle(IPC_RETAIL.draftFind, () => retailDraftFind(deps))

  ipcMain.handle(IPC_RETAIL.draftDiscard, () => retailDraftDiscard(deps))

  ipcMain.handle(IPC_RETAIL.rounding, () => retailRounding(deps))

  ipcMain.handle(IPC_RETAIL.roundingSet, (_event, step: number) =>
    retailRoundingSet(deps, step),
  )

  /**
   * The one link that leaves the application.
   *
   * The URL is checked against an allowlist BEFORE it reaches the operating
   * system, in `checkExternalUrl` — which lives with the other handlers so it is
   * tested with no window. Nothing is fetched here; the app stays offline.
   */
  ipcMain.handle(IPC_RETAIL.openExternal, async (_event, url: string) => {
    const allowed = checkExternalUrl(url)
    if (!allowed.ok) return allowed
    try {
      await shell.openExternal(url)
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, message: messageOf(error) }
    }
  })
}
