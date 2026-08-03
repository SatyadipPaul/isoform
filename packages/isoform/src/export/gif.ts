/**
 * GIF export.
 *
 * The format nothing needs permission to show. A wiki that forbids scripts, an
 * HTML macro an admin disabled, a chat window, a pull request comment — all of
 * them render a GIF inline, which is why this exists alongside the richer HTML
 * export rather than beneath it.
 *
 * Encoding sits behind `encodeGif` so the encoder is one file to change.
 * `gifenc` is the default: ESM, ~60 kB, no worker file for a consumer to host.
 * (`gif.js` is the better-known name and ships a separate `gif.worker.js` that
 * every consumer must serve themselves, which would break the library's one-call
 * promise the moment anyone bundled it.)
 *
 * ## Two things that decide whether the output looks deliberate
 *
 * · **One global palette, sampled across the whole sequence.** A palette per
 *   frame re-quantises every frame independently, and the background shimmers as
 *   colours get reassigned between them. gifenc emits a local colour table for
 *   any frame given a `palette`, so the global one is passed exactly once.
 * · **Delay quantises to centiseconds.** GIF stores frame time in 1/100 s, so
 *   15 fps is not 15 fps — it is 66.7 ms rounded to 70, i.e. 14.3. Rates that
 *   divide 100 evenly (10, 20, 25) are exact; anything else drifts, and the
 *   effective rate is reported rather than left to be discovered.
 */

/**
 * Imported by its ESM file rather than by bare specifier, deliberately.
 *
 * gifenc declares `main` (CommonJS) and `module` (ESM) and no `exports` map. A
 * bundler picks `module` and named imports work; **Node picks `main`** and
 * cannot see named exports through the CJS wrapper — `import { GIFEncoder } from
 * 'gifenc'` throws at load. Importing the default instead is not a fix: under
 * Node it yields the namespace object, under a bundler it yields the
 * `GIFEncoder` function, so the same code means two different things.
 *
 * Naming the ESM build resolves identically in both. Found by installing the
 * packed tarball into a clean project — it works in dev and in the test suite,
 * both of which go through a bundler, and fails only for someone consuming the
 * published package from Node.
 */
import { GIFEncoder, applyPalette, quantize, type GifPalette } from 'gifenc/dist/gifenc.esm.js'
import type { Doc } from '../doc/schema.js'
import { renderFrames, type Frame, type FrameOptions } from '../render/frames.js'

export interface GifOptions extends FrameOptions {
  /** Palette size, 2–256. */
  colors?: number
  /** Loop count: 0 forever, -1 once, or a count. */
  repeat?: number
  /** How much quantisation error to diffuse, 0–1. */
  dither?: number
}

/** Rates that divide 100 ms evenly, so every frame lands on a whole centisecond. */
const EXACT_RATES = [1, 2, 4, 5, 10, 20, 25, 50, 100]

/**
 * 20 fps — 50 ms exactly.
 *
 * Smooth enough for a camera move and one of the few rates GIF can represent
 * without rounding. Higher costs file size fast; a 1000px frame is ~2.7 MB
 * uncompressed before palettisation, and a GIF holds every one of them.
 */
const DEFAULT_FPS = 20

/**
 * Default error diffusion.
 *
 * Chosen by measuring, not by taste. The same 80-frame turntable encoded four
 * ways, and then looked at:
 *
 *   0.00 → 1029 kB, clear concentric contour rings across the backdrop
 *   0.35 → 1505 kB, rings gone
 *   0.55 → 2457 kB, no visible improvement over 0.35
 *   1.00 → 3029 kB
 *
 * The banding is fully resolved well before the cost curve turns, so the extra
 * 60% between 0.35 and 0.55 buys nothing anyone can see. Full diffusion nearly
 * triples the file for the same picture — noise is what LZW cannot compress.
 */
const DEFAULT_DITHER = 0.35

export async function exportGif(doc: Doc, opts: GifOptions = {}): Promise<Blob> {
  const fps = opts.fps ?? DEFAULT_FPS
  const frames = await renderFrames(doc, { ...opts, fps })
  const bytes = await encodeGifAsync(frames, {
    fps,
    colors: opts.colors,
    repeat: opts.repeat,
    dither: opts.dither,
  })
  return new Blob([bytes], { type: 'image/gif' })
}

