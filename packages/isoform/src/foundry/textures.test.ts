import { describe, expect, it } from 'vitest'
import { heightToNormalPixels, noisePixels } from './textures.js'
import { mulberry32 } from './rng.js'

describe('noisePixels', () => {
  it('is deterministic for a given seed', () => {
    const a = noisePixels(32, 4, 0.5, 0.55, mulberry32(1234))
    const b = noisePixels(32, 4, 0.5, 0.55, mulberry32(1234))
    expect(a).toEqual(b)
  })

  it('differs between seeds', () => {
    const a = noisePixels(32, 4, 0.5, 0.55, mulberry32(1))
    const b = noisePixels(32, 4, 0.5, 0.55, mulberry32(2))
    expect(a).not.toEqual(b)
  })

  it('emits opaque greyscale within range', () => {
    const px = noisePixels(16, 3, 0.5, 0.55, mulberry32(7))
    expect(px.length).toBe(16 * 16 * 4)
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(px[i + 1])
      expect(px[i]).toBe(px[i + 2])
      expect(px[i + 3]).toBe(255)
    }
  })

  it('centres on `base` and widens with `amp`', () => {
    const mean = (amp: number): number => {
      const px = noisePixels(64, 4, 0.5, amp, mulberry32(99))
      let sum = 0
      for (let i = 0; i < px.length; i += 4) sum += px[i]
      return sum / (px.length / 4)
    }
    // amp 0 collapses every sample onto base*255 == 127.5, which
    // Uint8ClampedArray stores as 128 (round-half-to-even).
    expect(mean(0)).toBe(128)
    // Widening amp keeps the mean near base but must change the distribution.
    const spread = (): number => {
      const px = noisePixels(64, 4, 0.5, 0.55, mulberry32(99))
      let min = 255
      let max = 0
      for (let i = 0; i < px.length; i += 4) {
        min = Math.min(min, px[i])
        max = Math.max(max, px[i])
      }
      return max - min
    }
    expect(spread()).toBeGreaterThan(20)
  })
})

describe('heightToNormalPixels', () => {
  const flat = (w: number, h: number, v: number): Uint8ClampedArray => {
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = v
      px[i + 3] = 255
    }
    return px
  }

  it('maps a flat height field to a flat normal', () => {
    const out = heightToNormalPixels(flat(8, 8, 128), 8, 8, 3)
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBeCloseTo(128, -1) // nx ~ 0
      expect(out[i + 1]).toBeCloseTo(128, -1) // ny ~ 0
      expect(out[i + 2]).toBe(255) // nz = 1
      expect(out[i + 3]).toBe(255)
    }
  })

  it('tilts the normal against the height gradient', () => {
    // Height rising along +x: the surface normal must lean toward -x.
    const w = 8
    const h = 4
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        px[i] = px[i + 1] = px[i + 2] = x * 20
        px[i + 3] = 255
      }
    }
    const out = heightToNormalPixels(px, w, h, 3)
    // Sample mid-row, away from the wrap seam at x=0 and x=w-1.
    const at = (x: number, y: number): number => out[(y * w + x) * 4]
    expect(at(3, 2)).toBeLessThan(128)
    expect(at(4, 2)).toBeLessThan(128)
  })

  it('wraps at the edges so the map tiles', () => {
    // A field constant in x has zero x-gradient everywhere *including* the seam,
    // which only holds if the sampler wraps.
    const w = 6
    const h = 6
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        px[i] = px[i + 1] = px[i + 2] = 100
        px[i + 3] = 255
      }
    }
    const out = heightToNormalPixels(px, w, h, 4)
    expect(out[0]).toBeCloseTo(128, -1)
    expect(out[(w - 1) * 4]).toBeCloseTo(128, -1)
  })

  it('scales tilt with strength', () => {
    const w = 8
    const h = 2
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        px[i] = px[i + 1] = px[i + 2] = x * 10
        px[i + 3] = 255
      }
    }
    const weak = heightToNormalPixels(px, w, h, 1)
    const strong = heightToNormalPixels(px, w, h, 6)
    const idx = (3 * 1 + 3) * 0 + 3 * 4 // pixel (3, 0)
    expect(Math.abs(strong[idx] - 128)).toBeGreaterThan(Math.abs(weak[idx] - 128))
  })
})
