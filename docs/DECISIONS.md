# Decisions and hard rules

This file is the canonical statement of the rules the code is built on. Where a
rule is enforced by code, the enforcing file is named. If this document and the
code ever disagree, that is a bug in one of them — do not resolve it by guessing.

Status: settled and approved. Do not relitigate without a written decision here.

---

## 1. The application is offline

A Windows desktop application. No internet dependency, no server, no cloud, no
accounts hosted anywhere. The shop's data lives on the shop's PC.

The direct consequence, and the reason backup is built in M0 rather than later:

> **Offline means the data exists nowhere else.** From the first real day of
> trading, the shop's books exist in exactly one file on exactly one machine. A
> lost disk is a lost business. Backup is not a feature, it is a precondition.

---

## 2. Money and weight are integers

**Weight is stored as INTEGER milligrams. Money is stored as INTEGER paisa.
Never `REAL`, never a floating point number, at any layer.**

Conversion to and from decimal happens **only at the UI edge** — when a number is
typed in, and when a number is displayed or printed. Everywhere else, including
every calculation, every repository, every IPC message and every column in the
database, the value is an integer in its minor unit.

Enforced by:

- `packages/domain/src/common/Weight.ts` and `Money.ts` — the only legal
  representations. Both refuse non-integers at construction.
- `packages/persistence` — every weight and money column is `INTEGER NOT NULL`.
  There is no `REAL` column in the schema, and a test asserts this.

Why this matters more here than in most software: `0.1 + 0.2 !== 0.3` in
floating point. A ledger that is a rupee out at the end of the year is a ledger
nobody trusts, and the error is unfindable because it never happened in any one
place. Integers make the arithmetic exact by construction.

### Precision

| Quantity | Unit stored | Decimal places shown | Example |
|---|---|---|---|
| Weight | milligram | 3 (grams) | `700.000 g` → `700000` |
| Money | paisa | 2 (rupees) | `Rs 9,400.00` → `940000` |

### Why plain `number` and not `BigInt`

