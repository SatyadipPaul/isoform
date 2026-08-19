/**
 * Measure what a design critique would otherwise only assert.
 *
 * "The labels collide" and "the diagram is sparse" are opinions until they are
 * counted. Everything here is computed from the scene `renderDocument` draws —
 * literally that scene, via `stageDocument` — projected through that camera, so
 * a number moving means the picture moved and not that the reviewer's mood did.
 *
 * The intended caller is an agent with no eyes. It can render a document, but it
 * cannot look at the result and notice that two nameplates are stacked; this
 * gives it the finding, and `notes` gives it the finding in words.
 *
 * ## Two mistakes this has already made
 *
 * A metric is code that nobody looks at the output of, which makes a wrong one
 * unusually durable. Both of these read as plausible numbers for weeks:
 *
 *  - **Coverage by thresholding brightness.** Reported width pinned at 51%
 *    across every camera angle and aspect, because a 4× downscale erased the
 *    dark client monitor. It nearly justified tuning the camera to fix a bug in
 *    the ruler.
 *  - **Screen rectangles from world AABBs.** A nameplate turns to face the
 *    camera, so it is never axis-aligned, and the box containing a tilted
 *    rectangle is far bigger than the rectangle. Two plates with clear air
 *    between them measured as 34% overlapped.
 *
 * The lesson kept here: measure in the object's own space and carry the corners
 * through its world matrix, and never let the measuring scene be a
 * reconstruction of the rendered one.
 */

import * as THREE from 'three'
import type { Doc } from '../doc/schema.js'
import { stageDocument, type SnapshotOptions, type StagedDocument } from './snapshot.js'
import { PRESET_POSE } from './camera.js'
import type { CameraPose } from './shots.js'

export interface Critique {
  /** Pairs of nameplates whose screen rectangles intersect. */
  labelCollisions: number
  /** Worst overlap between any two plates, as a fraction of the smaller. 0..1. */
  worstOverlap: number
  /** Share of the frame the parts span, as a fraction of its area. 0..1. */
  frameUse: number
  /** Largest part's screen area ÷ the median. Visual hierarchy, such as it is. */
  weightRange: number
  /** Parts whose centre is hidden behind other geometry from this camera. */
  occluded: number
  /** Ids of those parts, so a caller can act rather than only report. */
  occludedIds: string[]
  /** Plates crossing the frame edge, which is a label the reader cannot finish. */
  clipped: number
  /**
   * The findings in words, worst first, or empty when there is nothing to say.
   *
   * Written for something that will paste them into a review, so each names the
   * measurement and the threshold it failed rather than only an adjective.
   */
  notes: string[]
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const area = (r: Rect): number => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Screen rectangle of an object, in NDC, from its *oriented* bounds.
 *
 * Measured in the object's own space and carried through its world matrix, which
 * keeps a rectangle a rectangle. See the header for what the axis-aligned
 * version reported instead.
 */
function screenRect(obj: THREE.Object3D, camera: THREE.Camera): Rect | null {
  obj.updateWorldMatrix(true, true)
  const toLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert()

  const local = new THREE.Box3()
  const scratch = new THREE.Box3()
  const rel = new THREE.Matrix4()
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const bb = mesh.geometry.boundingBox
    if (!bb) return
    scratch.copy(bb).applyMatrix4(rel.multiplyMatrices(toLocal, mesh.matrixWorld))
    local.union(scratch)
  })
  if (local.isEmpty()) return null

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const p = new THREE.Vector3()
  for (const x of [local.min.x, local.max.x]) {
    for (const y of [local.min.y, local.max.y]) {
      for (const z of [local.min.z, local.max.z]) {
        p.set(x, y, z).applyMatrix4(obj.matrixWorld).project(camera)
        x0 = Math.min(x0, p.x)
        x1 = Math.max(x1, p.x)
        y0 = Math.min(y0, p.y)
        y1 = Math.max(y1, p.y)
      }
    }
  }
  return { x0, y0, x1, y1 }
}

/** Thresholds a note is worth writing at, kept together so they can be argued with. */
const WORTH_SAYING = {
  /** Any collision at all is worth a note; plates are the readable layer. */
  overlap: 0.001,
  /** Below this the diagram reads as a small object in a large empty frame. */
  frameUse: 0.5,
  /** Above this, one part dominates and the eye has no second place to go. */
  weightRange: 4,
}

/**
 * Measure the picture `renderDocument` would produce for `doc`.
 *
 * Takes the same options as the renderer, so the numbers describe the image you
 * would actually ship — pass the pose, aspect and padding you intend to export
 * with, or the answer is about a different picture.
 */
