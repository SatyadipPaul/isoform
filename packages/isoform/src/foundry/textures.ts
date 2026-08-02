/**
 * Procedural texture lab — ported from catalog section 1.
 *
 * Two deliberate changes from the source:
 *
 *  1. All randomness is seeded (see rng.ts), so textures are reproducible.
 *  2. The pixel math is separated from the canvas I/O. `noisePixels` and
 *     `heightToNormalPixels` are pure array-in/array-out functions with no DOM
 *     dependency, which is what makes them unit-testable in plain node. The
 *     canvas wrappers around them stay as thin as the originals.
 *
 * Everything is built lazily and memoised: the full set costs several hundred
 * milliseconds of per-pixel work, and importing the engine should not pay it.
 */

import * as THREE from 'three'
import { mulberry32, SEED, type Rng } from './rng.js'

/* ------------------------------------------------------------------ *
 * Pure pixel math — no canvas, no DOM
 * ------------------------------------------------------------------ */

/** RGBA buffer backed by a plain ArrayBuffer, as `ImageData` requires. */
export type Pixels = Uint8ClampedArray<ArrayBuffer>

/**
 * Value-noise height field, summed over `octaves` at halving amplitude.
 * Returns a greyscale RGBA buffer of `size × size`.
 */
export function noisePixels(
  size: number,
  octaves: number,
  base: number,
  amp: number,
  rng: Rng,
): Pixels {
  const grid: Array<{ n: number; g: Float32Array }> = []
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o
    const g = new Float32Array(n * n)
    for (let i = 0; i < n * n; i++) g[i] = rng()
    grid.push({ n, g })
  }

  const smp = function (l: { n: number; g: Float32Array }, u: number, v: number): number {
    const n = l.n
    const fx = u * n
    const fy = v * n
    const x0 = Math.floor(fx) % n
    const y0 = Math.floor(fy) % n
    const x1 = (x0 + 1) % n
    const y1 = (y0 + 1) % n
    let tx = fx - Math.floor(fx)
    let ty = fy - Math.floor(fy)
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    const a = l.g[y0 * n + x0]
    const b = l.g[y0 * n + x1]
    const c = l.g[y1 * n + x0]
    const d = l.g[y1 * n + x1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }

  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      let w = 0.5
      for (let o = 0; o < octaves; o++) {
        v += smp(grid[o], x / size, y / size) * w
        w *= 0.5
      }
      const val = Math.max(0, Math.min(255, (base + (v - 0.5) * amp) * 255))
      const i = (y * size + x) * 4
      out[i] = out[i + 1] = out[i + 2] = val
      out[i + 3] = 255
    }
  }
  return out
}

/**
 * Sobel-ish height-to-normal conversion. Reads the red channel as height,
 * wraps at the edges so the result tiles, and writes a tangent-space normal map.
 */
