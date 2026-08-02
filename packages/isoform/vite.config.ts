import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/* The engine package is source-first: the editor imports its TypeScript
   directly through the workspace. This config exists only to serve `dev/`,
   which hosts the M1 visual gate — the original catalog page rebuilt from
   the part registry, for side-by-side comparison against the source HTML. */
export default defineConfig({
  root: resolve(import.meta.dirname, 'dev'),
  server: { port: 5174, open: true },
  build: {
    outDir: resolve(import.meta.dirname, 'dev-dist'),
    emptyOutDir: true,
  },
})
