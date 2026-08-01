/**
 * Connector specimens, ported from catalog section 4's link builders.
 *
 * These are GATE SCAFFOLDING, not engine parts. In the engine a connector is a
 * routing mode crossed with a style, applied to a path computed between two
 * ports — see route/ in Phase 4. They live here because reproducing them is how
 * we prove the foundry's connector primitives (`tubeMesh`, `arrowHead`,
 * `dashedRun`, `elbowCurve`, `port`) survived the port intact, before the
 * router is built on top of them.
 */

import * as THREE from 'three'
import { palette } from '../src/foundry/materials.js'
import {
  R_LINK,
  V,
  arrowHead,
  cylinder,
  dashedRun,
  elbowCurve,
  mesh,
  occlusion,
  port,
  ringGeo,
  sphere,
  tubeMesh,
} from '../src/foundry/geometry.js'
import { HUE } from '../src/foundry/materials.js'
import type { PartBuild } from '../src/parts/types.js'

function railBase(): THREE.Group {
  const g = new THREE.Group()
  g.add(occlusion(3.3, 0.32))
  return g
}

/** Solid run with a lathed arrowhead, terminated both ends on a port pad. */
export function linkSync(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const m = P.steel('body')
  const lit = P.lit('lit', 2.4)
  const pad = P.anodised('trim')

  const run = new THREE.CatmullRomCurve3([V(-1.1, 0.42, 0), V(0, 0.42, 0), V(1.0, 0.42, 0)])
  g.add(tubeMesh(run, R_LINK, m))
  g.add(arrowHead(run, 1, R_LINK, lit))
  for (const x of [-1.1, 1.25]) {
    const pt = port(pad)
    pt.position.set(x, 0.02, 0)
    g.add(pt)
    g.add(mesh(cylinder(0.03, 0.03, 0.42, 16), m, [x, 0.22, 0]))
  }
  return { group: g, dist: 3.6, target: V(0, 0.3, 0) }
}

/** Nine dashes at 58% duty on a raised arc. The ratio is fixed system-wide. */
export function linkAsync(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const m = P.steel('body')
  const pad = P.anodised('trim')

  const run = new THREE.CatmullRomCurve3([V(-1.1, 0.42, 0), V(0, 0.76, 0), V(1.0, 0.42, 0)])
  g.add(dashedRun(run, R_LINK * 0.85, m, 9))
  g.add(arrowHead(run, 1, R_LINK, P.lit('lit', 2.4)))
  for (const x of [-1.1, 1.25]) {
    const pt = port(pad)
    pt.position.set(x, 0.02, 0)
    g.add(pt)
  }
  return { group: g, dist: 3.6, target: V(0, 0.42, 0) }
}

/** Two offset arcs with opposed heads. Never one line with two arrowheads. */
export function linkDuplex(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const m = P.steel('body')
  const lit = P.lit('lit', 2.4)
  const pad = P.anodised('trim')

  const up = new THREE.CatmullRomCurve3([
    V(-1.05, 0.42, -0.17),
    V(0, 0.64, -0.17),
    V(1.0, 0.42, -0.17),
  ])
  const dn = new THREE.CatmullRomCurve3([
    V(1.05, 0.42, 0.17),
    V(0, 0.64, 0.17),
    V(-1.0, 0.42, 0.17),
  ])
  for (const k of [up, dn]) {
    g.add(tubeMesh(k, R_LINK * 0.8, m))
    g.add(arrowHead(k, 1, R_LINK * 0.8, lit))
  }
  for (const x of [-1.2, 1.2]) {
    const pt = port(pad)
    pt.position.set(x, 0.02, 0)
    g.add(pt)
  }
  return { group: g, dist: 3.7, target: V(0, 0.42, 0) }
}

/** Acrylic conduit with steel collars carrying lit packets. Direction reads from motion. */
export function linkFlow(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const pad = P.anodised('trim')

  const run = new THREE.CatmullRomCurve3([
    V(-1.15, 0.42, 0),
    V(-0.3, 0.42, 0.32),
    V(0.4, 0.42, -0.32),
    V(1.15, 0.42, 0),
  ])
  g.add(tubeMesh(run, R_LINK * 1.55, P.acrylic(0xc9d2e0, 0.18)))
  const collar = P.steel('trim')
  for (let i = 0; i < 9; i++) {
    const p = run.getPointAt(i / 9)
    g.add(mesh(ringGeo(R_LINK * 1.6, 0.008, 24), collar, [p.x, p.y, p.z], [Math.PI / 2, 0, 0]))
  }

  const dotMat = palette('data').lit('lit', 2.6)
  const dots: THREE.Mesh[] = []
  for (let i = 0; i < 7; i++) {
    const d = mesh(sphere(0.056, 20, 16), dotMat)
    dots.push(d)
    g.add(d)
  }
  for (const x of [-1.15, 1.15]) {
    const pt = port(pad)
    pt.position.set(x, 0.02, 0)
    g.add(pt)
  }
  return {
    group: g,
    dist: 3.7,
    target: V(0, 0.42, 0),
    animated: dots,
    update: (t) => {
      dots.forEach((d, i) => {
        d.position.copy(run.getPointAt((t * 0.2 + i / 7) % 1))
      })
    },
  }
}

