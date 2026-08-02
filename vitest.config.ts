import { defineConfig } from 'vitest/config'

// Every test in this project runs with no database and no window.
//
// The persistence package's tests do open a real better-sqlite3 database, but
// in a temp directory created and destroyed by the test itself — there is still
// no server to start and no window to render. Nothing here needs Electron.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.{test,spec}.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['packages/domain/src/**', 'packages/application/src/**'],
      reporter: ['text', 'html'],
    },
  },
})
