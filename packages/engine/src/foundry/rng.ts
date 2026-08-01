/**
 * Seeded pseudo-random numbers.
 *
 * The catalog builds its brushed-metal and micro-surface noise with bare
 * `Math.random()`, so every page load produces subtly different textures. For a
 * catalog that is harmless. For an engine whose output gets exported to PNG and
 * committed to a document, it means the same diagram never renders the same
 * twice. Every procedural texture here draws from a seeded stream instead.
 */

export type Rng = () => number

/** mulberry32 — small, fast, and good enough for surface noise. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One fixed seed per texture, so that adding a texture later cannot shift the
 * appearance of the ones that already exist.
 */
export const SEED = {
  micro: 0x15f0a3,
  brushed: 0x2b7e91,
  brick: 0x4c1d55,
} as const