export function heightToNormalPixels(
  src: Uint8ClampedArray<ArrayBufferLike>,
  w: number,
  h: number,
  strength: number,
): Pixels {
  const out = new Uint8ClampedArray(w * h * 4)
  const H = function (x: number, y: number): number {
    x = (x + w) % w
    y = (y + h) % h
    return src[(y * w + x) * 4] / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength
      let nx = -dx
      let ny = -dy
      let nz = 1
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx /= l
      ny /= l
      nz /= l
      const i = (y * w + x) * 4
      out[i] = (nx * 0.5 + 0.5) * 255
      out[i + 1] = (ny * 0.5 + 0.5) * 255
      out[i + 2] = (nz * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Canvas plumbing
 * ------------------------------------------------------------------ */

/**
 * Max anisotropy, supplied by the stage once a renderer exists. Textures are
 * built lazily and always after stage construction in practice, but late
 * changes are pushed onto anything already built so ordering can never bite.
 */
let maxAnisotropy = 8
const issued: THREE.Texture[] = []

export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = n
  for (const t of issued) {
    t.anisotropy = n
    t.needsUpdate = true
  }
}

export function cv(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d')
  if (!x) throw new Error('Isoform: 2D canvas context unavailable')
  return x
}

/** Wrap a canvas as a repeating, anisotropically-filtered texture. */
export function tex(canvasEl: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvasEl)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.anisotropy = maxAnisotropy
  issued.push(t)
  return t
}

function canvasFromPixels(px: Pixels, w: number, h: number): HTMLCanvasElement {
  const c = cv(w, h)
  const x = ctx2d(c)
  x.putImageData(new ImageData(px, w, h), 0, 0)
  return c
}

function pixelsOf(c: HTMLCanvasElement): Uint8ClampedArray<ArrayBufferLike> {
  return ctx2d(c).getImageData(0, 0, c.width, c.height).data
}

/** Canvas-level wrapper matching the catalog's `heightToNormal` signature. */
export function heightToNormal(
  src: HTMLCanvasElement,
  strength: number,
  rx = 1,
  ry = 1,
): THREE.CanvasTexture {
  const px = heightToNormalPixels(pixelsOf(src), src.width, src.height, strength)
  return tex(canvasFromPixels(px, src.width, src.height), rx, ry)
}

/** Canvas-level wrapper matching the catalog's `noiseCanvas` signature. */
export function noiseCanvas(
  size: number,
  octaves: number,
  base: number,
  amp: number,
  rng: Rng = mulberry32(SEED.micro),
): HTMLCanvasElement {
  return canvasFromPixels(noisePixels(size, octaves, base, amp, rng), size, size)
}

/* ------------------------------------------------------------------ *
 * The texture set
 * ------------------------------------------------------------------ */

export interface TextureSet {
  /** Universal micro-surface roughness. Uniform roughness is the CG tell. */
  micro: THREE.CanvasTexture
  microNormal: THREE.CanvasTexture
  brushed: THREE.CanvasTexture
  brickNormal: THREE.CanvasTexture
  brickRough: THREE.CanvasTexture
  corrNormal: THREE.CanvasTexture
  ventNormal: THREE.CanvasTexture
  ventRough: THREE.CanvasTexture
  browser: THREE.CanvasTexture
  shutterNormal: THREE.CanvasTexture
}

function buildBrushed(): THREE.CanvasTexture {
  const rng = mulberry32(SEED.brushed)
  const c = cv(512, 512)
  const x = ctx2d(c)
  x.fillStyle = '#7c7c7c'
  x.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 5200; i++) {
    const y = rng() * 512
    const l = 40 + rng() * 300
    x.strokeStyle = 'rgba(' + (rng() > 0.5 ? 255 : 0) + ',0,0,' + (0.02 + rng() * 0.05) + ')'
    x.beginPath()
    x.moveTo(rng() * 512, y)
    x.lineTo(rng() * 512 + l, y + (rng() - 0.5) * 1.2)
    x.stroke()
  }
  return tex(c, 2, 2)
}

function buildBrickHeight(): HTMLCanvasElement {
  const rng = mulberry32(SEED.brick)
  const c = cv(512, 256)
  const x = ctx2d(c)
  x.fillStyle = '#101010'
  x.fillRect(0, 0, 512, 256)
  const bw = 124
  const bh = 54
  const gap = 8
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? -bw / 2 : 0
    for (let i = -1; i < 5; i++) {
      const bx = off + i * (bw + gap)
      const by = r * (bh + gap) + 4
      x.fillStyle = '#dcdcdc'
      x.fillRect(bx, by, bw, bh)
      x.fillStyle = 'rgba(0,0,0,.18)'
      for (let k = 0; k < 26; k++) x.fillRect(bx + rng() * bw, by + rng() * bh, 3, 2)
    }
  }
  return c
}

function buildCorrHeight(): HTMLCanvasElement {
  const c = cv(256, 32)
  const x = ctx2d(c)
  for (let i = 0; i < 256; i++) {
    const v = Math.round((0.5 + 0.5 * Math.sin(((i / 256) * Math.PI * 2 * 8))) * 255)
    x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'
    x.fillRect(i, 0, 1, 32)
  }
  return c
}

function buildVentHeight(): HTMLCanvasElement {
  const c = cv(128, 128)
  const x = ctx2d(c)
  x.fillStyle = '#e8e8e8'
  x.fillRect(0, 0, 128, 128)
  x.fillStyle = '#101010'
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < 8; i++) {
      x.beginPath()
      x.arc(8 + i * 16 + (r % 2 ? 8 : 0), 8 + r * 16, 4.5, 0, 6.29)
      x.fill()
    }
  }
  return c
}

