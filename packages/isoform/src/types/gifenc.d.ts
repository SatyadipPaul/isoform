/**
 * Types for `gifenc`, which ships none.
 *
 * Hand-written against `node_modules/gifenc/src/index.js` rather than guessed.
 * Only the surface `export/gif.ts` actually uses is declared — a fuller
 * declaration would be more to keep true and none of it would be exercised.
 */
declare module 'gifenc/dist/gifenc.esm.js' {
  /** RGB triples. GIF has no alpha in its colour table. */
  export type GifPalette = number[][]

  export interface WriteFrameOptions {
    /**
     * Required on the first frame, which writes the global colour table.
     *
     * Passing it on later frames makes gifenc emit a *local* table per frame —
     * so a global palette means supplying it exactly once.
     */
    palette?: GifPalette
    /** Milliseconds. Rounded to centiseconds internally; GIF has no finer unit. */
    delay?: number
    /** -1 once, 0 forever, >0 a count. Only read on the first frame. */
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
    first?: boolean
    colorDepth?: number
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void
    finish(): void
    /* Pinned to `ArrayBuffer`, not the default `ArrayBufferLike`, which also
       admits a `SharedArrayBuffer` — `Blob` refuses those, so leaving it open
       makes every caller cast. gifenc allocates plain buffers. */
    bytes(): Uint8Array<ArrayBuffer>
    bytesView(): Uint8Array<ArrayBuffer>
    reset(): void
  }

  export function GIFEncoder(opts?: {
    initialCapacity?: number
    auto?: boolean
  }): GifEncoderInstance

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean; clearAlpha?: boolean },
  ): GifPalette

  /** Nearest-colour lookup. Does no dithering — see `export/gif.ts`. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array
}