export interface EncodeOptions {
  fps?: number
  colors?: number
  repeat?: number
  /**
   * How much quantisation error to diffuse, 0–1. See `ditherToPalette`.
   *
   * 0 is fastest and smallest and bands visibly on the studio backdrop; 1 is
   * smoothest and roughly triples the file. The default is the middle ground.
   */
  dither?: number
}

/**
 * As `encodeGif`, yielding between frames so the tab stays alive.
 *
 * Palettising and LZW-compressing a hundred frames is several seconds of solid
 * main-thread work. Measured on a 6 s turntable it was 6 of the 20 seconds an
 * export took — during which nothing repainted, so the progress label sat frozen
 * on its last value and the page looked hung. The rendering half already yields
 * for exactly this reason; the encoding half has no excuse not to.
 *
 * `encodeGif` stays synchronous. It is a pure function, which is what makes it
 * testable and usable from a script where blocking is fine.
 */
export async function encodeGifAsync(
  frames: Frame[],
  opts: EncodeOptions & { onProgress?: (done: number, total: number) => void } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  return encodeGif(frames, opts, {
    onFrame: opts.onProgress,
    yieldEvery: 4,
  })
}

/** Hand control back without the background-tab timer clamp. See `frames.ts`. */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

interface EncodePacing {
  onFrame?: (done: number, total: number) => void
  /** Frames between yields. Absent means never yield — the synchronous path. */
  yieldEvery?: number
}

export function encodeGif(
  frames: Frame[],
  opts?: EncodeOptions,
): Uint8Array<ArrayBuffer>
export function encodeGif(
  frames: Frame[],
  opts: EncodeOptions,
  pacing: EncodePacing & { yieldEvery: number },
): Promise<Uint8Array<ArrayBuffer>>
export function encodeGif(
  frames: Frame[],
  opts: EncodeOptions = {},
  pacing?: EncodePacing,
): Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>> {
  if (!frames.length) throw new Error('Isoform: encodeGif needs at least one frame')

  const fps = Math.max(1, opts.fps ?? DEFAULT_FPS)
  const colors = Math.min(256, Math.max(2, Math.round(opts.colors ?? 256)))
  const dither = Math.max(0, Math.min(1, opts.dither ?? DEFAULT_DITHER))

  /* GIF stores delay in centiseconds, so anything not dividing 100 is rounded
     and the animation runs at a rate the caller did not ask for. Silence here
     would mean a turntable that finishes early and a caption timed to nothing. */
  const delay = Math.max(10, Math.round(1000 / fps / 10) * 10)
  if (!EXACT_RATES.includes(fps)) {
    console.warn(
      `[isoform] ${fps} fps is not representable in GIF — encoding at ${(1000 / delay).toFixed(1)} fps. ` +
        `Use one of ${EXACT_RATES.filter((r) => r >= 5 && r <= 25).join(', ')} for an exact rate.`,
    )
  }

  const palette = globalPalette(frames, colors)
  const gif = GIFEncoder()

  const writeOne = (frame: Frame, i: number): void => {
    const index =
      dither > 0
        ? ditherToPalette(frame, palette, dither)
        : applyPalette(frame.data, palette, 'rgb565')
    /* Palette and repeat only on the first frame: gifenc reads `repeat` once,
       and any later frame carrying a palette gets a local colour table — a
       needless copy per frame and a source of inter-frame shimmer. */
    gif.writeFrame(
      index,
      frame.width,
      frame.height,
      i === 0 ? { palette, delay, repeat: opts.repeat ?? 0 } : { delay },
    )
    pacing?.onFrame?.(i + 1, frames.length)
  }

  if (!pacing?.yieldEvery) {
    frames.forEach(writeOne)
    gif.finish()
    return gif.bytes()
  }

  const every = pacing.yieldEvery
  return (async () => {
    for (let i = 0; i < frames.length; i++) {
      writeOne(frames[i], i)
      if (i % every === every - 1) await yieldToHost()
    }
    gif.finish()
    return gif.bytes()
  })()
}

/**
 * Floyd–Steinberg error diffusion onto the palette.
 *
 * Not optional in practice, and not a guess: the first export of this diagram
 * showed clear concentric contour rings across the studio backdrop, which is a
 * smooth radial gradient being flattened onto 256 quantised colours. gifenc's
 * `applyPalette` is a nearest-colour lookup with no diffusion, so the banding is
 * inherent to it.
 *
 * Diffusing the quantisation error into the neighbouring pixels trades the
 * banding for fine noise, which at these frame sizes reads as the gradient it
 * was. The cost is a larger file — noise compresses worse than flat bands — and
 * that is the right trade for a diagram someone is going to look at.
 */