/** The drawn browser window used as the client panel's emissive map. */
function buildBrowser(): THREE.CanvasTexture {
  const c = cv(640, 400)
  const x = ctx2d(c)
  x.fillStyle = '#0F1319'
  x.fillRect(0, 0, 640, 400)
  x.fillStyle = '#1B212B'
  x.fillRect(0, 0, 640, 56)
  ;['#F0655F', '#F0C15F', '#5FD08A'].forEach(function (col, i) {
    x.fillStyle = col
    x.beginPath()
    x.arc(30 + i * 26, 28, 8, 0, 6.29)
    x.fill()
  })
  x.fillStyle = '#262E3A'
  x.fillRect(122, 14, 470, 28)
  x.fillStyle = '#5E6A7B'
  x.fillRect(140, 25, 120, 6)
  x.fillStyle = '#8B92FF'
  x.fillRect(28, 86, 250, 16)
  x.fillStyle = '#3ED8BC'
  x.fillRect(28, 120, 150, 10)
  x.fillStyle = '#2A3240'
  ;[0, 1, 2].forEach(function (i) {
    x.fillRect(28, 158 + i * 22, 380 - i * 60, 10)
  })
  ;[0, 1, 2].forEach(function (i) {
    x.fillStyle = '#1C232D'
    x.fillRect(28 + i * 196, 244, 176, 120)
    x.fillStyle = ['#8B92FF', '#3ED8BC', '#F0AE5C'][i]
    x.fillRect(28 + i * 196, 244, 176, 5)
  })
  return tex(c, 1, 1)
}

function buildShutterNormal(): THREE.CanvasTexture {
  const c = cv(32, 128)
  const x = ctx2d(c)
  for (let i = 0; i < 128; i++) {
    const v = Math.round((0.5 + 0.5 * Math.sin(((i / 128) * Math.PI * 2 * 10))) * 255)
    x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'
    x.fillRect(0, i, 32, 1)
  }
  return heightToNormal(c, 4.0, 1, 1)
}

let cached: TextureSet | null = null

/** Build (once) and return the shared texture set. */
export function textures(): TextureSet {
  if (cached) return cached

  const noise = noiseCanvas(256, 4, 0.5, 0.55)
  const brickH = buildBrickHeight()
  const ventH = buildVentHeight()

  cached = {
    micro: tex(noise, 5, 5),
    microNormal: heightToNormal(noise, 1.1, 5, 5),
    brushed: buildBrushed(),
    brickNormal: heightToNormal(brickH, 3.4, 2, 1),
    brickRough: tex(brickH, 2, 1),
    corrNormal: heightToNormal(buildCorrHeight(), 5.0, 1, 1),
    ventNormal: heightToNormal(ventH, 3.0, 4, 2),
    ventRough: tex(ventH, 4, 2),
    browser: buildBrowser(),
    shutterNormal: buildShutterNormal(),
  }
  return cached
}

/* ---- one-off textures that are not part of the material set ---- */

let shadowTex: THREE.CanvasTexture | null = null

/** Soft radial blob used as a baked contact shadow under each part. */
export function shadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex
  const c = cv(256, 256)
  const x = ctx2d(c)
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 126)
  g.addColorStop(0, 'rgba(0,0,0,.6)')
  g.addColorStop(0.36, 'rgba(0,0,0,.28)')
  g.addColorStop(0.72, 'rgba(0,0,0,.07)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 256, 256)
  shadowTex = new THREE.CanvasTexture(c)
  return shadowTex
}

let stageBg: THREE.CanvasTexture | null = null

/**
 * Stage backdrop, drawn inside the scene so it fills exactly the scissor rect.
 * The outer stop matches the page background so rounded card corners blend away.
 */
export function stageBackground(): THREE.CanvasTexture {
  if (stageBg) return stageBg
  const c = cv(256, 256)
  const x = ctx2d(c)
  const g = x.createRadialGradient(128, 22, 0, 128, 22, 152)
  g.addColorStop(0, '#1E242E')
  g.addColorStop(0.5, '#161B23')
  g.addColorStop(1, '#0E1116')
  x.fillStyle = g
  x.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  stageBg = t
  return stageBg
}
