/**
 * Headless canvas, so part geometry can be tested in plain node.
 *
 * The foundry builds its normal and roughness maps by drawing into a 2D canvas.
 * That is the only thing standing between the test suite and every part
 * builder — and the textures it produces affect only how a surface *looks*, not
 * where any vertex sits. So the invariants worth testing (footprints, bounds,
 * anchor heights, which meshes animate) need the canvas to exist, not to draw.
 *
 * A no-op stub rather than jsdom: jsdom ships no 2D context, so it would fail
 * in the same place while costing a heavyweight dependency and a slower suite.
 * The whole API surface used is eleven write-only calls plus `getImageData`,
 * enumerated below — small enough to stub honestly.
 *
 * Installed only when there is no real `document`, so this never shadows a
 * browser environment.
 *
 * Text properties — `font`, `textAlign`, `textBaseline` — need no stubbing: they
 * are plain assignments and land on the object like any other field.
 */

class StubImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a
      this.height = b
      this.data = new Uint8ClampedArray(a * b * 4)
    } else {
      this.data = a
      this.width = b
      this.height = c ?? a.length / 4 / b
    }
  }
}

function stubContext(canvas: { width: number; height: number }): unknown {
  return {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    drawImage() {},
    putImageData() {},
    /* Nameplates draw their text into a canvas. Like every other call here it is
       write-only: the glyphs land in a texture, and a texture cannot move a
       vertex. What the label *does* affect geometrically is the plate's size,
       and that comes from `measureText` below, which returns a real width. */
    fillText() {},
    /* Zeroed rather than absent: `heightToNormal` reads these back, and a null
       would surface as a crash far from here. Flat pixels give a flat normal
       map, which is exactly the right answer for a test that ignores shading. */
    getImageData: (_x: number, _y: number, w: number, h: number) =>
      new StubImageData(new Uint8ClampedArray(w * h * 4), w, h),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (t: string) => ({ width: t.length * 8 }),
  }
}

if (typeof globalThis.document === 'undefined') {
  const doc = {
    createElement(tag: string) {
      if (tag !== 'canvas') return {}
      const c = {
        width: 0,
        height: 0,
        getContext: (kind: string) => (kind === '2d' ? stubContext(c) : null),
      }
      return c
    },
    fonts: { ready: Promise.resolve() },
  }
  Object.assign(globalThis, { document: doc, ImageData: StubImageData })
}
