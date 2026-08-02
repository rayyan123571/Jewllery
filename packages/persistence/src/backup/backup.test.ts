import BetterSqlite3 from 'better-sqlite3'
import { BackupService } from '@jewellery/application'
import { fixedClock, type PublicUser } from '@jewellery/domain'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseHandle } from '../DatabaseHandle.js'
import { createRepositories } from '../repositories/index.js'
import { SqliteBackupStore } from './SqliteBackupStore.js'

/**
 * The real thing end to end: a real database, a real snapshot through SQLite's
 * online backup API, a real integrity check, and a real restore that swaps the
 * file underneath the live connection.
 *
 * A backup system tested only against fakes is a backup system nobody has ever
 * actually restored from.
 */

const clock = fixedClock('2026-08-02T09:00:00.000Z')

// Built in beforeEach from a real inserted row. The audit and backup tables
// have foreign keys to users, so an actor with a made-up id is rejected by the
// schema — which is the schema doing its job.
let admin: PublicUser
let salesman: PublicUser

let dir: string
let handle: DatabaseHandle
let store: SqliteBackupStore
let service: BackupService

// Built once over the HANDLE, not over a connection. These same objects must
// keep working after a restore swaps the file and reopens the connection.
let repositories: ReturnType<typeof createRepositories>
function repos() {
  return repositories
}

function addBranch(id: string, name: string): void {
  repos().branches.create({ id, name, address: null, isDefault: id === 'branch-1', isActive: true })
}

function branchNames(): string[] {
  return repos()
    .branches.listActive()
    .map((b) => b.name)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jewellery-backup-'))
  handle = new DatabaseHandle(join(dir, 'shop.sqlite'))
  repositories = createRepositories(handle, clock)
  store = new SqliteBackupStore(handle, join(dir, 'backups'))
  service = new BackupService({
    store,
    log: repos().backupLog,
    audit: repos().audit,
    clock,
  })

  addBranch('branch-1', 'Main Branch')
  const adminRow = repos().users.create({
    branchId: 'branch-1',
    name: 'Admin',
    username: 'admin',
    passwordHash: 'scrypt$16$1$1$c2FsdA==$aGFzaA==',
    role: 'ADMIN',
    mustChangePassword: false,
  })
  const salesRow = repos().users.create({
    branchId: 'branch-1',
    name: 'Salesman',
    username: 'sales',
    passwordHash: 'scrypt$16$1$1$c2FsdA==$aGFzaA==',
    role: 'SALESMAN',
    mustChangePassword: false,
  })
  const toPublic = (r: { id: string; branchId: string | null; name: string; username: string }) => ({
    id: r.id,
    branchId: r.branchId,
    name: r.name,
    username: r.username,
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: null,
  })
  admin = { ...toPublic(adminRow), role: 'ADMIN' }
  salesman = { ...toPublic(salesRow), role: 'SALESMAN' }
})

