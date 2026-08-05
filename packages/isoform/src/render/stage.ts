/**
 * Stage — renderer, scene, light rig, ground and grid in one place.
 *
 * The catalog's scissor-rect-per-tile trick is deliberately not here; it is the
 * right technique for a grid of independent scenes and comes back for palette
 * thumbnails, but an editor viewport is one scene filling one canvas.
 */

import * as THREE from 'three'
import { createRenderer, environmentTexture, makeRig, type Rig } from '../foundry/env.js'
import { roundedBox } from '../foundry/geometry.js'
import { palette } from '../foundry/materials.js'
import { stageBackground } from '../foundry/textures.js'

export interface StageOptions {
  canvas: HTMLCanvasElement
  /** Extent of the datum grid, in units. */
  gridExtent?: number
  shadowMapSize?: number
}

/**
 * Where the backdrop's gradient has settled by the time it is behind the
 * diagram. Depth cueing fades toward this, so a mismatch reads as haze on the
 * far parts rather than as distance — the fade has to arrive at the colour that
 * is actually there.
 */
const CUE_COLOR = 0x141922

/** Thickness of the stage plate. Thin enough to read as a plate, not a plinth. */
const PLATE_THICKNESS = 0.18

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig: Rig
  readonly grid: THREE.GridHelper
  readonly ground: THREE.Mesh
  /** The finite plate the diagram sits on. Hidden until `fitPlate` sizes it. */
  readonly plate: THREE.Mesh

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

    /* Unit-sized and scaled to fit, so changing the diagram never rebuilds the
       geometry — a plate resized per render would allocate and upload a new
       buffer on every frame of an export. */
    /* Powder-coated, not steel, and deaf to the environment.
       Two corrections, both found by looking at it. `steel` is fully metallic
       and a metal has no diffuse colour at all — it shows the environment
       instead, so the dark grey asked for came back as a sheet of warm brown.
       Switching to a matte finish barely helped: the rig carries a warm bounce
       panel and a `0xffd2a0` rim, and a large horizontal surface is exactly what
       collects them, which the invisible shadow-catcher this replaces never did.
       Dropping `envMapIntensity` leaves the plate lit by the key alone, and dark
       enough to sit under the diagram rather than compete with it. */
    const plateMat = palette('link').rubber(0x141922)
    /* Set after construction, not passed in: every finish writes its own
       roughness and metalness last, so the same names in `MatOpts` are silently
       overridden and the plate keeps whatever the finish decided. */
    plateMat.metalness = 0
    plateMat.roughness = 1
    plateMat.envMapIntensity = 0.1
    this.plate = new THREE.Mesh(roundedBox(1, PLATE_THICKNESS, 1, 0.04), plateMat)
    this.plate.receiveShadow = true
    this.plate.visible = false
    this.scene.add(this.plate)
  }

  setGridVisible(on: boolean): void {
    this.grid.visible = on
  }

  setPlateVisible(on: boolean): void {
    this.plate.visible = on
  }

  /**
   * Size the stage plate to the diagram and show it.
   *
   * The plate sits *below* y=0 rather than at it, so the shadow-catching ground
   * stays the topmost surface at the origin. Putting an opaque plate at the same
   * height instead z-fights with it, which reads as the shadows flickering in
   * and out as the camera moves — and does so only on some GPUs, which is the
   * worst way for it to be discovered.
   */
  fitPlate(bounds: THREE.Box3, margin = 0.9): void {
    const size = bounds.getSize(new THREE.Vector3())
    const centre = bounds.getCenter(new THREE.Vector3())
    this.plate.scale.set(size.x + margin * 2, 1, size.z + margin * 2)
    this.plate.position.set(centre.x, -PLATE_THICKNESS / 2 - 0.004, centre.z)
    this.plate.visible = true
  }

  /**
   * Fade distant geometry toward the backdrop.
   *
   * Depth cueing is what makes a crowded diagram legible without moving
   * anything: two parts that overlap on screen stop being ambiguous once the
   * further one is visibly further. It does not *unhide* anything — a part
   * behind another is still behind it — so it changes how the picture reads
   * rather than what it contains.
   *
   * Fitted to the camera because three.js fog is measured from the eye. A fixed
   * near and far would fade correctly at one distance and either do nothing or
   * swallow the whole diagram at any other, and the camera moves constantly
   * during an export.
   *
   * Fitted to the diagram's **actual depth along the view axis**, measured from
   * the corners of its bounds, and not to its bounding-sphere radius. Those are
   * wildly different for the shape most system diagrams are: a wide, shallow
   * fan. On the Netflix example the sphere radius is 14.7 units while the depth
   * spread is a fraction of that, so a range derived from the radius put the
   * whole diagram inside the first few percent of the fade and the cue was
   * invisible at every strength — the arithmetic said the far parts were 87%
   * hazed and the render disagreed, because the parts it called far were not
   * far, only off to one side.
   *
   * @param strength How faded the furthest part ends up, 0..1. 0 disables. The
   *   range is measured per diagram, so this means the same thing for a
   *   four-node sketch and a hundred-node system.
   */
  fitDepthCue(bounds: THREE.Box3, camera: THREE.Camera, strength = 0): void {
    if (strength <= 0) {
      this.scene.fog = null
      return
    }
    const { min, max } = depthSpan(bounds, camera.getWorldPosition(new THREE.Vector3()))
    if (!(max > min)) {
      this.scene.fog = null
      return
    }

    const s = Math.min(strength, 1)
    /* The nearest content sits exactly at `near`, so it is untouched, and the
       furthest lands `s` of the way along the ramp. Solving
       (max - near) / (far - near) = s for `far` is the whole fit. */
    const near = min
    const far = near + (max - near) / s
    const fog = this.scene.fog instanceof THREE.Fog ? this.scene.fog : new THREE.Fog(CUE_COLOR)
    fog.color.setHex(CUE_COLOR)
    fog.near = near
    fog.far = far
    this.scene.fog = fog
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

/**
 * Nearest and furthest distance from `eye` to the corners of `bounds`.
 *
 * Pure, exported and tested because getting it wrong is silent. The tempting
 * shorthand is the bounding sphere — centre distance ± radius — and it is only
 * correct for a diagram as deep as it is wide. System diagrams are typically
 * wide and shallow, where the radius is set by the horizontal span and describes
 * a depth the picture does not have. Depth cueing fitted that way put every part
 * inside the first few percent of the fade and did visibly nothing, while the
 * arithmetic insisted the far parts were 87% hazed.
 */
export function depthSpan(
  bounds: THREE.Box3,
  eye: THREE.Vector3,
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  const corner = new THREE.Vector3()
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const d = corner.set(x, y, z).distanceTo(eye)
        min = Math.min(min, d)
        max = Math.max(max, d)
      }
    }
  }
  return { min, max }
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
