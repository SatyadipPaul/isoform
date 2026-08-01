/**
 * Data parts — lathed profiles with filleted rims. Per the catalog's own note,
 * "the rim is the whole difference": these read as machined objects rather than
 * primitives precisely because no edge is perfectly sharp.
 */

import * as THREE from 'three'
import { palette } from '../foundry/materials.js'
import {
  V,
  drum,
  extrudeShape,
  mesh,
  occlusion,
  pail,
  ringGeo,
  roundedBox,
  sphere,
  torus,
  tubeMesh,
  vault as vaultGeo,
} from '../foundry/geometry.js'
import type { PartBuild } from './types.js'

/** Relational store: three stacked platters with machined bands between them. */
export function database(): PartBuild {
  const g = new THREE.Group()
  const P = palette('data')
  const body = P.polymer('body')
  const band = P.steel(0x9fa9b8)

  for (const y of [0, 0.4, 0.8]) {
    g.add(mesh(drum(0.74, 0.36, 0.075), body, [0, y, 0]))
    g.add(mesh(ringGeo(0.746, 0.014, 80), band, [0, y + 0.36, 0], [Math.PI / 2, 0, 0]))
  }
  g.add(mesh(drum(0.52, 0.012, 0.005, 64), P.lit('lit', 0.5), [0, 1.162, 0]))
  g.add(mesh(ringGeo(0.3, 0.012, 56), P.lit('lit', 1.0), [0, 1.17, 0], [Math.PI / 2, 0, 0]))
  g.add(occlusion(2.8, 0.5))
  return { group: g, dist: 3.4, target: V(0, 0.58, 0) }
}

/** Cache: short drum under a lit bolt badge, with a datum halo that pulses. */
export function cache(): PartBuild {
  const g = new THREE.Group()
  const P = palette('data')

  g.add(mesh(drum(0.78, 0.46, 0.085), P.polymer('body'), [0, 0, 0]))
  g.add(mesh(ringGeo(0.79, 0.03, 80), P.lit('lit', 2.4), [0, 0.23, 0], [Math.PI / 2, 0, 0]))
  g.add(mesh(drum(0.56, 0.012, 0.005, 64), P.lit('lit', 0.7), [0, 0.462, 0]))

  const s = new THREE.Shape()
  s.moveTo(0.06, 0.34)
  s.lineTo(-0.18, 0.02)
  s.lineTo(-0.02, 0.02)
  s.lineTo(-0.06, -0.34)
  s.lineTo(0.18, -0.02)
  s.lineTo(0.02, -0.02)
  s.closePath()
  const bolt = mesh(extrudeShape(s, 0.06, 0.014, 'cache-bolt'), P.lit('lit', 2.8), [0, 0.72, 0])
  g.add(bolt)

  /* The halo drives emissiveIntensity every frame, so it must own its material.
     Sharing would make every cache node in a diagram pulse off whichever one
     ticked last. */
  const haloMat = P.lit('lit', 1.4, { unique: true })
  const halo = mesh(ringGeo(0.98, 0.008, 80), haloMat, [0, 0.02, 0], [Math.PI / 2, 0, 0])
  g.add(halo)
  g.add(occlusion(2.8, 0.45))

  return {
    group: g,
    dist: 3.2,
    target: V(0, 0.44, 0),
    animated: [halo, bolt],
    update: (t) => {
      halo.scale.setScalar(1 + Math.sin(t * 1.9) * 0.035)
      haloMat.emissiveIntensity = 1.0 + Math.sin(t * 1.9) * 0.6
      bolt.rotation.y = Math.sin(t * 0.6) * 0.35
    },
  }
}

/** Object storage: a literal bucket — bellied wall, rolled rim, lugs, wire handle. */
export function blob(): PartBuild {
  const g = new THREE.Group()
  const P = palette('data')
  const steel = P.steel(0xa6afbe)

  g.add(mesh(pail(0.8, 0.56, 1.0), P.polymer('body'), [0, 0, 0]))
  for (const s of [-1, 1]) {
    g.add(mesh(roundedBox(0.1, 0.14, 0.06, 0.03), steel, [s * 0.82, 0.82, 0]))
  }
  const handle = new THREE.Mesh(torus(0.82, 0.026, 14, 48, Math.PI), steel)
  handle.rotation.set(0, Math.PI / 2, 0)
  handle.position.y = 0.86
  g.add(handle)

  g.add(mesh(drum(0.72, 0.02, 0.008, 64), P.lit('lit', 0.35), [0, 0.9, 0]))
  for (let i = 0; i < 3; i++) {
    const b = mesh(roundedBox(0.2, 0.2, 0.2, 0.045), P.polymer('lit'), [
      Math.cos(i * 2.3) * 0.26,
      0.5 + i * 0.13,
      Math.sin(i * 2.3) * 0.26,
    ])
    b.rotation.set(i * 0.4, i * 1.1, i * 0.2)
    g.add(b)
  }
  g.add(occlusion(2.8, 0.5))
  return { group: g, dist: 3.4, target: V(0, 0.5, 0) }
}

