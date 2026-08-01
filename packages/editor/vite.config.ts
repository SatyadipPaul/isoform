import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/* Root is pinned rather than inherited from cwd, so the app serves correctly
   whether launched via `npm run dev -w @isoform/editor` or with an explicit
   --config from the workspace root. */
export default defineConfig({
  root: resolve(import.meta.dirname),
  server: { port: 5173, open: true },
  build: { target: 'es2022', outDir: resolve(import.meta.dirname, 'dist') },
})
