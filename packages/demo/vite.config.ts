import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/* Root is pinned rather than inherited from cwd, so the app serves correctly
   whether launched via `npm run dev -w @isoform/demo` or with an explicit
   --config from the workspace root. */
export default defineConfig({
  root: resolve(import.meta.dirname),
  resolve: {
    alias: {
      /* The published `exports` map points at `dist`, which is correct for
         consumers and wrong for developing the library: every edit would need a
         rebuild before the demo saw it. In this workspace the specifier resolves
         to source instead, so HMR works on the library itself. */
      '@satyadip28/isoform': resolve(import.meta.dirname, '../isoform/src/index.ts'),
    },
  },
  server: { port: 5173, open: true },
  build: { target: 'es2022', outDir: resolve(import.meta.dirname, 'dist') },
})