function ditherToPalette(frame: Frame, palette: GifPalette, strength: number): Uint8Array {
  const { width, height, data } = frame
  const out = new Uint8Array(width * height)
  const s = Math.max(0, Math.min(1, strength))

  /* Error is carried in floats across two rows; doing it in place on the pixel
     data would clip at 0 and 255 and lose exactly the signal being diffused. */
  const rowLen = width * 3
  let curr = new Float32Array(rowLen)
  let next = new Float32Array(rowLen)

  const nearest = nearestIndexLookup(palette)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const e = x * 3
      const r = clamp255(data[src] + curr[e])
      const g = clamp255(data[src + 1] + curr[e + 1])
      const b = clamp255(data[src + 2] + curr[e + 2])

      const idx = nearest(r, g, b)
      out[y * width + x] = idx
      const [pr, pg, pb] = palette[idx]
      /* Scaled error. Full diffusion removes the banding and replaces it with
         noise that LZW cannot compress — measured, it took a 6 s turntable from
         2.5 MB to 8.9 MB, which is past the point of being shareable. Diffusing
         a fraction of the error breaks up the contours while leaving most of the
         flat area genuinely flat, which is what the compressor needs. */
      const er = (r - pr) * s
      const eg = (g - pg) * s
      const eb = (b - pb) * s

      /* 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right. */
      if (x + 1 < width) {
        curr[e + 3] += er * 0.4375
        curr[e + 4] += eg * 0.4375
        curr[e + 5] += eb * 0.4375
      }
      if (x > 0) {
        next[e - 3] += er * 0.1875
        next[e - 2] += eg * 0.1875
        next[e - 1] += eb * 0.1875
      }
      next[e] += er * 0.3125
      next[e + 1] += eg * 0.3125
      next[e + 2] += eb * 0.3125
      if (x + 1 < width) {
        next[e + 3] += er * 0.0625
        next[e + 4] += eg * 0.0625
        next[e + 5] += eb * 0.0625
      }
    }
    const swap = curr
    curr = next
    next = swap
    next.fill(0)
  }
  return out
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * Nearest palette entry, memoised on a coarse RGB cube.
 *
 * A linear scan is 256 comparisons per pixel, and a 900×506 frame has 455 000 of
 * them — 116 million distance tests per frame, which would cost more than
 * rendering the frame did. Quantising the key to 5 bits per channel gives a
 * 32 768-entry cache that fills quickly and answers almost every lookup, because
 * a dithered image revisits nearly the same colours constantly.
 */
function nearestIndexLookup(palette: GifPalette): (r: number, g: number, b: number) => number {
  const cache = new Int16Array(32768).fill(-1)
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const hit = cache[key]
    if (hit >= 0) return hit

    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]
      const dr = r - p[0]
      const dg = g - p[1]
      const db = b - p[2]
      /* Luma-weighted: the eye resolves green far better than blue, and an
         unweighted metric picks visibly wrong greys out of a dark palette. */
      const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    cache[key] = best
    return best
  }
}

/**
 * One palette for the whole sequence, built from a sample of it.
 *
 * Quantising every pixel of every frame is the obvious approach and is far more
 * work than it buys: a few frames spread across the move already contain every
 * colour the diagram shows, because the parts do not change — only the angle
 * they are lit from does. Sampling keeps a hundred-frame export from spending
 * longer choosing colours than it spent rendering.
 */
function globalPalette(frames: Frame[], colors: number): GifPalette {
  const MAX_FRAMES = 8
  const step = Math.max(1, Math.ceil(frames.length / MAX_FRAMES))
  const picked = frames.filter((_, i) => i % step === 0)

  /* Every 3rd pixel. Enough to characterise a gradient without quantising 300
     megabytes of near-identical background. */
  const PIXEL_STRIDE = 3
  const perFrame = Math.floor(frames[0].data.length / 4 / PIXEL_STRIDE)
  const sample = new Uint8ClampedArray(picked.length * perFrame * 4)

  let w = 0
  for (const f of picked) {
    for (let p = 0; p < perFrame; p++) {
      const src = p * PIXEL_STRIDE * 4
      sample[w++] = f.data[src]
      sample[w++] = f.data[src + 1]
      sample[w++] = f.data[src + 2]
      sample[w++] = 255
    }
  }
  return quantize(sample, colors, { format: 'rgb565' })
}

/** Trigger a download. Browser only. */
export function downloadGif(blob: Blob, filename = 'diagram.gif'): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
