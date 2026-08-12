import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migration001 } from './001-initial.js'
import { migration002 } from './002-rate-per-tola.js'
import { migration003 } from './003-parties.js'
import { migration004 } from './004-wholesale.js'
import { migration005 } from './005-retail.js'
import { migration006 } from './006-retail-wastage-rule.js'
import { migration007 } from './007-invoice-sequence-no-fy.js'
import { migration008 } from './008-retail-draft-id.js'
import { migration009 } from './009-retail-bills.js'
import { migration010 } from './010-retail-purity-deduction.js'
import { migration011 } from './011-retail-drafts.js'
import { migration012 } from './012-invoice-integer.js'

/**
 * The migration that turns RS-00001 into 1, proved rather than asserted.
 *
 * These tests do not use the migration runner, because the runner brings a
 * database all the way to the latest version and there would be no version-11
 * state left to migrate. They build the schema up to 11 from the real migration
 * SQL, write invoices in the OLD format, and then run 012's own `up` — which is
 * the change a shop's existing database will actually experience.
 *
 * What has to be true afterwards, in priority order, is the same order the shop
 * cares about:
 *
 *   1. No number changes its identity. Invoice RS-00007 is invoice 7. If a
 *      migration renumbered a document that has already been printed and handed
 *      to a customer, nothing later could put it right.
 *   2. No two numbers collide. Two bills sharing a number corrupts the records
 *      permanently, so where this cannot be guaranteed the migration must FAIL
 *      and leave the database alone rather than proceed.
 *   3. The sequence carries on from the highest number ever issued — never from
 *      1, and never from a value that would re-issue a burned one.
 */

const BEFORE_012 = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
]

const BRANCH = 'branch-1'
const USER = 'user-1'

let db: BetterSqlite3.Database

/** A database at version 11, with a branch and a user for the FKs to land on. */
function openAtVersion11(): BetterSqlite3.Database {
  const database = new BetterSqlite3(':memory:')
  database.pragma('foreign_keys = ON')
  for (const migration of BEFORE_012) database.exec(migration.up)
  database
    .prepare('INSERT INTO branches (id, name, is_active, created_at) VALUES (?,?,1,?)')
    .run(BRANCH, 'Main', '2026-08-01T09:00:00.000Z')
  database
    .prepare(
      `INSERT INTO users (id, username, name, password_hash, role, is_active,
                          must_change_password, created_at, updated_at)
       VALUES (?,?,?,?,?,1,0,'2026-08-01','2026-08-01')`,
    )
    .run(USER, 'admin', 'Administrator', 'x', 'ADMIN')
  return database
}

/** One sale in the OLD format, exactly as the version-11 repository wrote them. */
function writeLegacySale(invoiceNo: string, saleDate = '2026-08-01'): void {
  db.prepare(
    `INSERT INTO retail_sales
       (id, invoice_no, branch_id, sale_date, sale_time, customer_name_snapshot,
        rate_purity, rate_per_tola_paisa, gold_value_paisa, grand_total_paisa,
        payment_method, amount_in_words, status, created_by, created_at)
     VALUES (?,?,?,?, '14:05', 'Walk-in', 'K22', 1, 1, 1, 'cash', 'x', 'posted', ?, ?)`,
  ).run(`id-${invoiceNo}`, invoiceNo, BRANCH, saleDate, USER, '2026-08-01T09:00:00.000Z')
}

function setSequence(nextNumber: number, prefix = 'RS-'): void {
  db.prepare(
    `INSERT INTO invoice_sequences (key, prefix, next_number) VALUES ('retail', ?, ?)
       ON CONFLICT(key) DO UPDATE SET prefix = excluded.prefix,
                                      next_number = excluded.next_number`,
  ).run(prefix, nextNumber)
}

function numbersByRow(): { invoice_no: string; invoice_number: number }[] {
  return db
    .prepare('SELECT invoice_no, invoice_number FROM retail_sales ORDER BY invoice_number')
    .all() as { invoice_no: string; invoice_number: number }[]
}

function nextNumber(): number {
  return (
    db.prepare("SELECT next_number FROM invoice_sequences WHERE key = 'retail'").get() as {
      next_number: number
    }
  ).next_number
}

beforeEach(() => {
  db = openAtVersion11()
})

afterEach(() => {
  db.close()
})