/** Lit core inside a clamped acrylic sheath. The shielding is literal, not a padlock badge. */
export function linkSecure(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const D = palette('data')

  const run = new THREE.CatmullRomCurve3([V(-1.1, 0.44, 0), V(0, 0.44, 0), V(1.0, 0.44, 0)])
  g.add(tubeMesh(run, R_LINK * 0.5, D.lit('lit', 1.8)))
  g.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(run, 90, R_LINK * 1.9, 20, false),
      D.acrylic('body', 0.15),
    ),
  )
  const clamp = P.steel(0xaeb7c5)
  for (let i = 0; i < 8; i++) {
    const p = run.getPointAt(0.06 + i * 0.126)
    g.add(mesh(ringGeo(R_LINK * 1.98, 0.016, 32), clamp, [p.x, p.y, p.z], [0, 0, Math.PI / 2]))
  }
  g.add(arrowHead(run, 1, R_LINK * 0.9, P.lit('lit', 2.4)))
  const pt = port(P.anodised('trim'))
  pt.position.set(-1.1, 0.02, 0)
  g.add(pt)
  return { group: g, dist: 3.6, target: V(0, 0.42, 0) }
}

/** One source through a splitter node into three sinks on a common tangent. */
export function linkFanout(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const m = P.steel('body')
  const lit = P.lit('lit', 2.4)
  const pad = P.anodised('trim')

  const src = port(pad)
  src.position.set(-1.1, 0.02, 0)
  g.add(src)
  g.add(mesh(cylinder(0.032, 0.032, 0.44, 16), m, [-1.1, 0.22, 0]))
  g.add(mesh(sphere(0.075, 20, 16), m, [-1.1, 0.42, 0]))

  for (const z of [-0.62, 0, 0.62]) {
    const br = new THREE.CatmullRomCurve3([
      V(-1.1, 0.42, 0),
      V(-0.2, 0.42, z * 0.5),
      V(0.55, 0.42, z),
      V(1.0, 0.42, z),
    ])
    g.add(tubeMesh(br, R_LINK * 0.8, m))
    g.add(arrowHead(br, 1, R_LINK * 0.8, lit))
    const d = port(pad)
    d.position.set(1.2, 0.02, z)
    g.add(d)
  }
  return { group: g, dist: 4.0, target: V(0, 0.35, 0) }
}

/** Right-angle path with 0.28u corner rounding. This keeps dense diagrams legible. */
export function linkElbow(): PartBuild {
  const g = railBase()
  const P = palette('link')
  const m = P.steel('body')
  const lit = P.lit('lit', 2.4)
  const pad = P.anodised('trim')

  const run = elbowCurve(
    [V(-1.1, 0.44, -0.72), V(-0.1, 0.44, -0.72), V(-0.1, 0.44, 0.6), V(1.0, 0.44, 0.6)],
    0.28,
  )
  g.add(tubeMesh(run, R_LINK, m, 150))
  g.add(arrowHead(run, 1, R_LINK, lit))
  for (const p of [
    [-1.1, -0.72],
    [1.2, 0.6],
  ]) {
    const pt = port(pad)
    pt.position.set(p[0], 0.02, p[1])
    g.add(pt)
    g.add(mesh(cylinder(0.03, 0.03, 0.44, 16), m, [p[0], 0.22, p[1]]))
  }
  return { group: g, dist: 3.9, target: V(0, 0.35, 0) }
}

export const LINK_SPECIMENS = {
  linkSync,
  linkAsync,
  linkDuplex,
  linkFlow,
  linkSecure,
  linkFanout,
  linkElbow,
}

export const LINK_META = [
  {
    id: 'linkSync',
    pn: 'LNK-01',
    fin: 'Machined stainless',
    name: 'Synchronous call',
    desc: 'Solid run with a lathed arrowhead, terminated both ends on a port pad and riser.',
    spec: ['r 0.05u', 'Blocking'],
  },
  {
    id: 'linkAsync',
    pn: 'LNK-02',
    fin: 'Machined stainless',
    name: 'Async message',
    desc: 'Nine dashes at 58% duty on a raised arc. The ratio is fixed system-wide.',
    spec: ['9 dashes', 'Non-blocking'],
  },
  {
    id: 'linkDuplex',
    pn: 'LNK-03',
    fin: 'Machined stainless',
    name: 'Bidirectional',
    desc: 'Two offset arcs with opposed heads. Never one line with two arrowheads.',
    spec: ['±0.17u offset', 'Duplex'],
  },
  {
    id: 'linkFlow',
    pn: 'LNK-04',
    fin: 'Cast acrylic',
    name: 'Data flow',
    desc: 'Acrylic conduit with steel collars carrying lit packets. Direction is read from motion alone.',
    spec: ['7 packets', 'Continuous'],
  },
  {
    id: 'linkSecure',
    pn: 'LNK-05',
    fin: 'Acrylic + stainless',
    name: 'Encrypted channel',
    desc: 'Lit core inside a clamped acrylic sheath. The shielding is literal, not a padlock badge.',
    spec: ['⌀0.19u sheath', '8 clamps'],
  },
  {
    id: 'linkFanout',
    pn: 'LNK-06',
    fin: 'Machined stainless',
    name: 'Fan-out',
    desc: 'One source through a splitter node into three sinks, branches leaving on a common tangent.',
    spec: ['1→3', 'Broadcast'],
  },
  {
    id: 'linkElbow',
    pn: 'LNK-07',
    fin: 'Machined stainless',
    name: 'Orthogonal route',
    desc: 'Right-angle path with 0.28u corner rounding. This is what keeps dense diagrams legible.',
    spec: ['R 0.28u', 'Manhattan'],
  },
] as const

/** Catalog tiles tint by category; every connector specimen is `link`. */
export const LINK_CATEGORY = HUE.link
