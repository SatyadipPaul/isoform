/**
 * Connector styles.
 *
 * Style and routing are independent axes. This module only knows how to *dress*
 * a path that has already been found; `router.ts` decides where the path goes.
 * The catalog conflated the two — its `linkElbow` specimen is not a style at
 * all, it is the orthogonal router, which is why it applies to all of these.
 *
 * Each style is a transcription of the corresponding catalog specimen onto a
 * computed curve rather than the specimen's own hardcoded endpoints.
 */

import * as THREE from 'three'
import { HUE, palette } from '../foundry/materials.js'
import {
  R_LINK,
  arrowHead,
  dashedRun,
  elbowCurve,
  ringGeo,
  mesh,
  sphere,
  tubeMesh,
  polylineLength,
  segmentsForLength,
} from '../foundry/geometry.js'
import { ELBOW_R } from '../foundry/geometry.js'
import type { EdgeKind } from '../doc/schema.js'

export interface EdgeBuild {
  group: THREE.Group
  /** Present only for styles that move — currently `flow`. */
  update?: (t: number) => void
}

const link = palette('link')
const data = palette('data')

/** Arrowhead radius, and the length that implies — see the foundry's arrowGeo. */
export const ARROW_R = R_LINK * 0.8
export const ARROW_LEN = ARROW_R * 6.4

/** Offset a polyline sideways in the ground plane, perpendicular to its run. */
function offsetPolyline(pts: THREE.Vector3[], d: number): THREE.Vector3[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z)
    if (t.lengthSq() < 1e-9) return p.clone()
    t.normalize()
    /* Left-hand normal in XZ. */
    return p.clone().add(new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(d))
  })
}

function curveOf(pts: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  return elbowCurve(pts, ELBOW_R)
}

/** Lift the middle of a run into an arc, for styles that read as non-blocking. */
function arched(pts: THREE.Vector3[], rise: number): THREE.Vector3[] {
  const n = pts.length - 1
  return pts.map((p, i) => {
    const t = n === 0 ? 0 : i / n
    return p.clone().setY(p.y + Math.sin(t * Math.PI) * rise)
  })
}

/**
 * Radial resolution for connector tubes.
 *
 * Ten sides is indistinguishable from sixteen on a 0.035u tube at diagram
 * scale, and connector geometry is rebuilt live while a part is being dragged,
 * so the saving is felt every frame rather than once at load.
 */
const RADIAL = 10
const RADIAL_SHEATH = 14

export function buildEdge(kind: EdgeKind, pts: THREE.Vector3[]): EdgeBuild {
  const g = new THREE.Group()
  /* Measured from the polyline, not the curve: Curve.getLength builds a
     200-entry arc-length table and costs more than the geometry it sizes. */
  const segs = segmentsForLength(polylineLength(pts))
  const wire = link.steel('body')
  const tip = link.lit('lit', 2.2)

  switch (kind) {
    case 'sync': {
      const c = curveOf(pts)
      g.add(tubeMesh(c, R_LINK * 0.7, wire, segs, RADIAL))
      g.add(arrowHead(c, 1, ARROW_R, tip))
      break
    }

    case 'async': {
      /* Nine dashes at 58% duty on a raised arc. The ratio is fixed system-wide. */
      const c = curveOf(arched(pts, 0.28))
      g.add(dashedRun(c, R_LINK * 0.85, wire, 9, 0.58, RADIAL))
      g.add(arrowHead(c, 1, ARROW_R, tip))
      break
    }

    case 'duplex': {
      /* Two offset runs with opposed heads. Never one line with two arrowheads. */
      const up = curveOf(offsetPolyline(pts, 0.17))
      const dn = curveOf(offsetPolyline([...pts].reverse(), 0.17))
      for (const c of [up, dn]) {
        g.add(tubeMesh(c, R_LINK * 0.6, wire, segs, RADIAL))
        g.add(arrowHead(c, 1, ARROW_R * 0.9, tip))
      }
      break
    }

    case 'flow': {
      /* Acrylic conduit with steel collars carrying lit packets. Direction is
         read from motion alone, so this is the one style that must animate. */
      const c = curveOf(pts)
      g.add(tubeMesh(c, R_LINK * 1.35, link.acrylic(0xc9d2e0, 0.18), segs, RADIAL_SHEATH))
      const collar = link.steel('trim')
      for (let i = 0; i <= 9; i++) {
        const p = c.getPointAt(i / 9)
        g.add(mesh(ringGeo(R_LINK * 1.4, 0.008, 24), collar, [p.x, p.y, p.z], [Math.PI / 2, 0, 0]))
      }
      const dotMat = data.lit('lit', 2.6)
      const dots: THREE.Mesh[] = []
      for (let i = 0; i < 7; i++) {
        const d = mesh(sphere(0.05, 20, 16), dotMat)
        dots.push(d)
        g.add(d)
      }
      g.add(arrowHead(c, 1, ARROW_R, tip))
      return {
        group: g,
        update: (t) => {
          dots.forEach((d, i) => d.position.copy(c.getPointAt((t * 0.2 + i / 7) % 1)))
        },
      }
    }

    case 'secure': {
      /* Lit core inside a clamped acrylic sheath. The shielding is literal,
         not a padlock badge. */
      const c = curveOf(pts)
      g.add(tubeMesh(c, R_LINK * 0.4, data.lit('lit', 1.8), segs, RADIAL))
      g.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(c, segs, R_LINK * 1.5, RADIAL_SHEATH, false),
          data.acrylic('body', 0.15),
        ),
      )
      const clamp = link.steel(0xaeb7c5)
      for (let i = 0; i < 8; i++) {
        const p = c.getPointAt(0.06 + i * 0.126)
        const tan = c.getTangentAt(0.06 + i * 0.126)
        const m = mesh(ringGeo(R_LINK * 1.58, 0.014, 32), clamp, [p.x, p.y, p.z])
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.normalize())
        g.add(m)
      }
      g.add(arrowHead(c, 1, ARROW_R * 0.9, tip))
      break
    }
  }

  return { group: g }
}

/** Palette swatch colour for an edge kind, for legends and inspectors. */
export function edgeCss(kind: EdgeKind): string {
  return kind === 'flow' || kind === 'secure' ? HUE.data.css : HUE.link.css
}
