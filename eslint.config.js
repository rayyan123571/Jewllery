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
      '**/dist/**',
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
      'boundaries/elements': [
        // Order matters — first match wins, so the more specific desktop
        // sub-layers must be listed before anything broader.
        { type: 'domain', pattern: 'packages/domain/src/**/*' },
        { type: 'application', pattern: 'packages/application/src/**/*' },
        { type: 'persistence', pattern: 'packages/persistence/src/**/*' },
        { type: 'printing', pattern: 'packages/printing/src/**/*' },
        { type: 'desktop-main', pattern: 'packages/desktop/src/main/**/*' },
        { type: 'desktop-preload', pattern: 'packages/desktop/src/preload/**/*' },
        { type: 'desktop-renderer', pattern: 'packages/desktop/src/renderer/**/*' },
        { type: 'shared-ipc', pattern: 'packages/desktop/src/shared/**/*' },
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

      // A layer may only import packages its own package.json declares.
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: ['domain', 'application'],
              disallow: ['better-sqlite3', 'electron', 'react', 'react-dom'],
              message:
                'The domain and application layers must stay free of database, ' +
                'Electron and React imports so their calculations can be tested ' +
                'with no database and no window.',
            },
            {
              from: ['desktop-renderer'],
              disallow: ['better-sqlite3', 'fs', 'node:fs', 'path', 'node:path', 'electron'],
              message:
                'The renderer is sandboxed and has no filesystem access. Reach the ' +
                'main process through the preload IPC bridge instead.',
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
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      'boundaries/element-types': 'off',
      'boundaries/external': 'off',
    },
  },
)
