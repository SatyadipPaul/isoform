/**
 * Render a document to an image, with no editor and no page furniture.
 *
 * Everything this does can be assembled from the pieces already exported —
 * `Stage`, `Reconciler`, `frame`, `renderPng` — and that is exactly the problem.
 * It took fourteen statements, an off-screen canvas nobody thinks to create, a
 * direct `three` import for one `PerspectiveCamera`, and a `dispose` that is
 * easy to forget and leaks a WebGL context every time it is. Producing a picture
 * from a document is a first-class thing to want; it should be one call.
 *
 * Runs anywhere there is a WebGL context — a headless browser in CI, a worker,
 * a thumbnail service. It does not need a visible canvas, only a real one.
 */

import * as THREE from 'three'
import type { Doc } from '../doc/schema.js'
import { palette } from '../foundry/materials.js'
import { renderPng } from '../io/png.js'
import { HERO_FOV, PRESET_POSE, frame, frameOrtho, framePoints } from './camera.js'
import { Reconciler } from './reconciler.js'
import { Stage } from './stage.js'
import { resolvePose, type CameraPose } from './shots.js'

export interface SnapshotOptions {
  /** Output width in pixels. Height follows from `aspect`. */
  width?: number
  /** Width ÷ height. */
  aspect?: number
  /** Camera pose. `hero` is the locked 32° perspective; the others orthographic. */
  preset?: 'hero' | 'iso' | 'top'
  /**
   * An explicit camera instead of a preset. Perspective; ignores `preset`.
   *
   * The presets frame anything acceptably and nothing perfectly. Framing fits the
   * diagram's axis-aligned box, so a system laid out along one axis and viewed at
   * the hero's 34° azimuth lands on screen as a diagonal — and the corners of the
   * box it is fitted to are empty, which is how the README hero ended up filling
   * barely half its frame. Turning the camera to put the long axis across the
   * frame is the fix, and it is a property of the diagram, not of the library.
   */
  pose?: CameraPose
  /** Draw the nameplates. */
  labels?: boolean
  /** Draw the reference grid. Off by default — a published image rarely wants it. */
  grid?: boolean
  /** World units of clearance around the diagram. */
  padding?: number
  /**
   * Nodes to emphasise. Everything else dims toward the backdrop.
   *
   * The argument the picture is making, held apart from the document making it:
   * one diagram supports as many framings as there are subsets worth pointing
   * at, and rendering six of them should not mean six documents. Omit — or pass
   * an empty list — for no emphasis at all.
   */
  focus?: Iterable<string>
  /**
   * Id of a trace to draw, paused partway through.
   *
   * A still of a moving thing, which is the only kind a PNG can hold — and the
   * unit a storyboard is built from. The trace's own path is focused unless
   * `focus` says otherwise, since the argument being made is about that path.
   */
  trace?: string
  /** How far through the trace to pause, 0..1. Defaults to the midpoint. */
  traceAt?: number
  /**
   * Transparent background instead of the studio backdrop.
   *
   * `renderPng` has supported this since it was written and nothing exposed it,
   * so every image anyone exported carried the opaque dark backdrop — dropped
   * into a light-themed README that is a black rectangle in the middle of the
   * page.
   */
  transparent?: boolean
  /**
   * Reuse an existing canvas instead of creating one.
   *
   * Rendering many documents in a row otherwise burns a WebGL context apiece,
   * and browsers cap how many may be live at once — around sixteen, after which
   * the oldest is silently killed and its output comes back blank.
   */
  canvas?: HTMLCanvasElement
}

/**
 * Render `doc` and return a PNG data URL.
 *
 * The document is not modified. Nodes are drawn where they sit, so a document
 * straight out of `parseDsl` — every node at the origin — wants `layout` run
 * over it first.
 */
