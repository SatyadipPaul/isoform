/**
 * Measure what a design critique would otherwise only assert.
 *
 * "The labels collide" and "the diagram is sparse" are opinions until they are
 * counted. Everything here is computed from the same scene `renderDocument`
 * draws, projected through the same camera, so a number moving means the picture
 * moved — not that the reviewer's mood did.
 */

import * as THREE from 'three'
import {
  HERO_FOV,
  PRESET_POSE,
  Reconciler,
  Stage,
  frame,
  framePoints,
  palette,
  type Doc,
} from '@satyadip28/isoform'

export interface Metrics {
  /** Pairs of nameplates whose screen rectangles intersect. */
  labelCollisions: number
  /** Worst overlap between any two plates, as a fraction of the smaller one. */
  worstOverlap: number
  /** Share of the frame the diagram's parts actually occupy. */
  frameUse: number
  /** Ratio of the largest part's screen area to the median. Visual hierarchy. */
  weightRange: number
  /** Parts whose centre is hidden behind other geometry from this camera. */
  occluded: number
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
 * The obvious implementation — `Box3.setFromObject` then project the eight
 * corners — is wrong for anything that is not axis-aligned, and a nameplate
 * never is: it stands upright and turns about Y to face the camera, so it is
 * tilted with respect to the world axes and its world AABB is a box containing
 * a tilted rectangle. Projecting *that* reported two whatsapp plates as 34%
 * overlapped when the render shows clear air between them.
 *
 * Measuring the box in the object's own space and carrying the corners through
 * its world matrix keeps the rectangle a rectangle.
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

/**
 * Build the scene exactly as a snapshot would, then measure it.
 *
 * Uses the same framing path, so the numbers describe the picture that would be
 * rendered rather than some other arrangement of the same document.
 */
export function measure(doc: Doc, aspect = 2): Metrics {
  const canvas = document.createElement('canvas')
  const stage = new Stage({ canvas })
  const rec = new Reconciler(stage.scene, { anchorIdle: palette('link').lit('lit', 0.9) })

  try {
    rec.sync(doc)
    rec.updateDetail({ detailed: [], fullBelow: 0 })
    rec.setLabelsVisible(true)

    const bounds = rec.bounds().expandByScalar(0.4)
    const content = rec.contentPoints()
    const centre = bounds.getCenter(new THREE.Vector3())
    const pose = PRESET_POSE.hero
    const f = content.length
      ? framePoints(content, centre, pose.az, pose.el, HERO_FOV, aspect, 1.08)
      : frame(bounds, pose.az, pose.el, HERO_FOV, aspect, 1.08)

    const camera = new THREE.PerspectiveCamera(HERO_FOV, aspect, 0.1, 500)
    camera.position.copy(f.position)
    camera.lookAt(f.target)
    camera.updateMatrixWorld(true)
    rec.orientLabels(camera)

    /* Label plates: the face and its backing board, not the leader stem — the
       stem is a hairline and overlapping stems are not what anyone notices. */
    const plates: Rect[] = []
    for (const child of rec.labelLayer.children) {
      if (!(child as THREE.Group).isGroup) continue
      const r = screenRect(child, camera)
      if (r) plates.push(r)
    }

    let collisions = 0
    let worst = 0
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const o = overlap(plates[i], plates[j])
        if (o <= 0) continue
        collisions++
        worst = Math.max(worst, o / Math.min(area(plates[i]), area(plates[j])))
      }
    }

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
    const frameUse = partRects.length ? ((ux1 - ux0) / 2) * ((uy1 - uy0) / 2) : 0

    const areas = partRects.map(area).sort((a, b) => a - b)
    const median = areas.length ? areas[Math.floor(areas.length / 2)] : 1
    const weightRange = median > 0 ? (areas.at(-1) ?? 0) / median : 1

    /* Occlusion: is a part's own centre the first thing the camera meets? */
    const ray = new THREE.Raycaster()
    let occluded = 0
    for (const id of rec.endpointIds) {
      const anchor = rec.anchorOf(id)
      if (!anchor) continue
      const at = anchor.position.clone().setY(anchor.position.y + 0.4)
      const dir = at.clone().sub(camera.position).normalize()
      ray.set(camera.position, dir)
      const hit = ray.intersectObjects(rec.proxies, false)[0]
      if (hit && hit.object.userData.nodeId !== id) occluded++
    }

    return {
      labelCollisions: collisions,
      worstOverlap: worst,
      frameUse,
      weightRange,
      occluded,
    }
  } finally {
    stage.dispose()
  }
}