export function critique(doc: Doc, opts: SnapshotOptions = {}): Critique {
  const staged = stageDocument(doc, { labels: true, ...opts })
  try {
    return measureStaged(staged)
  } finally {
    staged.dispose()
  }
}

/**
 * Measure an already-built scene through its current camera.
 *
 * Split out so a pose search can stage once and re-aim, rather than rebuilding
 * the whole diagram per candidate.
 */
function measureStaged(staged: StagedDocument): Critique {
  const { reconciler: rec, camera } = staged

  {
    /* Label plates: the face and its backing board, not the leader stem — the
       stem is a hairline and overlapping stems are not what anyone notices. */
    const plates: Rect[] = []
    for (const child of rec.labelLayer.children) {
      if (!(child as THREE.Group).isGroup) continue
      /* A tag the declutter pass dropped is not on screen, so it can neither
         collide nor be clipped. Counting hidden plates would report faults in a
         picture that does not contain them. */
      if (!child.visible) continue
      const r = screenRect(child, camera)
      if (r) plates.push(r)
    }

    let labelCollisions = 0
    let worstOverlap = 0
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const o = overlap(plates[i], plates[j])
        if (o <= 0) continue
        labelCollisions++
        worstOverlap = Math.max(worstOverlap, o / Math.min(area(plates[i]), area(plates[j])))
      }
    }

    /* A plate crossing the frame edge is a name the reader cannot finish. NDC
       runs -1..1, so anything outside that is off-screen. */
    const clipped = plates.filter((r) => r.x0 < -1 || r.x1 > 1 || r.y0 < -1 || r.y1 > 1).length

    /* Frame use and visual weight, from the parts rather than their labels. */
    const partRects: Rect[] = []
    for (const id of rec.endpointIds) {
      const carrier = rec.nodeLayer.children.find((c) => c.userData.nodeId === id)
      if (!carrier) continue
      const r = screenRect(carrier, camera)
      if (r) partRects.push(r)
    }
    let ux0 = Infinity
    let uy0 = Infinity
    let ux1 = -Infinity
    let uy1 = -Infinity
    for (const r of partRects) {
      ux0 = Math.min(ux0, r.x0)
      ux1 = Math.max(ux1, r.x1)
      uy0 = Math.min(uy0, r.y0)
      uy1 = Math.max(uy1, r.y1)
    }
    /* NDC spans 2 in each axis, so halving each side gives a fraction of frame. */
    const frameUse = partRects.length ? ((ux1 - ux0) / 2) * ((uy1 - uy0) / 2) : 0

    const areas = partRects.map(area).sort((a, b) => a - b)
    const median = areas.length ? areas[Math.floor(areas.length / 2)] : 1
    const weightRange = median > 0 ? (areas.at(-1) ?? 0) / median : 1

    /* Occlusion: is a part's own centre the first thing the camera meets? */
    const ray = new THREE.Raycaster()
    const occludedIds: string[] = []
    for (const id of rec.endpointIds) {
      const anchor = rec.anchorOf(id)
      if (!anchor) continue
      const at = anchor.position.clone().setY(anchor.position.y + 0.4)
      ray.set(camera.position, at.clone().sub(camera.position).normalize())
      const hit = ray.intersectObjects(rec.proxies, false)[0]
      if (hit && hit.object.userData.nodeId !== id) occludedIds.push(id)
    }

    const notes: string[] = []
    if (worstOverlap > WORTH_SAYING.overlap) {
      notes.push(
        `${labelCollisions} nameplate pair${labelCollisions === 1 ? '' : 's'} overlap, ` +
          `worst ${(worstOverlap * 100).toFixed(0)}% of the smaller plate hidden.`,
      )
    }
    if (clipped) {
      notes.push(`${clipped} nameplate${clipped === 1 ? '' : 's'} cross the frame edge.`)
    }
    if (occludedIds.length) {
      notes.push(
        `${occludedIds.length} part${occludedIds.length === 1 ? ' is' : 's are'} hidden behind ` +
          `other geometry (${occludedIds.join(', ')}). A different azimuth usually clears it.`,
      )
    }
    if (frameUse < WORTH_SAYING.frameUse) {
      notes.push(
        `The diagram spans ${(frameUse * 100).toFixed(0)}% of the frame. Systems laid out along ` +
          `one axis land diagonally at the hero azimuth; turning the camera to put the long ` +
          `axis across the frame is usually the fix.`,
      )
    }
    if (weightRange > WORTH_SAYING.weightRange) {
      notes.push(
        `The largest part is ${weightRange.toFixed(1)}× the median on screen, so it dominates ` +
          `whether or not it is the point.`,
      )
    }

    return {
      labelCollisions,
      worstOverlap,
      frameUse,
      weightRange,
      occluded: occludedIds.length,
      occludedIds,
      clipped,
      notes,
    }
  }
}

