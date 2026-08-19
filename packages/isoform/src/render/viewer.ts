/**
 * A diagram you can look around, and nothing else.
 *
 * The missing middle. There was `createEditor` — palette, inspector, undo,
 * gizmos — and `renderDocument`, which is a camera and no interaction at all.
 * Nothing between them, so putting a diagram on a page meant shipping editing
 * affordances to someone who only wanted to read it.
 *
 * This is also the primitive the self-contained HTML export is built from: the
 * exported file is this viewer, three.js and the document inlined into one page.
 * A picture throws away the one thing that makes the library worth using — that
 * the parts are modelled and you can move around them — and this is what carries
 * it out of the browser it was authored in.
 *
 * ## Not built on `createEditor`, deliberately
 *
 * The editor is 1700 lines with viewing concerns woven through selection,
 * history and tool state. Converging the two is worth doing and is its own
 * change with its own risk; assembling the viewer directly is ~200 lines of
 * well-understood setup. The duplicated render loop and resize handling are a
 * real cost, recorded here rather than hidden.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CameraPreset, Doc } from '../doc/schema.js'
import { palette } from '../foundry/materials.js'
import { HERO_FOV, frame } from './camera.js'
import { Reconciler } from './reconciler.js'
import { Stage } from './stage.js'
import { resolvePose, type CameraPose } from './shots.js'

export interface ViewerOptions {
  doc: Doc
  /** Opening camera. Defaults to `hero`. */
  view?: Exclude<CameraPreset, 'free'> | CameraPose
  /** Let the reader orbit. Default true — it is the reason this exists. */
  controls?: boolean
  labels?: boolean
  grid?: boolean
  /** Radians per second of idle spin. 0 is off. */
  autoRotate?: number
  /** Transparent instead of the studio backdrop, for a light-themed host page. */
  transparent?: boolean
}

export type ViewerEvent = 'select' | 'hover'

export interface Viewer {
  readonly element: HTMLCanvasElement
  readonly doc: Doc
  load(doc: Doc): void
  /** Re-frame on the whole diagram. */
  fit(): void
  setView(view: Exclude<CameraPreset, 'free'> | CameraPose): void
  /** The camera as it stands, in orbit space — for authoring shots by eye. */
  pose(): CameraPose
  focus(ids: Iterable<string> | null): void
  /**
   * Light the connectors of one part — incoming cool, outgoing warm, each with a
   * shine running the direction it carries. `null` clears it.
   *
   * A click does this already; this is for a host driving the view from its own
   * UI, so a list selection on the page and a click in the canvas agree.
   */
  emphasise(nodeId: string | null): void
  /** False when the trace is missing or has nothing drawable in it. */
  playTrace(id: string): boolean
  pauseTrace(): void
  seekTrace(u: number): void
  readonly playing: boolean
  on(event: ViewerEvent, fn: (id: string | null) => void): () => void
  resize(): void
  destroy(): void
}

/** Below this, a pointer gesture is a click rather than an orbit. */
const CLICK_SLOP = 4

