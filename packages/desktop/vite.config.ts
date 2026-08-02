import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// connect-src 'none' in index.html is deliberate: this is an offline
// application and the renderer has no business reaching the network at all.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            rollupOptions: {
              output: { entryFileNames: 'main.cjs', format: 'cjs' },
              // better-sqlite3 is a native module: it must stay external and be
              // loaded from node_modules at runtime. A .node binary cannot be
              // inlined into a JavaScript chunk.
              external: ['better-sqlite3', 'electron'],
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            rollupOptions: {
              // A sandboxed preload must be CommonJS. Electron loads it in a
              // context with no ESM loader, so an .mjs preload silently fails
              // and window.api is never defined.
              output: { entryFileNames: 'preload.cjs', format: 'cjs' },
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
  build: { outDir: 'dist' },
})
