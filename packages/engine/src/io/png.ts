/**
 * PNG export.
 *
 * Renders off-screen at a chosen width rather than scaling the visible canvas,
 * so an export is not limited by the window it was taken from. Animations are
 * frozen and the datum grid hidden: a published diagram wants the parts, not the
 * scaffolding the editor uses to place them.
 */

import * as THREE from 'three'

export interface PngOptions {
  width?: number
  /** Aspect to render at. Defaults to the live camera's. */
  aspect?: number
  /** Multisampling for the off-screen target. */
  samples?: number
  /** Objects to hide for the duration — the grid, anchors, selection outlines. */
  hide?: THREE.Object3D[]
  /** Transparent background instead of the studio backdrop. */
  transparent?: boolean
}

/**
 * Render `scene` from `camera` and return a PNG data URL.
 *
 * Restores every renderer and scene setting it touches, including on the error
 * path — an export must not be able to leave the editor in a broken state.
 */
export function renderPng(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  o: PngOptions = {},
): string {
  const width = Math.max(64, Math.round(o.width ?? 3840))
  const persp = camera as THREE.PerspectiveCamera
  const aspect = o.aspect ?? (persp.isPerspectiveCamera ? persp.aspect : 16 / 9)
  const height = Math.max(64, Math.round(width / aspect))

  const target = new THREE.WebGLRenderTarget(width, height, { samples: o.samples ?? 4 })
  target.texture.colorSpace = THREE.SRGBColorSpace

  const prevTarget = renderer.getRenderTarget()
  const prevScissor = renderer.getScissorTest()
  const prevBackground = scene.background
  const hidden = (o.hide ?? []).map((obj) => [obj, obj.visible] as const)

  try {
    for (const [obj] of hidden) obj.visible = false
    if (o.transparent) scene.background = null

    renderer.setScissorTest(false)
    renderer.setRenderTarget(target)
    renderer.setViewport(0, 0, width, height)
    renderer.clear(true, true, true)
    renderer.render(scene, camera)

    const buf = new Uint8Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, buf)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Isoform: 2D context unavailable for PNG export')
    const img = ctx.createImageData(width, height)
    /* GL reads bottom-up; flip into image order. */
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4
      img.data.set(buf.subarray(src, src + width * 4), y * width * 4)
    }
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    for (const [obj, was] of hidden) obj.visible = was
    scene.background = prevBackground
    renderer.setRenderTarget(prevTarget)
    renderer.setScissorTest(prevScissor)
    target.dispose()
  }
}

export function downloadPng(dataUrl: string, filename = 'diagram.png'): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
