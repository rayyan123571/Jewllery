import { ipcMain } from 'electron'
import {
  IPC_INVENTORY,
  IPC_PIECES,
  type OpeningPostRequest,
  type PieceListRequest,
  type SaveItemRequest,
} from '../shared/ipc.js'
import type { Container } from './container.js'
import type { Session } from './session.js'
import {
  inventoryCategoryCreate,
  inventoryCategoryRename,
  inventoryCategorySetActive,
  inventoryCategoryTree,
  inventoryItemCreate,
  inventoryItems,
  inventoryItemSetActive,
  inventoryItemUpdate,
  inventoryLocationCreate,
  inventoryLocationRename,
  inventoryLocations,
  inventoryLocationSetActive,
  type InventoryHandlerDeps,
} from './inventoryHandlers.js'
import {
  inventorySummary,
  openingNextTag,
  openingPost,
  openingPreview,
  pieceHistory,
  pieceList,
  pieceMove,
  type PieceHandlerDeps,
} from './pieceHandlers.js'

/**
 * Registration only. Every body is a one-line delegate into
 * `inventoryHandlers.ts`, which is plain functions over a dependency bag and
 * therefore testable with no Electron process (DECISIONS §9).
 */
export function registerInventoryHandlers(container: Container, session: Session): void {
  const deps: InventoryHandlerDeps = {
    branchId: container.branchId,
    inventory: container.inventory,
    parties: container.repositories.parties,
    session,
  }

  ipcMain.handle(IPC_INVENTORY.itemSearch, (_e, query: string, includeInactive: boolean) =>
    inventoryItems(deps, query, includeInactive),
  )
  ipcMain.handle(IPC_INVENTORY.itemCreate, (_e, request: SaveItemRequest) =>
    inventoryItemCreate(deps, request),
  )
  ipcMain.handle(IPC_INVENTORY.itemUpdate, (_e, itemId: string, request: SaveItemRequest) =>
    inventoryItemUpdate(deps, itemId, request),
  )
  ipcMain.handle(IPC_INVENTORY.itemSetActive, (_e, itemId: string, isActive: boolean) =>
    inventoryItemSetActive(deps, itemId, isActive),
  )
  ipcMain.handle(IPC_INVENTORY.categoryTree, (_e, includeInactive: boolean) =>
    inventoryCategoryTree(deps, includeInactive),
  )
  ipcMain.handle(IPC_INVENTORY.categoryCreate, (_e, parentId: string | null, name: string) =>
    inventoryCategoryCreate(deps, parentId, name),
  )
  ipcMain.handle(IPC_INVENTORY.categoryRename, (_e, categoryId: string, name: string) =>
    inventoryCategoryRename(deps, categoryId, name),
  )
  ipcMain.handle(IPC_INVENTORY.categorySetActive, (_e, categoryId: string, isActive: boolean) =>
    inventoryCategorySetActive(deps, categoryId, isActive),
  )
  ipcMain.handle(IPC_INVENTORY.locationList, (_e, includeInactive: boolean) =>
    inventoryLocations(deps, includeInactive),
  )
  ipcMain.handle(IPC_INVENTORY.locationCreate, (_e, name: string) =>
    inventoryLocationCreate(deps, name),
  )
  ipcMain.handle(IPC_INVENTORY.locationRename, (_e, locationId: string, name: string) =>
    inventoryLocationRename(deps, locationId, name),
  )
  ipcMain.handle(IPC_INVENTORY.locationSetActive, (_e, locationId: string, isActive: boolean) =>
    inventoryLocationSetActive(deps, locationId, isActive),
  )

  const pieceDeps: PieceHandlerDeps = {
    branchId: container.branchId,
    pieces: container.pieces,
    items: container.repositories.items,
    locations: container.repositories.locations,
    session,
  }

  ipcMain.handle(IPC_PIECES.summary, (_e, groupBy: string) =>
    inventorySummary(pieceDeps, groupBy),
  )
  ipcMain.handle(IPC_PIECES.list, (_e, request: PieceListRequest) =>
    pieceList(pieceDeps, request),
  )
  ipcMain.handle(IPC_PIECES.history, (_e, pieceId: string) => pieceHistory(pieceDeps, pieceId))
  ipcMain.handle(IPC_PIECES.move, (_e, pieceId: string, locationId: string | null) =>
    pieceMove(pieceDeps, pieceId, locationId),
  )
  ipcMain.handle(IPC_PIECES.nextTag, () => openingNextTag(pieceDeps))
  ipcMain.handle(IPC_PIECES.openingPreview, (_e, request: OpeningPostRequest) =>
    openingPreview(pieceDeps, request),
  )
  ipcMain.handle(IPC_PIECES.openingPost, (_e, request: OpeningPostRequest) =>
    openingPost(pieceDeps, request),
  )
}