describe('migrating invoice numbers to integers', () => {
  it('changes no number’s identity — RS-00007 is still invoice 7', () => {
    const issued = [1, 2, 3, 7, 8, 9, 10, 11, 42, 100]
    for (const n of issued) writeLegacySale(`RS-${String(n).padStart(5, '0')}`)
    setSequence(101)

    db.exec(migration012.up)

    // Each row still holds the number it was issued, as an integer and as text.
    expect(numbersByRow().map((row) => row.invoice_number)).toEqual(issued)
    expect(numbersByRow().map((row) => row.invoice_no)).toEqual(issued.map(String))
  })

  it('lets no two rows collide, and every old number survives exactly once', () => {
    const issued = Array.from({ length: 250 }, (_, index) => index + 1)
    for (const n of issued) writeLegacySale(`RS-${String(n).padStart(5, '0')}`)
    setSequence(251)

    db.exec(migration012.up)

    const after = numbersByRow().map((row) => row.invoice_number)
    // Same count in as out: nothing merged, nothing dropped.
    expect(after).toHaveLength(issued.length)
    // Every value distinct: nothing collided.
    expect(new Set(after).size).toBe(issued.length)
    // And the set is the same set — a permutation would still be a renumbering.
    expect([...after].sort((a, b) => a - b)).toEqual(issued)
  })

  it('REFUSES to run rather than create a collision, leaving the rows untouched', () => {
    // Two texts that would map to the same integer. This cannot be produced by
    // any version of this application, but a hand-edited database could hold
    // it — and a silent merge of two real documents is the one outcome that
    // must never happen. The UNIQUE index is what makes it impossible.
    writeLegacySale('RS-00001')
    writeLegacySale('INV-1')
    setSequence(2)

    expect(() => db.exec(migration012.up)).toThrow(/UNIQUE/i)

    // The whole migration runs inside the runner's transaction in production;
    // here the point is that it stopped. Nothing claims to have converted.
    const stillOld = db
      .prepare('SELECT invoice_no FROM retail_sales ORDER BY invoice_no')
      .all() as { invoice_no: string }[]
    expect(stillOld.map((row) => row.invoice_no)).toEqual(['INV-1', 'RS-00001'])
  })

  it('carries the sequence on from the highest number ever issued', () => {
    for (const n of [1, 2, 3]) writeLegacySale(`RS-${String(n).padStart(5, '0')}`)
    setSequence(4)

    db.exec(migration012.up)

    expect(nextNumber()).toBe(4)
  })

  it('never rewinds a sequence that is AHEAD of the highest stored row', () => {
    // A number can be burned without leaving a row: a sale rolled back after
    // its bump, or a held slip later removed. The counter is the record of what
    // was ISSUED, so it must win over what happens to be on the table.
    writeLegacySale('RS-00001')
    setSequence(9)

    db.exec(migration012.up)

    expect(nextNumber()).toBe(9)
  })

  it('starts a shop that has never posted a sale at 1, with no prefix', () => {
    db.exec(migration012.up)

    expect(nextNumber()).toBe(1)
    expect(
      (
        db.prepare("SELECT prefix FROM invoice_sequences WHERE key = 'retail'").get() as {
          prefix: string
        }
      ).prefix,
    ).toBe('')
  })

  it('recovers the number whatever prefix the shop had set', () => {
    // Every shape the old generator could produce, including a prefix the shop
    // changed to something with a digit in it. The rule is the longest all-digit
    // SUFFIX, so the peel stops at the first non-digit from the right.
    writeLegacySale('RS-00007')
    writeLegacySale('INV00008')
    writeLegacySale('RS2-00009')
    writeLegacySale('10')
    setSequence(11)

    db.exec(migration012.up)

    expect(numbersByRow().map((row) => row.invoice_number)).toEqual([7, 8, 9, 10])
  })

  it('empties the old generator prefix so nothing can read it back into force', () => {
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('retail.invoicePrefix','RS-','2026-08-01')",
    ).run()

    db.exec(migration012.up)

    expect(
      (
        db
          .prepare("SELECT value FROM app_settings WHERE key = 'retail.invoicePrefix'")
          .get() as { value: string }
      ).value,
    ).toBe('')
  })

  it('indexes the columns the report ranges over', () => {
    db.exec(migration012.up)

    const indexes = (
      db
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'index' AND tbl_name = 'retail_sales'`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name)

    expect(indexes).toContain('ux_retail_sales_invoice_number')
    expect(indexes).toContain('idx_retail_sales_date_status')
    expect(indexes).toContain('idx_retail_sales_customer_date')
  })
})
