/**
 * Reference assembly (ASM-000) — gate scaffolding.
 *
 * A hand-placed diagram, ported from catalog section 5. In M2 this becomes an
 * actual document in examples/, which is also the end-to-end test: the same
 * topology built through the editor should come out looking like this.
 *
 * Note that the sub-parts' `update` callbacks are deliberately dropped, exactly
 * as the catalog does — the assembly tile is static.
 */

import * as THREE from 'three'
import { palette } from '../src/foundry/materials.js'
import { V, arrowHead, dashedRun, elbowCurve, tubeMesh } from '../src/foundry/geometry.js'
import { build } from '../src/parts/registry.js'
import { boundary } from '../src/parts/boundary.js'
import type { PartBuild, PartId } from '../src/parts/types.js'

export function assembly(): PartBuild {
  const g = new THREE.Group()

  const place = (id: PartId, x: number, z: number, s: number, ry = 0): void => {
    const part = build(id)
    /* Each part carries its own contact-shadow blob, sized for a solo tile. In
       an assembly they overlap into mud, so the real shadow map does the work. */
    part.group.children = part.group.children.filter((k) => !k.userData.isShadow)
    part.group.position.set(x, 0, z)
    part.group.rotation.y = ry
    part.group.scale.setScalar(s)
    g.add(part.group)
  }

  place('client', -4.6, 0.0, 0.68, 0.5)
  place('cdn', -2.9, -2.1, 0.6)
  place('gateway', -2.0, 0.4, 0.62)
  place('service', 0.6, -1.6, 0.68)
  place('service', 0.6, 1.6, 0.68)
  place('database', 3.2, -1.6, 0.7)
  place('cache', 3.2, 1.6, 0.7)

  const P = palette('link')
  const wire = P.steel('body')
  const lit = P.lit('lit', 2.2)

  const run = (pts: THREE.Vector3[], dashed = false): void => {
    const c = elbowCurve(pts, 0.3)
    g.add(dashed ? dashedRun(c, 0.028, wire, 14) : tubeMesh(c, 0.032, wire, 120))
    g.add(arrowHead(c, 1, 0.032, lit))
  }

  const y = 0.3
  run([V(-4.0, y, 0), V(-3.2, y, 0), V(-2.9, y, 0)])
  run([V(-4.4, y, -0.5), V(-3.5, y, -2.1), V(-3.3, y, -2.1)])
  run([V(-2.5, y, -2.1), V(-2.0, y, -2.1), V(-2.0, y, -0.4)])
  run([V(-1.3, y, 0.2), V(-0.4, y, -1.6), V(-0.2, y, -1.6)])
  run([V(-1.3, y, 0.6), V(-0.4, y, 1.6), V(-0.2, y, 1.6)])
  run([V(1.3, y, -1.6), V(2.0, y, -1.6), V(2.5, y, -1.6)])
  run([V(1.3, y, 1.6), V(2.0, y, 1.6), V(2.5, y, 1.6)], true)

  /* The catalog inlines this box; the engine promotes it to the `boundary`
     part, so the assembly is also a check that the promotion is faithful. */
  const bound = boundary({ w: 5.1, h: 1.5, d: 4.5, cat: 'compute' })
  bound.group.position.set(1.8, 0, 0)
  g.add(bound.group)

  const grid = new THREE.GridHelper(24, 96, 0x2a3140, 0x1c222c)
  const gm = grid.material as THREE.Material
  gm.transparent = true
  gm.opacity = 0.55
  grid.position.y = -0.002
  grid.userData.isGrid = true
  g.add(grid)

  return { group: g, dist: 13, target: V(0.1, 0.5, 0) }
}
