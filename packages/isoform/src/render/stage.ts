/**
 * Stage — renderer, scene, light rig, ground and grid in one place.
 *
 * The catalog's scissor-rect-per-tile trick is deliberately not here; it is the
 * right technique for a grid of independent scenes and comes back for palette
 * thumbnails, but an editor viewport is one scene filling one canvas.
 */

import * as THREE from 'three'
import { createRenderer, environmentTexture, makeRig, type Rig } from '../foundry/env.js'
import { stageBackground } from '../foundry/textures.js'

export interface StageOptions {
  canvas: HTMLCanvasElement
  /** Extent of the datum grid, in units. */
  gridExtent?: number
  shadowMapSize?: number
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig: Rig
  readonly grid: THREE.GridHelper
  readonly ground: THREE.Mesh

  constructor(opts: StageOptions) {
    this.renderer = createRenderer({ canvas: opts.canvas })

    /* The studio backdrop, not a flat fill. This is also what makes cast
       shadows visible: a ShadowMaterial darkens whatever is behind it, and
       against a near-black ground there is nothing left to darken. */
    this.scene.background = stageBackground()
    this.scene.environment = environmentTexture(this.renderer)
    this.rig = makeRig(this.scene, { shadowMapSize: opts.shadowMapSize ?? 2048 })

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.38 }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    const extent = opts.gridExtent ?? 40
    /* Divisions at the 0.25u grid unit. */
    this.grid = new THREE.GridHelper(extent, extent * 4, 0x2a3140, 0x1c222c)
    const gm = this.grid.material as THREE.Material
    gm.transparent = true
    gm.opacity = 0.42
    this.grid.position.y = -0.002
    fadeGridEdge(gm, extent)
    this.scene.add(this.grid)
  }

  setGridVisible(on: boolean): void {
    this.grid.visible = on
  }

  /**
   * Resize the drawing buffer, leaving layout to CSS.
   *
   * `updateStyle: false` requires the canvas to carry an explicit CSS size. With
   * neither, the element lays out at its *intrinsic* backing-store size, so at
   * devicePixelRatio 1.5 a 1280×720 viewport gets a 1920×1080 canvas anchored
   * top-left — the view reads as zoomed and off-centre and every pointer
   * coordinate is off by the same factor.
   *
   * Writing the style here instead is worse: an inline size beats the
   * stylesheet, so one call made before layout settles (a pane that momentarily
   * reports zero) pins the canvas at 0×0 permanently. CSS holds it at 100%, and
   * callers measure the result with getBoundingClientRect.
   */
  resize(width: number, height: number): void {
    if (width < 1 || height < 1) return
    /* Re-read devicePixelRatio each time: it changes with browser zoom and when
       a window moves between displays, and a ratio captured once at startup
       leaves the buffer soft or needlessly large afterwards. */
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
  }

  /** Refit the shadow camera. A fixed extent turns shadows to mush at scale. */
  fitShadow(bounds: THREE.Box3): void {
    const size = bounds.getSize(new THREE.Vector3())
    this.rig.fitShadow(
      Math.max(Math.max(size.x, size.z) * 0.62, 3),
      bounds.getCenter(new THREE.Vector3()),
    )
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.renderer.dispose()
  }
}

/** Fade the datum grid out toward its edge instead of ending on a hard line. */
function fadeGridEdge(mat: THREE.Material, extent: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vLocal;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLocal = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vLocal;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `float d = length(vLocal.xz) / ${(extent / 2).toFixed(1)};
         diffuseColor.a *= 1.0 - smoothstep(0.35, 1.0, d);
         #include <opaque_fragment>`,
      )
  }
}
