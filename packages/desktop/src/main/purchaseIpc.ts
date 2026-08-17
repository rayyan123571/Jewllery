import { ipcMain } from 'electron'
import { Settings } from '@jewellery/application'
import {
  IPC_PURCHASE,
  IPC_STOCK,
  type SavePurchaseRequest,
  type StockAdjustRequest,
  type StockLedgerRequest,
} from '../shared/ipc.js'
import type { Container } from './container.js'
import type { Session } from './session.js'
import {
  purchaseCancel,
  purchaseLoadAsDraft,
  purchaseNeighbours,
  purchaseNextInvoiceNo,
  purchasePreview,
  purchaseRateFor,
  purchaseSave,
  type PurchaseHandlerDeps,
} from './purchaseHandlers.js'
import { stockAdjust, stockLedger, stockSummary, type StockHandlerDeps } from './stockHandlers.js'

/**
 * Registration only. Every body is a one-line delegate into
 * `purchaseHandlers.ts` / `stockHandlers.ts`, which are plain functions over a
 * dependency bag and therefore testable with no Electron process — the same
 * split the retail and wholesale handlers live under (DECISIONS §9).
 */
export function registerPurchaseHandlers(container: Container, session: Session): void {
  const settings = new Settings(container.repositories.settings)

  const deps: PurchaseHandlerDeps = {
    branchId: container.branchId,
    purchase: container.purchase,
    parties: container.repositories.parties,
    settings,
    session,
  }

  const stockDeps: StockHandlerDeps = {
    branchId: container.branchId,
    stock: container.stock,
    purchases: container.repositories.purchases,
    settings,
    session,
  }

  ipcMain.handle(IPC_PURCHASE.nextInvoiceNo, () => purchaseNextInvoiceNo(deps))
  ipcMain.handle(IPC_PURCHASE.preview, (_e, request: SavePurchaseRequest) =>
    purchasePreview(deps, request),
  )
  ipcMain.handle(IPC_PURCHASE.save, (_e, request: SavePurchaseRequest) =>
    purchaseSave(deps, request, 'posted'),
  )
  ipcMain.handle(IPC_PURCHASE.hold, (_e, request: SavePurchaseRequest) =>
    purchaseSave(deps, request, 'held'),
  )
  ipcMain.handle(IPC_PURCHASE.cancel, (_e, entryId: string, reason: string) =>
    purchaseCancel(deps, entryId, reason),
  )
  ipcMain.handle(
    IPC_PURCHASE.neighbours,
    (_e, current: number | null, includeCancelled: boolean) =>
      purchaseNeighbours(deps, current, includeCancelled),
  )
  ipcMain.handle(IPC_PURCHASE.loadAsDraft, (_e, invoiceNumber: number) =>
    purchaseLoadAsDraft(deps, invoiceNumber),
  )
  ipcMain.handle(IPC_PURCHASE.rateFor, (_e, date: string) => purchaseRateFor(deps, date))

  ipcMain.handle(IPC_STOCK.summary, () => stockSummary(stockDeps))
  ipcMain.handle(IPC_STOCK.ledger, (_e, request: StockLedgerRequest) =>
    stockLedger(stockDeps, request),
  )
  ipcMain.handle(IPC_STOCK.adjust, (_e, request: StockAdjustRequest) =>
    stockAdjust(stockDeps, request),
  )
}