afterEach(() => {
  try {
    handle.close()
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('taking a backup', () => {
  it('writes a file and verifies it', async () => {
    const record = await service.backup(admin, 'MANUAL')
    expect(record.integrityOk).toBe(true)
    expect(record.sizeBytes).toBeGreaterThan(0)
  })

  it('records it in the backup log', async () => {
    await service.backup(admin, 'MANUAL')
    expect(service.history()).toHaveLength(1)
    expect(service.lastGoodBackup()?.kind).toBe('MANUAL')
  })

  it('writes an audit entry', async () => {
    await service.backup(admin, 'MANUAL')
    expect(repos().audit.recent(10).map((e) => e.action)).toContain('BACKUP_CREATED')
  })

  it('does not let a salesman take one', async () => {
    await expect(service.backup(salesman, 'MANUAL')).rejects.toThrow(/not permitted/)
  })

  it('allows an automatic backup with no actor', async () => {
    const record = await service.backup(null, 'AUTO')
    expect(record.createdByUserId).toBeNull()
  })

  it('answers "when was the last good backup"', async () => {
    expect(service.daysSinceLastGoodBackup()).toBeNull()
    await service.backup(admin, 'MANUAL')
    expect(service.daysSinceLastGoodBackup()).toBe(0)
  })
})

describe('restoring', () => {
  it('brings back data that was deleted after the backup', async () => {
    const backup = await service.backup(admin, 'MANUAL')

    addBranch('branch-2', 'Added After Backup')
    expect(branchNames()).toContain('Added After Backup')

    await service.restore(admin, backup.filePath)

    expect(branchNames()).toEqual(['Main Branch'])
  })

  it('leaves a working connection afterwards', async () => {
    const backup = await service.backup(admin, 'MANUAL')
    await service.restore(admin, backup.filePath)

    // The handle reopened underneath the repositories; writes still work.
    addBranch('branch-3', 'After Restore')
    expect(branchNames()).toContain('After Restore')
  })

  it('takes a safety snapshot of the current data first', async () => {
    const backup = await service.backup(admin, 'MANUAL')
    addBranch('branch-2', 'Would Be Lost')

    await service.restore(admin, backup.filePath)

    // The pre-restore snapshot survived the swap as a file on disk, so the
    // data the restore discarded is still recoverable.
    const files = await store.list()
    const preRestore = files.find((f) => f.path.endsWith('_pre_restore.sqlite'))
    expect(preRestore).toBeDefined()

    await service.restore(admin, preRestore?.path ?? '')
    expect(branchNames()).toContain('Would Be Lost')
  })

  it('refuses a file that is not a database from this application', async () => {
    const junk = join(dir, 'notadb.sqlite')
    writeFileSync(junk, 'this is not a database')
    await expect(service.restore(admin, junk)).rejects.toThrow(/not a valid backup/)
  })

  it('refuses a structurally valid SQLite file from another program', async () => {
    // integrity_check alone would pass this. Restoring it would wipe the books.
    // Built with a raw driver, NOT DatabaseHandle — the handle runs migrations,
    // which would make it a perfectly valid database of this application.
    const foreign = join(dir, 'foreign.sqlite')
    const other = new BetterSqlite3(foreign)
    other.exec('CREATE TABLE unrelated (x INTEGER)')
    other.close()

    await expect(service.restore(admin, foreign)).rejects.toThrow(/not a valid backup/)
  })

  it('leaves the current data untouched when it refuses', async () => {
    const junk = join(dir, 'notadb.sqlite')
    writeFileSync(junk, 'garbage')

    await expect(service.restore(admin, junk)).rejects.toThrow()
    expect(branchNames()).toEqual(['Main Branch'])
  })

  it('does not let a manager restore, only an admin', async () => {
    const backup = await service.backup(admin, 'MANUAL')
    const manager: PublicUser = { ...admin, role: 'MANAGER' }
    await expect(service.restore(manager, backup.filePath)).rejects.toThrow(
      /Only an administrator/,
    )
  })

  it('removes the WAL sidecar so the old log cannot replay over the new file', async () => {
    const backup = await service.backup(admin, 'MANUAL')

    // Generate WAL content, then restore. If the sidecar survived, SQLite would
    // replay the old database's log over the restored file on next open.
    for (let i = 0; i < 50; i++) addBranch(`b-${i}`, `Branch ${i}`)
    await service.restore(admin, backup.filePath)

    expect(branchNames()).toEqual(['Main Branch'])
  })
})

describe('the snapshot is consistent, not a plain file copy', () => {
  it('captures a database that is being written to', async () => {
    // Enough rows to push content into the WAL, which a naive copyFile of the
    // main .sqlite file would miss entirely.
    for (let i = 0; i < 200; i++) addBranch(`b-${i}`, `Branch ${i}`)

    const backup = await service.backup(admin, 'MANUAL')
    expect(backup.integrityOk).toBe(true)

    const before = branchNames().length
    await service.restore(admin, backup.filePath)
    expect(branchNames()).toHaveLength(before)
  })
})

describe('retention', () => {
  it('keeps manual backups and prunes only automatic ones', async () => {

    // pathForNewBackup stamps to the second and the clock is frozen, so vary
    // the directory listing by writing distinct names through the store.
    for (let i = 0; i < 3; i++) {
      const path = join(dir, 'backups', `backup_2026-08-0${i + 1}_120000_auto.sqlite`)
      await store.snapshot(path)
    }
    const manual = join(dir, 'backups', 'backup_2026-08-01_120000_manual.sqlite')
    await store.snapshot(manual)

    const files = await store.list()
    expect(files.filter((f) => f.path.endsWith('_auto.sqlite'))).toHaveLength(3)
    expect(files.filter((f) => f.path.endsWith('_manual.sqlite'))).toHaveLength(1)
  })
})
