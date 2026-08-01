import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /* Plain node, not jsdom. Most of the foundry is pure pixel/vector maths and
       needs nothing; the part builders need a canvas only because materials
       carry generated texture maps, and `vitest.setup.ts` stubs exactly that
       much. Cheaper and more honest than a DOM implementation that ships no 2D
       context anyway. */
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/src/**/*.test.ts'],
  },
})