export interface SuggestPoseOptions extends SnapshotOptions {
  /** Azimuths to try, evenly spaced around the diagram. */
  azimuths?: number
  /** Elevations to try at each azimuth. */
  elevations?: number[]
}

export interface PoseSuggestion {
  pose: CameraPose
  critique: Critique
  /** How many camera positions were measured to arrive at this one. */
  considered: number
}

/**
 * Search for the camera that shows this diagram best, and measure the winner.
 *
 * The hero preset frames anything acceptably and nothing perfectly, because the
 * right angle is a property of the diagram rather than of the library: a system
 * laid out along one axis lands diagonally at a fixed azimuth, filling half its
 * frame and hiding its own clients behind other parts. There is no closed form
 * for the fix, but there is a cheap one — try a ring of cameras and measure each
 * with the same ruler the critique uses.
 *
 * Written because every caller was writing it. Recreating a stock AWS diagram,
 * this loop took the picture from 44% of frame with a label collision and a
 * hidden node, to 68% with neither — and the loop was forty lines of boilerplate
 * that had nothing to do with the diagram.
 *
 * Ranking is lexicographic and deliberately not a weighted score: a hidden part
 * and a buried label are *faults*, and no amount of frame filling compensates
 * for one. Clean poses are ordered by how much of the frame they use; if none is
 * clean, the least-bad is returned rather than nothing, because a caller asking
 * for a camera needs a camera.
 *
 * Builds the scene **once** and re-aims, which is both the fast path and the
 * only correct one. Calling `critique` per candidate looks equivalent and is
 * not: each call constructs a `Stage`, a WebGL context is bound to its canvas,
 * and `renderer.dispose()` does not release that binding — so even sharing one
 * canvas across the sweep exhausts the browser's supply of contexts partway
 * through and the failure surfaces on some later, unrelated render.
 */
export function suggestPose(doc: Doc, opts: SuggestPoseOptions = {}): PoseSuggestion {
  const rings = Math.max(1, Math.round(opts.azimuths ?? 16))
  const elevations = opts.elevations?.length ? opts.elevations : [0.3, PRESET_POSE.hero.el, 0.55]

  const staged = stageDocument(doc, { labels: true, ...opts })
  try {
    const candidates: Array<{ pose: CameraPose; critique: Critique }> = []

    for (let i = 0; i < rings; i++) {
      const az = PRESET_POSE.hero.az + (i / rings) * Math.PI * 2
      for (const el of elevations) {
        const pose: CameraPose = { az, el }
        staged.reframe(pose)
        candidates.push({ pose, critique: measureStaged(staged) })
      }
    }

    candidates.sort(compareCandidates)
    return { ...candidates[0], considered: candidates.length }
  } finally {
    staged.dispose()
  }
}

/** Total measurable faults. Each is a thing a reader cannot recover from. */
const faults = (c: Critique): number => c.occluded + c.clipped + c.labelCollisions

/** How far a pose has been turned from the studio's canonical azimuth, 0..π. */
function turnFromHero(pose: CameraPose): number {
  const d = Math.abs(((pose.az - PRESET_POSE.hero.az) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

/**
 * Faults, then framing, then stay near the house angle.
 *
 * Deliberately lexicographic rather than a weighted score: a hidden part and a
 * buried label are faults, and no amount of frame filling compensates for one.
 *
 * The last term is the one that is easy to leave out and should not be. Several
 * poses are usually fault-free with almost identical framing, so ranking on
 * frame use alone is decided by noise — the same document answered 23°, 327° and
 * 147° across three runs that differed only in a part's height. Worse, some of
 * those winners look *wrong* in a way no metric here can see: parts have a front,
 * and a camera behind the client monitor scores perfectly while showing the
 * reader the blank back of the screen. Framing is therefore compared in coarse
 * steps and ties break toward the hero azimuth, so the search deviates from the
 * house angle only when it genuinely buys something.
 */
function compareCandidates(
  a: { pose: CameraPose; critique: Critique },
  b: { pose: CameraPose; critique: Critique },
): number {
  const df = faults(a.critique) - faults(b.critique)
  if (df !== 0) return df
  /* 2% steps: below that the difference is not visible in the picture. */
  const step = (c: Critique): number => Math.round(c.frameUse * 50)
  const dframe = step(b.critique) - step(a.critique)
  if (dframe !== 0) return dframe
  return turnFromHero(a.pose) - turnFromHero(b.pose)
}
