// ─── Layer boundaries ────────────────────────────────────────────────────────
// These rules ARE the architecture. In a C# solution the compiler would enforce
// them: a project that does not reference Jewellery.Persistence cannot see its
// types, so a form physically cannot open a database connection. TypeScript has
// no assembly boundary, so the same guarantee is reconstructed here from three
// independent mechanisms:
//
//   1. Workspace dependencies — a package can only import what its package.json
//      declares, so an illegal import is also an undeclared dependency.
//   2. These lint rules — an illegal import fails `npm run lint`.
//   3. CI — lint failures block the build (.github/workflows/verify.yml).
//
// And for the boundary that matters most — the UI reaching the database — there
// is a fourth, stronger mechanism that does not depend on lint at all: the
// renderer runs with contextIsolation on, nodeIntegration off and sandbox on, so
// it has no `require`, no `fs`, and no way to reach a file. A React component
// cannot open the database because Chromium gives it no means to, exactly as a
// WPF view could not because the type was not in scope.
//
// If you find yourself wanting to disable a rule in this file, the import is
// almost certainly telling you a calculation has drifted into the wrong layer.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'

export default tseslint.config(
  {
    ignores: [
      // Evidence tooling: a CDP driver used to measure and screenshot the
      // running app. Plain CommonJS, run by hand, and it ships with nothing.
      '.shots/**',
      '**/dist/**',
      '**/dist-types/**',
      '**/dist-electron/**',
      '**/release/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/**/*.{ts,tsx}'],
      'boundaries/debug': process.env.BOUNDARIES_DEBUG === '1',
      // mode: 'file' is REQUIRED. The plugin defaults to mode: 'folder', under
      // which a pattern like 'packages/application/src/**/*' matches the file's
      // FOLDER — so a file sitting directly in src/ matches no element at all and
      // silently escapes every rule below. Verified by test: without this, an
      // `import Database from 'better-sqlite3'` in packages/application/src/ lints
      // clean. See packages/*/src/**/boundaries.test.ts.
      'boundaries/elements': [
        // Order matters — first match wins, so the more specific desktop
        // sub-layers must be listed before anything broader.
        { type: 'domain', pattern: 'packages/domain/src/**/*', mode: 'file' },
        { type: 'application', pattern: 'packages/application/src/**/*', mode: 'file' },
        { type: 'persistence', pattern: 'packages/persistence/src/**/*', mode: 'file' },
        { type: 'printing', pattern: 'packages/printing/src/**/*', mode: 'file' },
        { type: 'desktop-main', pattern: 'packages/desktop/src/main/**/*', mode: 'file' },
        { type: 'desktop-preload', pattern: 'packages/desktop/src/preload/**/*', mode: 'file' },
        { type: 'desktop-renderer', pattern: 'packages/desktop/src/renderer/**/*', mode: 'file' },
        { type: 'shared-ipc', pattern: 'packages/desktop/src/shared/**/*', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} must not import ${dependency.type} — see eslint.config.js',
          rules: [
            // Domain is the bottom of the stack. Entities and value types only.
            // It imports nothing, not even from application.
            { from: 'domain', allow: ['domain'] },

            // Business calculations. Depends on domain, and on NOTHING that
            // knows about SQL, Electron, React or a printer. This is what makes
            // every calculation testable with no database and no window.
            { from: 'application', allow: ['domain', 'application'] },

            // Implements the repository interfaces declared in application.
            { from: 'persistence', allow: ['domain', 'application', 'persistence'] },

            // Renders documents from domain data. Never touches the database.
            { from: 'printing', allow: ['domain', 'application', 'printing'] },

            // The composition root. This is the ONE layer allowed to see
            // everything, because wiring it together is its entire job.
            {
              from: 'desktop-main',
              allow: [
                'domain',
                'application',
                'persistence',
                'printing',
                'desktop-main',
                'shared-ipc',
              ],
            },

            // The preload bridge exposes a narrow, explicit IPC surface. It
            // carries channel names and types across, nothing else.
            { from: 'desktop-preload', allow: ['shared-ipc', 'desktop-preload'] },

            // THE RULE THAT MATTERS: the UI can see domain types and application
            // types (so it can display a Weight, or type an IPC result), but it
            // can NEVER import persistence. No screen opens a database
            // connection, and no screen performs a business calculation — it
            // asks the main process over IPC and renders the answer.
            {
              from: 'desktop-renderer',
              allow: ['domain', 'shared-ipc', 'desktop-renderer'],
            },

            // Plain types shared between renderer and main across the IPC gap.
            { from: 'shared-ipc', allow: ['domain', 'shared-ipc'] },
          ],
        },
      ],

      // Cross-package imports are checked HERE, not by element-types.
      //
      // In an npm workspace, `@jewellery/persistence` resolves through a
      // node_modules symlink, so eslint-plugin-boundaries classifies it as an
      // external dependency rather than as a local element. element-types
      // therefore never sees it, and the one rule that matters most — the
      // renderer must not import persistence — would silently never fire.
      // Verified by test: see packages/desktop/src/renderer/boundaries.test.ts.
      //
      // element-types still governs relative imports *within* a package.
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: ['domain'],
              disallow: ['@jewellery/*', 'better-sqlite3', 'electron', 'react', 'react-dom'],
              message:
                'The domain layer has no dependencies and must not acquire any. ' +
                'It is the bottom of the stack.',
            },
            {
              from: ['application'],
              disallow: [
                '@jewellery/persistence',
                '@jewellery/printing',
                '@jewellery/desktop',
                'better-sqlite3',
                'electron',
                'react',
                'react-dom',
              ],
              message:
                'The application layer must stay free of database, Electron and ' +
                'React imports so every calculation can be tested with no ' +
                'database and no window. Depend on an interface in ' +
                'application/abstractions and let the composition root inject ' +
                'the implementation.',
            },
            {
              from: ['printing'],
              disallow: ['@jewellery/persistence', 'better-sqlite3'],
              message:
                'Printing renders documents from data it is handed. It does not ' +
                'read the database.',
            },
            {
              from: ['desktop-renderer'],
              disallow: [
                '@jewellery/persistence',
                '@jewellery/application',
                'better-sqlite3',
                'fs',
                'node:fs',
                'path',
                'node:path',
                'electron',
              ],
              message:
                'A screen must not open a database connection or run a business ' +
                'calculation. The renderer is sandboxed and has no filesystem ' +
                'access at runtime either — ask the main process over the preload ' +
                'IPC bridge and render the answer.',
            },
            {
              from: ['desktop-preload'],
              disallow: ['@jewellery/persistence', '@jewellery/application', 'better-sqlite3'],
              message:
                'The preload bridge carries channel names and types across the IPC ' +
                'gap. It holds no logic and reaches no database.',
            },
          ],
        },
      ],

      // Weight and Money are integers. `==` coercion and implicit any are how
      // a paisa quietly becomes a float.
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Tests may reach for fixtures freely; they are not part of the shipped graph.
  // `.test.tsx` is included for the same reason `.test.ts` is: the purchase
  // screen's suite drives the REAL main-process handlers over in-memory fakes,
  // which is an import the shipped renderer never makes and the sandbox could
  // not execute anyway.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      'boundaries/element-types': 'off',
      'boundaries/external': 'off',
    },
  },
)
