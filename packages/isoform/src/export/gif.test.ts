/**
 * GIF encoding.
 *
 * The output is a binary blob nobody reads, so these check the properties that
 * are invisible in the picture: that it is a well-formed GIF at all, that the
 * frame timing is what was asked for rather than what GIF rounded it to, and
 * that dithering trades size for smoothness in the direction claimed.
 *
 * Whether it *looks* right is not decidable here and was settled by rendering
 * the same clip at four diffusion strengths and looking at them.
 */

import { describe, expect, it, vi } from 'vitest'
import { encodeGif, encodeGifAsync } from './gif.js'
import type { Frame } from '../render/frames.js'

/** A frame with a smooth horizontal gradient — the thing that bands. */
function gradient(width = 64, height = 32, shift = 0): Frame {
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = ((x + shift) / width) * 255
      data[i] = v
      data[i + 1] = v * 0.6
      data[i + 2] = 255 - v
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const header = (bytes: Uint8Array): string =>
  String.fromCharCode(...bytes.subarray(0, 6))

/** Little-endian u16 at an offset. */
const u16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8)

describe('encodeGif', () => {
  it('writes a well-formed GIF89a with the right dimensions', () => {
    const bytes = encodeGif([gradient(64, 32)], { fps: 20 })
    expect(header(bytes)).toBe('GIF89a')
    /* Logical screen descriptor follows the 6-byte signature. */
    expect(u16(bytes, 6)).toBe(64)
    expect(u16(bytes, 8)).toBe(32)
    expect(bytes.at(-1)).toBe(0x3b) // trailer
  })

  it('refuses an empty sequence rather than emitting a broken file', () => {
    expect(() => encodeGif([], {})).toThrow(/at least one frame/)
  })

  it('grows with the number of frames', () => {
    const one = encodeGif([gradient()], { fps: 20 })
    const many = encodeGif([0, 1, 2, 3].map((i) => gradient(64, 32, i * 8)), { fps: 20 })
    expect(many.length).toBeGreaterThan(one.length)
  })

  it('trades size for smoothness in the direction claimed', () => {
    /* Diffusing error replaces flat bands with noise, and noise is precisely
       what LZW cannot compress. If this ever inverts, the dithering has stopped
       doing anything. */
    const frames = [0, 1, 2, 3].map((i) => gradient(96, 64, i * 8))
    const none = encodeGif(frames, { fps: 20, dither: 0 }).length
    const some = encodeGif(frames, { fps: 20, dither: 0.35 }).length
    const full = encodeGif(frames, { fps: 20, dither: 1 }).length

    expect(some).toBeGreaterThan(none)
    expect(full).toBeGreaterThan(some)
  })

  it('is deterministic', () => {
    /* Same frames in, identical bytes out — an export that differs between runs
       would mean something in the pipeline is reading a clock. */
    const frames = [gradient(48, 24), gradient(48, 24, 6)]
    const a = encodeGif(frames, { fps: 20 })
    const b = encodeGif(frames, { fps: 20 })
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('warns when the frame rate is not representable', () => {
    /* GIF stores delay in centiseconds, so 15 fps is really 14.3 — a turntable
       asked to take 6 s quietly takes 6.3, and a caption timed to it drifts. */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    encodeGif([gradient()], { fps: 15 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not representable'))

    warn.mockClear()
    encodeGif([gradient()], { fps: 20 })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('encodes to the same bytes whether paced or not', async () => {
    /* The async path exists only to yield between frames so the tab stays alive
       during a multi-second encode. If it produced different output, the
       progress-reporting variant would be a second encoder to keep true. */
    const frames = [0, 1, 2, 3, 4].map((i) => gradient(64, 32, i * 6))
    const sync = encodeGif(frames, { fps: 20 })
    const paced = await encodeGifAsync(frames, { fps: 20 })
    expect(Array.from(paced)).toEqual(Array.from(sync))
  })

  it('reports progress for every frame it writes', async () => {
    const frames = [0, 1, 2, 3, 4, 5].map((i) => gradient(48, 24, i * 4))
    const seen: Array<[number, number]> = []
    await encodeGifAsync(frames, { fps: 20, onProgress: (d, t) => seen.push([d, t]) })
    expect(seen).toHaveLength(frames.length)
    expect(seen.at(-1)).toEqual([frames.length, frames.length])
  })

  it('honours the palette size', () => {
    /* A two-colour palette has to produce a smaller file than a full one for
       the same gradient, or the colour count is being ignored. */
    const frames = [gradient(96, 64)]
    const few = encodeGif(frames, { fps: 20, colors: 4, dither: 0 }).length
    const many = encodeGif(frames, { fps: 20, colors: 256, dither: 0 }).length
    expect(few).toBeLessThan(many)
  })
})
