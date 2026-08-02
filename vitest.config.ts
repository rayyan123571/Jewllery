import { defineConfig } from 'vitest/config'

// Every test in this project runs with no database and no window.
//
// The persistence package's tests do open a real better-sqlite3 database, but
// in a temp directory created and destroyed by the test itself — there is still
// no server to start and no window to render. Nothing here needs Electron.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.test.ts'],
    // Node by default. Only the renderer's shell test needs a DOM, and it opts
    // in with a `@vitest-environment jsdom` docblock, so no calculation test
    // pays jsdom's startup cost.
    environment: 'node',
    // tests/boundaries.test.ts spawns a real ESLint run per assertion, which is
    // slow by nature — it is linting, not computing. The default 5s is not
    // enough once it competes with the jsdom suite for cores.
    testTimeout: 30_000,
    coverage: {
      include: ['packages/domain/src/**', 'packages/application/src/**'],
      reporter: ['text', 'html'],
    },
  },
})
