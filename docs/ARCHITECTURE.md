# Architecture

Electron + TypeScript + React, `better-sqlite3` in WAL mode, npm workspaces.

The folder names are not the point. The **reference rules** are the point: they
are what keeps business calculations out of the UI and database access out of the
forms, and they are what makes every calculation testable with no database and no
window.

---

## The tree

```
Jewllery/
├─ packages/
│  ├─ domain/                    Entities, value types, enums. Depends on NOTHING.
│  │  └─ src/
│  │     ├─ common/              Weight (mg), Money (paisa), rounding, sign convention
│  │     ├─ shop/                Shop profile, Branch
│  │     ├─ users/               User, Role
│  │     ├─ rates/               GoldRate, Purity
│  │     └─ audit/               AuditEntry
│  │
│  ├─ application/               ALL business calculations. No SQL, no Electron, no React.
│  │  └─ src/
│  │     ├─ abstractions/        Repository + service interfaces (implemented in persistence)
│  │     ├─ auth/                Login, password hashing, role checks
│  │     ├─ rates/               Rate-on-a-date resolution, valuation
│  │     ├─ shop/                Shop profile rules
│  │     ├─ backup/              Backup policy and orchestration (not the file I/O)
│  │     └─ validation/          Over-return tolerance, cut-% threshold      [M2]
│  │
│  ├─ persistence/               THE only place that knows SQL exists.
│  │  └─ src/
│  │     ├─ Database.ts          better-sqlite3 connection, WAL, pragmas
│  │     ├─ migrations/          Numbered, forward-only, run at startup
│  │     ├─ repositories/        Implements application/abstractions
│  │     └─ backup/              Online backup API, restore, integrity check, retention
│  │
│  ├─ printing/                  Documents, separate from screens.               [M3]
│  │  └─ src/
│  │     ├─ thermal80mm/         Raster → ESC/POS (shared package, see below)
│  │     ├─ a4/                  Ledgers and statements via printToPDF
│  │     └─ preview/
│  │
│  └─ desktop/                   Electron.
│     └─ src/
│        ├─ main/                Composition root — the ONE layer that sees everything
│        │  ├─ index.ts          App lifecycle, window creation
│        │  ├─ container.ts      Dependency wiring
│        │  └─ ipc/              One handler per channel; validates, delegates, returns
│        ├─ preload/             Narrow contextBridge surface. Carries types, nothing else.
│        ├─ shared/              Plain types crossing the IPC gap (no behaviour)
│        └─ renderer/            React. Views only — zero calculations, zero SQL.
│           ├─ shell/            Window chrome, sidebar, navigation, status bar
│           ├─ modules/          One folder per module, built one at a time
│           │  ├─ dashboard/
│           │  ├─ rates/
│           │  ├─ settings/      Shop profile, users, backup, tolerances
│           │  ├─ parties/                                                     [M1]
│           │  ├─ wholesale/                                                   [M2]
│           │  └─ …
│           ├─ components/       Shared: WeightInput, MoneyInput, BalanceBadge
│           └─ styles/           Theme tokens — dark sidebar, gold accents
│
├─ docs/                         DECISIONS.md is binding. SPEC.md, mockup.png.
├─ .github/workflows/            CI — lint failure blocks the build
└─ data/                         gitignored — dev database and backups
```

---

## The reference rules

Declared in each package's `package.json` dependencies, enforced by
`boundaries/element-types` in `eslint.config.js`, and failed by CI.

| Layer | May import | May **not** import |
|---|---|---|
| `domain` | nothing | everything |
| `application` | `domain` | persistence, printing, electron, react, SQL |
| `persistence` | `domain`, `application` | printing, electron, react |
| `printing` | `domain`, `application` | persistence |
| `desktop/main` | everything | — (composition root) |
| `desktop/preload` | `shared` | domain, application, persistence |
| **`desktop/renderer`** | **`domain`, `shared`** | **`persistence`, `application`, `fs`, `electron`** |

### The rule that matters

> **A screen must not be able to open a database connection.**

In a C# solution this is a compile error: `Jewellery.Desktop` does not reference
`Jewellery.Persistence`, so the type is not in scope and the code does not build.
TypeScript has no assembly boundary, so the guarantee is reconstructed from four
independent mechanisms:

1. **Workspace dependencies.** `@jewellery/desktop` does not list
   `@jewellery/persistence` as a renderer dependency, so an illegal import is
   also an undeclared one.
2. **Lint.** `boundaries/element-types` fails on the import.
3. **CI.** `npm run lint` failure blocks the build.
4. **The Electron process model.** This is the strong one, and it does not depend
   on lint at all. The renderer runs with `contextIsolation: true`,
   `nodeIntegration: false` and `sandbox: true`. It has no `require`, no `fs`, no
   node. A React component **cannot** open the database because Chromium gives it
   no means to reach a file — the same practical guarantee as a type not being in
   scope, enforced at runtime by the browser sandbox.

Mechanism 4 covers the boundary the whole layering exists to protect. Mechanisms
1–3 cover the softer ones — a calculation drifting from `application` into the
renderer, or SQL leaking out of `persistence` — where the risk is real but lower.

### How the renderer gets data

```
React component
  → window.api.<channel>(args)        preload contextBridge, typed
  → ipcMain.handle(<channel>)         desktop/main/ipc — validates input
  → application service                the calculation
  → repository interface               application/abstractions
  → SQL                                persistence — the only layer with SQL
```

The renderer receives plain serializable data. It never receives a repository, a
connection, or a `Database` handle, because none of those survive the IPC
boundary.

---

## Testing

`npm run test` runs vitest across all packages with **no database and no
window**. The `application` layer is pure: repositories are interfaces, so tests
inject in-memory fakes.

`persistence` tests run against a real `better-sqlite3` database created in a
temp directory — they verify migrations, WAL behaviour, the integer-column
guarantee, and backup/restore round trips. They still need no window.

---

## The shared thermal printing package                                      [M3]

`rasterPrint` is extracted from the GoldLab project as a **shared local
package**, consumed by both products. It is never copy-pasted.

The reason is concrete: the printer-name regex, the 1-bit threshold (185) and the
raster band size (512) are field knowledge, bought one misprinting shop at a time.
A fork drifts, and then a printer fixed in one product stays broken in the other.

Note for slip design: the pipeline **hard-thresholds** to 1-bit, it does not
dither. The shop logo must therefore be authored as 1-bit line art — a photo or
gradient logo will threshold to a black blob.