JavaScript integers are exact up to `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991).

- Weight: 9×10¹⁵ mg is about 9 billion kilograms of gold.
- Money: 9×10¹⁵ paisa is about 90 trillion rupees.
- The largest intermediate value in the codebase is a weight × rate product
  before division — roughly 10¹³ for any realistic shop. Three orders of
  magnitude of headroom.

`BigInt` would cost ergonomics and serialization complexity across the IPC
boundary for no gain. `Weight` and `Money` assert `Number.isSafeInteger` on every
construction and every arithmetic result, so if this assumption is ever violated
the code throws rather than silently losing precision.

### Rounding

Division (percentages, per-gram valuation) cannot always land on an integer.
The rule is **half away from zero**: `0.5` rounds to `1`, `-0.5` rounds to `-1`.

This is the arithmetic a shopkeeper expects, and it is symmetric about zero,
which matters because balances are signed (§4). Banker's rounding is *not* used —
it is unintuitive at the counter and its bias-reduction property is irrelevant at
these volumes.

Implemented once in `packages/domain/src/common/rounding.ts`. Nothing else in the
codebase may call `Math.round` on a monetary or weight quantity.

---

## 3. Multi-branch, stated plainly

The database carries a `branch_id` on every transaction table from day one, and
the application ships with exactly one branch. That column exists so a future
consolidation is not a schema migration across the whole trading history.

It does **not** mean branches work today, and the reason is not a missing
feature:

> **Two shops in different locations cannot share live data without the
> internet, and there is no clever way around it.**

The available options, all of which are real and none of which are "offline
multi-branch":

1. **Each branch runs its own independent copy** with its own database. Branches
   never see each other's live data. Consolidation happens by exporting and
   importing files, or by reading each branch's reports separately.
2. **One shop, several PCs on a LAN** — see §5. This works and is still offline,
   because a local network is not the internet. It does not extend between
   buildings.
3. **Accept an online sync component.** At that point the system is no longer
   offline, and that is a different product decision.

Do not promise live cross-branch reporting. Do not build a feature that implies
it.

---

## 4. The sign convention

Written down once, here, and applied identically everywhere:

> **Positive = the party owes the shop. Negative = the shop owes the party.**

This holds for **both** ledgers, which are separate and never netted against each
other:

- the **gold ledger**, measured in milligrams
- the **cash ledger**, measured in paisa

A party has two balances at all times. A party can owe gold while the shop owes
them cash. Combining them into one number is wrong and destroys information.

### Negative balances are first class

A negative balance is a real business state — it means the shop owes the party.
It is never clamped to zero, never stored as an absolute value, and never hidden.

- Reports sum **signed** values, and additionally report gross receivable and
  gross payable **separately**. Netting them across parties hides real exposure.
- Balances carry forward. An opening of `−0.500 g` followed by an issue of
  `100.000 g` leaves `99.500 g`. Most negatives resolve themselves on the next
  job.

### Display

**Never show a bare minus sign.** A busy shopkeeper misreads it.

- `0.500 g (we owe)` — not `−0.500 g`
- `Rs 1,200.00 (they owe)`

Implemented in `packages/domain/src/common/` formatting helpers so the label
cannot be forgotten at a call site.

---

## 5. The database

**SQLite via `better-sqlite3`, in WAL mode.**

Not `sql.js`. `sql.js` holds the whole database in memory and rewrites the entire
file on every flush, which means a crash or power cut between flushes loses
committed transactions, and a power cut during the write can corrupt the file.
For a gold ledger that is not acceptable. `better-sqlite3` is native and gives
real atomic commits with crash recovery.

### Hard prohibition

> **The SQLite file is NEVER placed on a Windows file share for several PCs to
> open.** SQLite's locking over SMB is unreliable and this is the single most
> common way to corrupt an SQLite database.

If the shop adds a second or third PC, the answer is one of:

1. One PC becomes the shop server running PostgreSQL, the others connect over the
   LAN. Still offline — a local network is not the internet.
2. Everyone uses the one PC via Remote Desktop.

Not "put the file on the network drive."

### Provider portability

All database access goes through the repository interfaces declared in
`packages/application/src/abstractions/`. The `packages/persistence`
implementation is the only code that knows SQL exists. Moving to PostgreSQL later
is a provider swap plus a migration, not a rewrite.

No SQL string appears outside `packages/persistence`. Enforced by
`eslint.config.js`.

---

## 6. Posted transactions are never edited

A posted transaction is immutable. Corrections are made by posting a **reversing
entry**, never by changing history.

Without this rule, users "fix" a balance by editing what was already recorded,
and the audit trail becomes fiction. With it, the books show what happened *and*
what was corrected, which is what an audit trail is for.

Enforced by: repositories expose no `update` for transaction tables, and the
schema's audit triggers record every write.

---

## 7. Over-returns — warn and allow

When returned weight plus cut exceeds the weight given, the remaining weight goes
negative. This is usually a data entry error, but occasionally genuine.

**The software warns and allows. It does not block, and it does not pass
silently.**

Blocking is wrong because it does not prevent errors — the user enters a
plausible number that passes validation instead, and the ledger then contains a
lie that cannot be audited. Silence is wrong because a gram of unexplained gold
is real money leaving the balance.

The full rule, to be implemented in M2 (Wholesale):

- A confirmation stating the **consequence in plain words**, not a validation
  message: *"This leaves Party X with 0.500 g that you owe them. Continue?"*
- The transaction is stamped `is_over_return`, with the confirming user and
  timestamp, and written to the audit log.
- A persistent red badge on the party and on the dashboard, so it cannot sit
  unnoticed for months.
- A configurable tolerance, **default 0.050 g**. Below it, allow with a quiet
  note — two scales genuinely disagree at the third decimal, and a modal on every
  20 mg discrepancy trains users to click through it.

### The cut-percentage check

A separate and more valuable check: warn when the cut exceeds a configured
percentage of the weight given. This catches the *cause* rather than the symptom.

> **Ships configurable and DISABLED.** No default is guessed. A wastage threshold
> that is wrong in either direction is actively harmful — too low and it cries
> wolf until users click through reflexively, too high and it never fires. The
> number must come from the shop's actual experience, and it may well differ by
> work type, since plain bands and intricate filigree do not carry comparable
> wastage.

---

## 8. Layer boundaries

The full reference rules and their enforcement are in `docs/ARCHITECTURE.md` and
`eslint.config.js`. The one that matters most:

> A screen must not be able to open a database connection.

In a C# solution the compiler would guarantee this. TypeScript has no assembly
boundary, so it is reconstructed from four mechanisms: workspace dependencies,
lint rules, CI enforcement, and — for the UI specifically — Electron's process
model, which denies the renderer any filesystem access at all.

---

## 9. Testing

> Every calculation has tests that run with **no database and no window**.

This is the reason the `application` layer may not import `better-sqlite3`,
`electron`, or `react`. If a calculation cannot be tested without starting a
database, it is in the wrong layer.
