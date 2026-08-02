import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// connect-src 'none' in index.html is deliberate: this is an offline
// application and the renderer has no business reaching the network at all.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: { entry: 'src/main/index.ts' },
      preload: { input: 'src/preload/index.ts' },
    }),
  ],
  build: { outDir: 'dist' },
})