/**
 * Search index: a card-catalog cabinet with one drawer pulled open.
 *
 * The open drawer is the whole silhouette — a closed cabinet is a filing
 * cabinet, and an inverted index is precisely the thing a card catalog was.
 * Deliberately unlike the database's stacked platters, because at 40px the two
 * must not be confusable.
 */
export function search(): PartBuild {
  const g = new THREE.Group()
  const P = palette('data')
  const carcass = P.powder('body')
  const front = P.anodised('trim')
  const pull = P.steel(0xa6afbe)

  g.add(mesh(roundedBox(1.4, 1.06, 1.0, 0.04), carcass, [0, 0.58, 0]))
  g.add(mesh(roundedBox(1.48, 0.09, 1.06, 0.03), P.powder(0x2a3038), [0, 0.045, 0]))
  g.add(mesh(roundedBox(1.46, 0.07, 1.06, 0.03), front, [0, 1.13, 0]))

  /* Three closed drawers, and one open. The open one sits in the second row so
     the cabinet still reads as a cabinet above and below it. */
  const drawerFace = (y: number, z: number): THREE.Group => {
    const d = new THREE.Group()
    d.add(mesh(roundedBox(1.26, 0.22, 0.05, 0.02), front, [0, 0, 0]))
    d.add(mesh(roundedBox(0.3, 0.045, 0.04, 0.02), pull, [0, 0, 0.045]))
    d.add(mesh(roundedBox(0.16, 0.08, 0.02, 0.01), P.lit('lit', 0.8), [-0.44, 0, 0.04]))
    d.position.set(0, y, z)
    return d
  }
  for (const y of [0.21, 0.75, 1.0]) g.add(drawerFace(y, 0.505))

  const open = new THREE.Group()
  open.position.set(0, 0.48, 0.5)
  open.add(mesh(roundedBox(1.24, 0.24, 0.62, 0.02), P.polymer(0x2b3138), [0, 0, 0.2]))
  open.add(drawerFace(0, 0.5))

  /* Cards riffle. One group so the merge pass folds all twelve into one. */
  const cards = new THREE.Group()
  for (let i = 0; i < 12; i++) {
    cards.add(
      mesh(roundedBox(1.06, 0.2, 0.012, 0.006), P.polymer('lit'), [0, 0.04, -0.02 + i * 0.038]),
    )
  }
  cards.position.set(0, 0, 0.2)
  open.add(cards)
  g.add(open)

  /* The magnifier says "search" without a glyph — but only if it reads as a
     lens. At 0.26u on edge it was a stray bar above the cabinet; it needs to be
     large enough, and turned far enough to face the hero camera, to be a ring
     with something inside it. */
  const lens = new THREE.Group()
  /* 0.22, not 0.34. At 0.34 the ring spanned 0.78 across a 1.4 cabinet — over
     half its width — and the dark glass made it the heaviest mass in the part,
     so the silhouette read as a magnifier with a cabinet under it rather than a
     catalogue with a magnifier over it. The glass is lit rather than tinted for
     the same reason: it has to read as a lens, not a hole. */
  lens.add(mesh(ringGeo(0.22, 0.035, 40), pull, [0, 0, 0]))
  lens.add(mesh(drum(0.21, 0.012, 0.005, 44), P.acrylic('lit', 0.22), [0, 0, 0], [Math.PI / 2, 0, 0]))
  lens.add(mesh(roundedBox(0.3, 0.05, 0.05, 0.02), pull, [0.34, -0.16, 0], [0, 0, -0.62]))
  lens.position.set(-0.1, 1.4, 0.3)
  lens.rotation.set(0.32, 0, 0.2)
  g.add(lens)
  g.add(occlusion(3.0, 0.5))

  return {
    group: g,
    dist: 3.8,
    target: V(0, 0.75, 0),
    animated: [cards, lens],
    update: (t) => {
      cards.position.z = 0.2 + Math.sin(t * 1.6) * 0.05
      lens.position.y = 1.5 + Math.sin(t * 1.1) * 0.045
      lens.rotation.y = 0.3 + Math.sin(t * 0.7) * 0.25
    },
  }
}

/**
 * Vector store: an embedding space you can see into.
 *
 * A wireframe cell holding a cloud of points, with one query point and its
 * three nearest neighbours lit and joined. That picture *is* what a vector
 * store does, so it needs no glyph — and it is the only part in the catalog
 * that could be mistaken for nothing else.
 */
