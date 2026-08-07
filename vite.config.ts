import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { toolManifests } from './scripts/vite-tool-manifests.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), toolManifests()],
  resolve: {
    alias: {
      // Cross-boundary modules shared with the server. They live under the
      // server's rootDir so `tsc -p server` still emits a flat dist/.
      '@shared': fileURLToPath(new URL('./server/src/shared', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3107',
    },
  },
})
