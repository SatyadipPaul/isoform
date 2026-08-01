/**
 * Group boundary — a translucent volume with a lit wireframe outline, used to
 * enclose a VPC, an availability zone, a trust boundary, a bounded context.
 *
 * The catalog builds exactly this inside `P.assembly` to wrap its service tier.
 * Rather than rebuilding it when Phase 5 needs grouping, it is promoted here to
 * a first-class part with a settable extent.
 */

import * as THREE from 'three'
import { HUE, palette, registerTintable, type Category } from '../foundry/materials.js'
import { V, boxGeo, mesh, roundedBox } from '../foundry/geometry.js'
import type { PartBuild } from './types.js'

export interface BoundaryOptions {
  w?: number
  h?: number
  d?: number
  cat?: Category
}

export function boundary(o: BoundaryOptions = {}): PartBuild {
  const w = o.w ?? 5.1
  const h = o.h ?? 1.5
  const d = o.d ?? 4.5
  const cat = o.cat ?? 'compute'

  const g = new THREE.Group()
  const P = palette(cat)

  /* Very low opacity: the volume has to read as an enclosure without dimming
     the parts inside it. depthWrite is already off on the acrylic finish. */
  g.add(mesh(roundedBox(w, h, d, 0.12), P.acrylic('body', 0.05), [0, h / 2, 0]))

  const edgeMat = new THREE.LineBasicMaterial({
    color: HUE[cat].lit,
    transparent: true,
    opacity: 0.3,
  })
  registerTintable(edgeMat, cat, 'lit')

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo(w, h, d)), edgeMat)
  edges.position.set(0, h / 2, 0)
  g.add(edges)

  return { group: g, dist: Math.max(w, d) * 1.9, target: V(0, h / 2, 0) }
}