export function vectordb(): PartBuild {
  const g = new THREE.Group()
  const P = palette('data')
  const S = 0.62 // half-extent of the cell

  g.add(mesh(roundedBox(1.5, 0.1, 1.5, 0.04), P.powder('trim'), [0, 0.05, 0]))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(roundedBox(0.05, 1.3, 0.05, 0.02), P.anodised('trim'), [sx * S, 0.75, sz * S]))
    }
  }
  for (const y of [0.1, 1.4]) {
    for (const [ax, az] of [
      [1, 0],
      [0, 1],
    ]) {
      for (const s of [-1, 1]) {
        g.add(
          mesh(
            roundedBox(ax ? S * 2 : 0.04, 0.04, az ? S * 2 : 0.04, 0.015),
            P.anodised('trim'),
            [ax ? 0 : s * S, y, az ? 0 : s * S],
          ),
        )
      }
    }
  }

  /* Deterministic scatter — a fixed table rather than a PRNG, so every vector
     store in every diagram has the identical cloud and the part reads as one
     manufactured object rather than a random splash. */
  const cloud = new THREE.Group()
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996 // golden angle
    const r = Math.sqrt((i + 0.5) / 26) * S * 0.86
    pts.push(V(Math.cos(a) * r, 0.28 + ((i * 7) % 23) * 0.041, Math.sin(a) * r))
  }
  const dot = P.polymer('body')
  for (const p of pts) cloud.add(mesh(sphere(0.045, 12, 10), dot, [p.x, p.y, p.z]))

  /* The query and its neighbours. Lit, larger, and joined — the only part of
     the cloud that is doing anything.

     Actually the nearest three, computed. They were `pts[5]`, `pts[11]` and
     `pts[18]`, picked because the numbers looked spread out — so the links
     sprawled clear across the cloud past much closer points, which is precisely
     the opposite of what a nearest-neighbour lookup does. The part existed to
     show that one idea and was illustrating its negation. */
  const q = pts[8]
  const near = pts
    .filter((p) => p !== q)
    .sort((a, b) => a.distanceToSquared(q) - b.distanceToSquared(q))
    .slice(0, 3)
  const hot = P.lit('lit', 2.6)
  cloud.add(mesh(sphere(0.075, 16, 12), hot, [q.x, q.y, q.z]))
  for (const n of near) {
    cloud.add(mesh(sphere(0.06, 14, 10), P.polymer('lit'), [n.x, n.y, n.z]))
    cloud.add(tubeMesh(new THREE.CatmullRomCurve3([q, n]), 0.011, hot, 1))
  }
  cloud.position.y = 0.1
  g.add(cloud)
  g.add(occlusion(3.0, 0.45))

  return {
    group: g,
    dist: 3.7,
    target: V(0, 0.7, 0),
    /* The whole cloud turns as one object — 34 meshes that stay mergeable. */
    animated: [cloud],
    update: (t) => {
      cloud.rotation.y = t * 0.3
    },
  }
}

/** Warehouse: barrel vault over two roller shutters, dock bumpers, lit clerestory. */
export function warehouse(): PartBuild {
  const g = new THREE.Group()
  const P = palette('data')
  const wall = P.powder('body')
  const trim = P.anodised('trim')

  g.add(mesh(roundedBox(2.0, 0.86, 1.3, 0.04), wall, [0, 0.5, 0]))
  g.add(mesh(roundedBox(2.1, 0.14, 1.4, 0.04), P.powder(0x2a3038), [0, 0.07, 0]))

  const vault = new THREE.Mesh(vaultGeo(1.02, 1.34, 40, 0, Math.PI), trim)
  vault.rotation.x = Math.PI / 2
  vault.position.set(0, 0.93, 0)
  vault.scale.set(1, 1, 0.42)
  g.add(vault)

  const shutter = P.anodised(0x8e97a6, { surface: 'shutter' })
  for (const x of [-0.5, 0.5]) {
    g.add(mesh(roundedBox(0.66, 0.6, 0.05, 0.02), shutter, [x, 0.4, 0.66]))
    g.add(mesh(roundedBox(0.74, 0.06, 0.06, 0.02), trim, [x, 0.72, 0.67]))
    for (const o of [-0.26, 0.26]) {
      g.add(mesh(roundedBox(0.08, 0.16, 0.07, 0.03), P.rubber(0x25282f), [x + o, 0.16, 0.7]))
    }
  }
  for (let i = 0; i < 4; i++) {
    g.add(mesh(roundedBox(0.2, 0.14, 0.03, 0.02), P.lit('lit', 1.1), [-0.66 + i * 0.44, 0.78, 0.662]))
  }
  g.add(occlusion(3.4, 0.5))
  return { group: g, dist: 4.1, target: V(0, 0.55, 0) }
}