export function createViewer(container: HTMLElement, opts: ViewerOptions): Viewer {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  /* The container is not cleared: a viewer is a thing you put *in* a page, and
     silently emptying whatever it was given is how a library eats a layout. */
  container.appendChild(canvas)

  const stage = new Stage({ canvas })
  const reconciler = new Reconciler(stage.scene, { anchorIdle: palette('link').lit('lit', 0.9) })
  if (opts.transparent) stage.scene.background = null

  let doc = opts.doc
  const camera = new THREE.PerspectiveCamera(HERO_FOV, 1, 0.1, 500)
  /* Off-target on purpose. OrbitControls converts (position − target) to
     spherical coordinates in its constructor, and a zero-length offset makes
     that degenerate — every later update then feeds NaN into the camera
     position and the frame comes out empty with no error anywhere. */
  camera.position.set(12, 10, 18)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  controls.enabled = opts.controls !== false
  controls.autoRotate = (opts.autoRotate ?? 0) !== 0
  /* OrbitControls counts autoRotate in degrees per *frame at 60fps*, not per
     second, so the option is converted rather than passed through. */
  controls.autoRotateSpeed = THREE.MathUtils.radToDeg(opts.autoRotate ?? 0) / 6

  const listeners: Record<ViewerEvent, Set<(id: string | null) => void>> = {
    select: new Set(),
    hover: new Set(),
  }
  const emit = (e: ViewerEvent, id: string | null): void => {
    for (const fn of listeners[e]) fn(id)
  }

  /* ---- sizing ---- */

  function size(): { w: number; h: number } {
    const r = canvas.getBoundingClientRect()
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) }
  }

  function resize(): void {
    const { w, h } = size()
    stage.resize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const ro = new ResizeObserver(() => resize())
  ro.observe(container)

  /* ---- camera ---- */

  function bounds(): THREE.Box3 {
    return reconciler.bounds().expandByScalar(0.6)
  }

  function setView(view: Exclude<CameraPreset, 'free'> | CameraPose): void {
    const p = resolvePose(view)
    const b = bounds()
    const { w, h } = size()
    const f = frame(b, p.az, p.el, HERO_FOV, w / h)
    const target = p.target ? new THREE.Vector3(...p.target) : f.target
    const dir = new THREE.Vector3(
      Math.cos(p.el) * Math.sin(p.az),
      Math.sin(p.el),
      Math.cos(p.el) * Math.cos(p.az),
    ).normalize()
    camera.position.copy(target).addScaledVector(dir, f.dist * p.zoom)
    controls.target.copy(target)
    controls.update()
  }

  function pose(): CameraPose {
    const offset = camera.position.clone().sub(controls.target)
    const dist = offset.length()
    const b = bounds()
    const { w, h } = size()
    const el = Math.asin(THREE.MathUtils.clamp(offset.y / dist, -1, 1))
    const az = Math.atan2(offset.x, offset.z)
    /* Reported as a multiplier on the fit distance, matching how a `Shot` reads
       — an absolute distance stops meaning anything the moment the diagram
       changes size. */
    const fit = frame(b, az, el, HERO_FOV, w / h).dist
    return {
      az,
      el,
      zoom: fit > 0 ? dist / fit : 1,
      target: [controls.target.x, controls.target.y, controls.target.z],
    }
  }

  /* ---- picking ---- */

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()

  function pickAt(e: PointerEvent): string | null {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(reconciler.proxies, false)[0]
    return hit ? (hit.object.userData.nodeId as string) : null
  }

  let downAt: { x: number; y: number } | null = null
  let hovered: string | null = null

  const onDown = (e: PointerEvent): void => {
    downAt = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: PointerEvent): void => {
    /* Only a click if the pointer barely moved — otherwise every orbit would
       end by selecting whatever happened to be under the release. */
    if (!downAt) return
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
    downAt = null
    if (moved > CLICK_SLOP) return
    const picked = pickAt(e)
    /* Light the picked part's connectors before telling anyone it was picked, so
       a host that re-renders on the event sees the emphasis already applied.
       Clicking empty space clears it, which is the only way back for a reader
       with no keyboard. */
    reconciler.setEmphasis(picked)
    emit('select', picked)
  }
  const onMove = (e: PointerEvent): void => {
    if (!listeners.hover.size) return
    const id = pickAt(e)
    if (id === hovered) return
    hovered = id
    canvas.style.cursor = id ? 'pointer' : ''
    emit('hover', id)
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointermove', onMove)

  /* ---- boot ---- */

  function sync(next: Doc): void {
    doc = next
    reconciler.sync(next)
    reconciler.setLabelsVisible(opts.labels !== false)
    stage.setGridVisible(opts.grid === true)
    /* Everything merged. A reader is not selecting anything, and the articulated
       rigs would cost draw calls for animation nobody asked to see. */
    reconciler.updateDetail({ detailed: [], fullBelow: 0 })
    stage.fitShadow(bounds())
  }

  sync(doc)
  resize()
  setView(opts.view ?? 'hero')

  const timer = new THREE.Timer()
  stage.renderer.setAnimationLoop(() => {
    timer.update()
    reconciler.tick(timer.getElapsed())
    controls.update()
    reconciler.orientLabels(camera)
    stage.renderer.render(stage.scene, camera)
  })

  let destroyed = false

  return {
    element: canvas,
    get doc() {
      return doc
    },
    load(next) {
      sync(next)
      setView(opts.view ?? 'hero')
    },
    fit() {
      setView(pose())
    },
    setView,
    pose,
    focus: (ids) => reconciler.setFocus(ids),
    playTrace(id) {
      const t = doc.traces.find((x) => x.id === id)
      if (!t) return false
      const res = reconciler.trace.load(t)
      if (!res.playable) return false
      reconciler.setFocus(t.path)
      reconciler.trace.play()
      return true
    },
    pauseTrace: () => reconciler.trace.pause(),
    seekTrace: (u) => reconciler.trace.seek(u),
    get playing() {
      return reconciler.trace.isPlaying
    },
    on(event, fn) {
      listeners[event].add(fn)
      return () => listeners[event].delete(fn)
    },
    emphasise: (id) => reconciler.setEmphasis(id),
    resize,
    destroy() {
      if (destroyed) return
      destroyed = true
      stage.renderer.setAnimationLoop(null)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      controls.dispose()
      stage.dispose()
      canvas.remove()
    },
  }
}
