import { ipcMain } from 'electron'
import { PURITIES, formatPurity, toPublicUser, type PublicUser } from '@jewellery/domain'
import { IPC, type BackupStatusDto, type BootstrapDto, type LoginRequest, type LoginResponse, type RateDto } from '../shared/ipc.js'
import type { Container } from './container.js'

/**
 * One handler per channel: validate, delegate, return plain data.
 *
 * No business logic lives here. Each handler translates a serializable request
 * into a call on an application service and translates the result back into
 * serializable data. Money and Weight are converted to integers and to
 * preformatted display strings at this boundary, so the renderer never performs
 * money arithmetic — that is the whole reason the calculations sit in a layer
 * the renderer cannot import.
 */

export interface Session {
  user: PublicUser | null
}

export function registerIpcHandlers(
  container: Container,
  session: Session,
  appVersion: string,
  onQuit: () => void,
): void {
  const ratesDto = (): RateDto[] => {
    const current = container.rates.currentRates(container.branchId)
    return PURITIES.flatMap((purity) => {
      const rate = current[purity]
      if (!rate) return []
      return [
        {
          purity: formatPurity(purity),
          ratePerTolaPaisa: rate.ratePerTola.paisa,
          effectiveFrom: rate.effectiveFrom,
          // Preformatted here. The renderer displays it, never computes with it.
          display: `Rs. ${rate.ratePerTola.formatWhole()}`,
        },
      ]
    })
  }

  const backupDto = (): BackupStatusDto => {
    const last = container.backups.lastGoodBackup()
    const daysSince = container.backups.daysSinceLastGoodBackup()
    return {
      lastBackupAt: last?.createdAt ?? null,
      lastBackupDisplay: last ? formatStamp(last.createdAt) : 'Never',
      daysSince,
      integrityOk: last?.integrityOk ?? false,
    }
  }

  ipcMain.handle(IPC.bootstrap, (): BootstrapDto => {
    const shop = container.repositories.shop.get()
    const branch = container.repositories.branches.findById(container.branchId)
    return {
      shop: shop
        ? { name: shop.name, ownerName: shop.ownerName, address: shop.address }
        : null,
      branchId: container.branchId,
      branchName: branch?.name ?? 'Main Branch',
      user: session.user
        ? {
            id: session.user.id,
            name: session.user.name,
            username: session.user.username,
            role: session.user.role,
            mustChangePassword: session.user.mustChangePassword,
          }
        : null,
      rates: ratesDto(),
      backup: backupDto(),
      databaseConnected: true,
      financialYear: financialYearOf(container.clock.now()),
      appVersion,
    }
  })

  ipcMain.handle(IPC.login, (_event, request: LoginRequest): LoginResponse => {
    const result = container.auth.login(request.username, request.password)
    if (!result.ok) {
      // Both failure reasons return the same shape; the message differs only
      // where it is safe for it to.
      return {
        ok: false,
        message:
          result.reason === 'ACCOUNT_DISABLED'
            ? 'This account has been disabled. Ask an administrator.'
            : 'Incorrect username or password.',
      }
    }
    session.user = result.user
    return {
      ok: true,
      user: {
        id: result.user.id,
        name: result.user.name,
        username: result.user.username,
        role: result.user.role,
        mustChangePassword: result.user.mustChangePassword,
      },
    }
  })

  ipcMain.handle(IPC.logout, (): void => {
    session.user = null
  })

  ipcMain.handle(IPC.currentRates, (): RateDto[] => ratesDto())

  ipcMain.handle(IPC.backupRun, async (): Promise<BackupStatusDto> => {
    await container.backups.backup(session.user, 'MANUAL')
    return backupDto()
  })

  ipcMain.handle(
    IPC.backupRestore,
    async (_event, filePath: string): Promise<BackupStatusDto> => {
      if (!session.user) throw new Error('Sign in before restoring a backup.')
      await container.backups.restore(session.user, filePath)
      return backupDto()
    },
  )

  ipcMain.handle(IPC.quit, (): void => onQuit())

  // Referenced so the unused-import rule stays meaningful if handlers change.
  void toPublicUser
}

/**
 * The financial year shown in the status bar.
 *
 * Runs 1 July to 30 June, matching the mockup's "01-07-2026 To 30-06-2027".
 * This is a display convention for now; when reporting arrives in M8 it will
 * need to be a configurable setting rather than a constant, because not every
 * shop uses the same year end.
 */
export function financialYearOf(now: Date): string {
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  return `01-07-${year} To 30-06-${year + 1}`
}

function formatStamp(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const hours = date.getHours() % 12 || 12
  const meridiem = date.getHours() < 12 ? 'AM' : 'PM'
  return (
    `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ` +
    `${pad(hours)}:${pad(date.getMinutes())} ${meridiem}`
  )
}
