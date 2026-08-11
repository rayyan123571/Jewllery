import { ipcMain } from 'electron'
import {
  PURITIES,
  formatPurity,
  toPublicUser,
  type PublicUser,
  type User,
} from '@jewellery/domain'
import {
  IPC,
  type BackupStatusDto,
  type BootstrapDto,
  type LoginRequest,
  type LoginResponse,
  type RateDto,
  type UserDto,
} from '../shared/ipc.js'
import type { Container } from './container.js'
import type { Session } from './session.js'

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

export type { Session } from './session.js'

export function registerIpcHandlers(
  container: Container,
  session: Session,
  onQuit: () => void,
): void {
  /**
   * Every purity the shop deals in, whether or not it has a rate today.
   *
   * A purity with no rate used to be dropped from this list entirely, so the
   * rate card silently showed three of four and nothing said 18K existed. It
   * now crosses with `ratePerTolaPaisa: null` and is rendered as UNSET — never
   * as zero, which would be a price (DECISIONS §7), and never as absent, which
   * would hide a purity the operator can sell in.
   */
  const ratesDto = (): RateDto[] =>
    PURITIES.map((purity) => {
      const rate = container.rates.currentRates(container.branchId)[purity]
      return {
        purity: formatPurity(purity),
        ratePerTolaPaisa: rate?.ratePerTola.paisa ?? null,
        effectiveFrom: rate?.effectiveFrom ?? null,
        // Preformatted here. The renderer displays it, never computes with it.
        display: rate ? `Rs. ${rate.ratePerTola.formatWhole()}` : null,
      }
    })

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

  const userDto = (user: PublicUser | User): UserDto => ({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  })

  ipcMain.handle(IPC.bootstrap, (): BootstrapDto => {
    const branch = container.repositories.branches.findById(container.branchId)
    return {
      branchId: container.branchId,
      branchName: branch?.name ?? 'Main Branch',
      user: session.user ? userDto(session.user) : null,
      users: container.activeUsers().map(userDto),
      rates: ratesDto(),
      backup: backupDto(),
      databaseConnected: true,
      sidebarCollapsed: container.settings.sidebarCollapsed(),
    }
  })

  /**
   * Says who is working.
   *
   * No password, by design (see RendererApi.selectUser). It refuses an id that
   * is not an ACTIVE user rather than trusting the renderer's list, because the
   * list it was drawn from could be a minute old — a user disabled in between
   * must not be selectable.
   */
  ipcMain.handle(IPC.userSelect, (_event, userId: string): LoginResponse => {
    const chosen = container.activeUsers().find((user) => user.id === userId)
    if (!chosen) {
      return { ok: false, message: 'That user no longer exists, or has been disabled.' }
    }
    session.user = toPublicUser(chosen)
    return { ok: true, user: userDto(chosen) }
  })

  ipcMain.handle(IPC.setSidebarCollapsed, (_event, collapsed: boolean): void => {
    container.settings.setSidebarCollapsed(collapsed === true)
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
}

/*
 * The financial year is gone from the status bar, and from here.
 *
 * It was a hard-coded 1 July to 30 June convention that nothing read and no
 * shop had confirmed, sitting in the one strip of the window the operator
 * checks for whether the database is connected and when the last backup ran.
 * The invoice sequence stopped being per financial year in migration 007, so
 * the last thing that actually depended on the idea went with it. When
 * reporting arrives in M8 and a year end genuinely matters, it will be a
 * setting the shop states — not a constant compiled into the shell.
 */

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