export function renderDocument(doc: Doc, opts: SnapshotOptions = {}): string {
  const width = opts.width ?? 1920
  const aspect = opts.aspect ?? 16 / 9
  const preset = opts.preset ?? 'hero'
  const padding = opts.padding ?? 0.6

  const canvas = opts.canvas ?? document.createElement('canvas')
  const stage = new Stage({ canvas })
  const reconciler = new Reconciler(stage.scene, { anchorIdle: palette('link').lit('lit', 0.9) })

  try {
    reconciler.sync(doc)
    /* Everything merged: no node is selected or hovered, so nothing has a reason
       to carry its articulated rig. Animation is frozen either way in a still. */
    reconciler.updateDetail({ detailed: [], fullBelow: 0 })

    const trace = opts.trace ? doc.traces.find((t) => t.id === opts.trace) : undefined
    if (opts.trace && !trace) console.warn(`[isoform] no trace "${opts.trace}" in this document`)
    if (trace) {
      const res = reconciler.trace.load(trace)
      for (const g of res.gaps) {
        console.warn(`[isoform] trace "${trace.id}": no connector from "${g.from}" to "${g.to}"`)
      }
      reconciler.trace.seek(opts.traceAt ?? 0.5)
    }

    /* An explicit focus wins; otherwise a trace focuses its own path, because a
       picture of a request is a picture of the parts it touches. */
    reconciler.setFocus(opts.focus ?? trace?.path ?? null)
    reconciler.setLabelsVisible(opts.labels !== false)
    stage.setGridVisible(opts.grid === true)

    const bounds = reconciler.bounds().expandByScalar(padding)
    const pose = PRESET_POSE[preset]
    /* Framed against what is drawn rather than the box around it — see
       `framePoints`. The padding still comes from `bounds`, which is where it
       has always been expressed. */
    const content = reconciler.contentPoints()
    const centre = bounds.getCenter(new THREE.Vector3())
    const margin = 1.06 + padding / 20
    const fitPerspective = (az: number, el: number) =>
      content.length
        ? framePoints(content, centre, az, el, HERO_FOV, aspect, margin)
        : frame(bounds, az, el, HERO_FOV, aspect, margin)

    let camera: THREE.Camera
    if (opts.pose) {
      const p = resolvePose(opts.pose)
      const f = fitPerspective(p.az, p.el)
      const persp = new THREE.PerspectiveCamera(HERO_FOV, aspect, 0.1, 500)
      const target = p.target ? new THREE.Vector3(...p.target) : f.target
      const dir = new THREE.Vector3(
        Math.cos(p.el) * Math.sin(p.az),
        Math.sin(p.el),
        Math.cos(p.el) * Math.cos(p.az),
      ).normalize()
      persp.position.copy(target).addScaledVector(dir, f.dist * p.zoom)
      persp.lookAt(target)
      camera = persp
    } else if (preset === 'hero') {
      const f = fitPerspective(pose.az, pose.el)
      const persp = new THREE.PerspectiveCamera(HERO_FOV, aspect, 0.1, 500)
      persp.position.copy(f.position)
      persp.lookAt(f.target)
      camera = persp
    } else {
      const f = frameOrtho(bounds, pose.az, pose.el, aspect)
      const ortho = new THREE.OrthographicCamera(
        -f.halfHeight * aspect,
        f.halfHeight * aspect,
        f.halfHeight,
        -f.halfHeight,
        -200,
        500,
      )
      ortho.position.copy(f.position)
      ortho.lookAt(f.target)
      camera = ortho
    }
    camera.updateMatrixWorld(true)

    stage.fitShadow(bounds)
    /* Nameplates billboard toward the camera, and the camera only exists now. */
    reconciler.orientLabels(camera)

    return renderPng(stage.renderer, stage.scene, camera, {
      width,
      aspect,
      transparent: opts.transparent,
      hide: [reconciler.anchorLayer],
    })
  } finally {
    /* A WebGL context is a scarce, non-collectable resource. Released even when
       the render throws — the alternative is a service that works for its first
       dozen requests and then returns blank images with no error. */
    stage.dispose()
  }
}
