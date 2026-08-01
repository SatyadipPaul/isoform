/**
 * Compute parts — ported from catalog section 4.
 *
 * Each is modelled as the object it actually represents rather than as a boxy
 * abstraction: a rack chassis, a gate, a flow manifold, a glyph, a shipping
 * container. The rule the catalog locks is that the silhouette must be
 * recognisable at 40px with no label.
 *
 * The only systematic change from the source is the material call shape:
 * `FINISH.powder(c.body)` becomes `P.powder('body')`. Passing the token name
 * rather than the resolved hex is what lets the material record its own role,
 * which is what makes retinting reliable. Raw hexes still mean "neutral
 * hardware" and are deliberately never retinted.
 */

import * as THREE from 'three'
import { palette } from '../foundry/materials.js'
import {
  V,
  arrowHead,
  cylinder,
  drum,
  extrudeShape,
  mesh,
  occlusion,
  plane,
  ringGeo,
  roundedBox,
  sphere,
  stub,
  tubeMesh,
} from '../foundry/geometry.js'
import type { PartBuild } from './types.js'

/** Rack-mount server chassis: mounting ears, drive bays, perforated intake. */
export function service(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')
  const shell = P.powder('body')
  const face = P.anodised('trim')
  const vent = P.powder('trim', { surface: 'vent' })

  g.add(mesh(roundedBox(1.62, 0.66, 1.16, 0.05), shell, [0, 0.36, 0]))
  g.add(mesh(roundedBox(1.5, 0.56, 0.05, 0.04), face, [0, 0.36, 0.585]))
  for (const x of [-0.86, 0.86]) {
    g.add(mesh(roundedBox(0.12, 0.6, 0.05, 0.03), face, [x, 0.36, 0.575]))
    for (const y of [0.5, 0.22]) {
      g.add(
        mesh(
          cylinder(0.026, 0.026, 0.06, 14),
          P.steel(0x9aa3b2),
          [x, y, 0.6],
          [Math.PI / 2, 0, 0],
        ),
      )
    }
  }
  g.add(mesh(plane(0.5, 0.5), vent, [-0.36, 0.36, 0.615]))
  for (let i = 0; i < 4; i++) {
    g.add(mesh(roundedBox(0.5, 0.1, 0.035, 0.02), P.polymer('trim'), [0.28, 0.14 + i * 0.145, 0.61]))
    g.add(
      mesh(
        roundedBox(0.035, 0.035, 0.02, 0.01),
        i === 1 ? P.lit('lit', 2.6) : P.lit(0x5ce0a8, 2.6),
        [0.5, 0.14 + i * 0.145, 0.622],
      ),
    )
  }
  g.add(mesh(roundedBox(0.09, 0.09, 0.02, 0.02), P.lit('lit', 3), [-0.66, 0.14, 0.62]))
  for (let i = 0; i < 5; i++) {
    g.add(mesh(roundedBox(1.0, 0.02, 0.05, 0.008), face, [0, 0.695, -0.36 + i * 0.18]))
  }
  g.add(mesh(roundedBox(1.5, 0.05, 1.0, 0.02), P.rubber(0x22252c), [0, 0.025, 0]))
  g.add(occlusion(2.7))
  return { group: g, dist: 3.5, target: V(0, 0.4, 0) }
}

/** API gateway: an actual gate. Three routes enter, one leaves through the aperture. */
export function gateway(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')
  const body = P.polymer('body')
  const post = P.anodised('trim')
  const steel = P.steel(0xa7b0c0)

  g.add(mesh(roundedBox(2.0, 0.16, 1.05, 0.05), P.powder('trim'), [0, 0.08, 0]))
  for (const x of [-0.72, 0.72]) {
    g.add(mesh(roundedBox(0.2, 1.0, 0.62, 0.05), post, [x, 0.66, 0]))
  }

  const archShape = new THREE.Shape()
  archShape.absarc(0, 0, 0.82, 0, Math.PI, false)
  archShape.absarc(0, 0, 0.62, Math.PI, 0, true)
  g.add(mesh(extrudeShape(archShape, 0.62, 0.03, 'gateway-arch'), body, [0, 1.16, 0]))

  /* The aperture is a plane read from both sides, so DoubleSide has to be part
     of the material identity rather than a mutation after the fact. */
  g.add(
    mesh(plane(1.24, 1.5), P.lit('lit', 0.75, { side: THREE.DoubleSide }), [0, 0.86, 0]),
  )

  /* Modelled pipework: three routes in, one out. Struck from the part as soon
     as a real edge lands on it — see `stub` in the foundry. */
  for (const z of [-0.34, 0, 0.34]) {
    const cin = new THREE.CatmullRomCurve3([
      V(-1.9, 0.34, z * 1.6),
      V(-1.2, 0.34, z * 0.9),
      V(-0.55, 0.34, z * 0.2),
    ])
    g.add(stub(tubeMesh(cin, 0.036, steel, 40)))
  }
  const out = new THREE.CatmullRomCurve3([V(0.55, 0.34, 0), V(1.3, 0.34, 0), V(1.85, 0.34, 0)])
  g.add(stub(tubeMesh(out, 0.05, steel, 40)))
  g.add(stub(arrowHead(out, 1, 0.05, P.lit('lit', 2.2))))
  g.add(occlusion(3.6, 0.42))
  return { group: g, dist: 4.3, target: V(0, 0.65, 0) }
}

/** Load balancer: flow manifold with a spinning balance vane feeding three legs. */
export function balancer(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')
  const body = P.anodised('body')
  const steel = P.steel(0xaab3c2)
  const lit = P.lit('lit', 2.4)

  g.add(mesh(cylinder(0.3, 0.3, 0.62, 40), body, [-0.15, 0.46, 0], [0, 0, Math.PI / 2]))
  g.add(mesh(ringGeo(0.305, 0.03, 44), steel, [0.16, 0.46, 0], [0, 0, Math.PI / 2]))
  g.add(mesh(cylinder(0.13, 0.13, 0.6, 28), steel, [-0.75, 0.46, 0], [0, 0, Math.PI / 2]))
  g.add(mesh(ringGeo(0.15, 0.028, 32), steel, [-1.02, 0.46, 0], [0, 0, Math.PI / 2]))

  const vane = mesh(roundedBox(0.34, 0.34, 0.03, 0.02), lit, [-0.15, 0.46, 0])
  g.add(vane)

  for (const z of [-0.5, 0, 0.5]) {
    const arm = new THREE.CatmullRomCurve3([
      V(0.16, 0.46, 0),
      V(0.5, 0.46, z * 0.55),
      V(0.95, 0.46, z),
      V(1.2, 0.46, z),
    ])
    /* The legs are structure and stay; only the flow arrows are stubs. */
    g.add(tubeMesh(arm, 0.085, body, 50))
    g.add(mesh(ringGeo(0.105, 0.024, 28), steel, [1.1, 0.46, z], [0, 0, Math.PI / 2]))
    g.add(stub(arrowHead(arm, 1, 0.06, lit)))
  }
  g.add(mesh(roundedBox(0.44, 0.9, 0.44, 0.05), P.powder('trim'), [-0.15, 0.02, 0]))
  g.add(occlusion(3.1, 0.42))

  return {
    group: g,
    dist: 3.9,
    target: V(0.1, 0.5, 0),
    animated: [vane],
    update: (t) => {
      vane.rotation.x = t * 1.1
    },
  }
}

/** Serverless: the λ glyph in three filleted strokes, floating clear of its datum rings. */
export function lambda(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')
  const body = P.polymer('body')

  const glyph = new THREE.Group()
  const stroke = (x1: number, y1: number, x2: number, y2: number, w: number): THREE.Mesh => {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    return mesh(
      roundedBox(len, w, 0.2, 0.05),
      body,
      [(x1 + x2) / 2, (y1 + y2) / 2, 0],
      [0, 0, Math.atan2(dy, dx)],
    )
  }
  glyph.add(stroke(-0.34, 0.3, 0.3, -0.42, 0.2))
  glyph.add(stroke(-0.3, -0.42, 0.0, -0.06, 0.2))
  glyph.add(stroke(-0.5, 0.42, -0.24, 0.22, 0.18))
  glyph.position.y = 0.86
  g.add(glyph)

  g.add(mesh(ringGeo(0.62, 0.016, 72), P.lit('lit', 1.2), [0, 0.02, 0], [Math.PI / 2, 0, 0]))
  g.add(mesh(ringGeo(0.44, 0.01, 64), P.lit('lit', 0.6), [0, 0.02, 0], [Math.PI / 2, 0, 0]))
  g.add(occlusion(2.5, 0.35))

  return {
    group: g,
    dist: 3.2,
    target: V(0, 0.78, 0),
    animated: [glyph],
    update: (t) => {
      glyph.position.y = 0.86 + Math.sin(t * 1.4) * 0.055
      glyph.rotation.y = Math.sin(t * 0.5) * 0.14
    },
  }
}

/**
 * Worker: an articulated arm working a parts tray.
 *
 * The queue and the event stream both ship with nothing to consume them, which
 * left "queue → worker" — the most common pair in any asynchronous diagram —
 * undrawable. An arm rather than another chassis: the silhouette has to say
 * *doing* at 40px, and a second box with a different badge would not.
 */
export function worker(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')
  const body = P.powder('body')
  const joint = P.anodised('trim')
  const steel = P.steel(0x9aa3b2)

  /* Base kept deliberately low and small. The first cut gave it a 1.5u bench
     that swallowed the arm, and the part read as furniture — at thumbnail size
     whichever mass is largest is the one the silhouette becomes. */
  g.add(mesh(roundedBox(1.15, 0.09, 0.86, 0.03), P.powder('trim'), [-0.1, 0.045, 0]))
  g.add(mesh(drum(0.3, 0.14, 0.04, 32), joint, [-0.36, 0.09, 0]))
  g.add(mesh(cylinder(0.17, 0.21, 0.42, 24), joint, [-0.36, 0.42, 0]))

  /* Nested groups, so each joint rotates about its own pivot and the segments
     below inherit it — the arm has to fold, not slide. */
  const shoulder = new THREE.Group()
  shoulder.position.set(-0.36, 0.62, 0)
  /* Built folded, not straight. `update` overwrites both angles on the first
     frame, but the rest pose is what the palette thumbnail and the merged
     geometry are made from — an arm authored horizontal reads as a girder.
     Positive Z lifts: the arm has to rise out of its base, not sink through
     the floor it stands on. */
  /* Chosen so the gripper clears the floor at every point of the cycle. At
     0.5 / -0.95 with a ±0.2 / ±0.3 swing the arm reached full extension pointing
     down and put the gripper 0.022 *below* the ground plane. */
  const SHOULDER_REST = 0.55
  const ELBOW_REST = -0.85
  shoulder.rotation.z = SHOULDER_REST

  const upper = new THREE.Group()
  upper.add(mesh(roundedBox(0.82, 0.26, 0.28, 0.08), body, [0.41, 0, 0]))
  upper.add(mesh(cylinder(0.15, 0.15, 0.34, 20), steel, [0, 0, 0], [Math.PI / 2, 0, 0]))
  shoulder.add(upper)

  const elbow = new THREE.Group()
  elbow.position.set(0.82, 0, 0)
  elbow.rotation.z = ELBOW_REST
  elbow.add(mesh(cylinder(0.13, 0.13, 0.3, 20), steel, [0, 0, 0], [Math.PI / 2, 0, 0]))
  elbow.add(mesh(roundedBox(0.68, 0.21, 0.23, 0.07), body, [0.34, 0, 0]))

  /* Two opposed fingers rather than a suction cup: an open gripper reads as
     "holding something" even when the thing it holds is two pixels wide. */
  const grip = new THREE.Group()
  grip.position.set(0.68, 0, 0)
  grip.add(mesh(roundedBox(0.16, 0.19, 0.19, 0.04), joint))
  for (const s of [-1, 1]) {
    grip.add(mesh(roundedBox(0.21, 0.055, 0.07, 0.02), steel, [0.17, s * 0.07, 0]))
  }
  grip.add(mesh(roundedBox(0.14, 0.14, 0.14, 0.025), P.polymer('lit'), [0.31, 0, 0]))
  elbow.add(grip)
  shoulder.add(elbow)
  g.add(shoulder)

  /* The tray is the work waiting to be done — the visual half of the pair. */
  /* Wholly on the bench: the tray was centred at 0.28 and 0.56 wide, running to
     0.56 against a plate ending at 0.475, so it hung off the edge. */
  g.add(mesh(roundedBox(0.5, 0.07, 0.62, 0.03), P.anodised('trim'), [0.16, 0.12, 0]))
  for (let i = 0; i < 3; i++) {
    g.add(
      mesh(
        roundedBox(0.15, 0.15, 0.15, 0.03),
        P.polymer('lit'),
        [0.05 + (i % 2) * 0.2, 0.23, -0.17 + i * 0.17],
        [0, i * 0.5, 0],
      ),
    )
  }
  g.add(mesh(roundedBox(0.07, 0.07, 0.02, 0.02), P.lit('lit', 3), [-0.55, 0.14, 0.4]))
  g.add(occlusion(2.9, 0.42))

  return {
    group: g,
    dist: 3.5,
    target: V(0, 0.45, 0),
    /* Only the two joint groups are listed. Everything they carry moves with
       them, and everything else stays mergeable. */
    animated: [shoulder, elbow],
    update: (t) => {
      /* One pick-and-place cycle: swing to the tray, reach down, swing back.
         Both joints oscillate about the pose the arm was built in, so the
         merged geometry and the live rig never disagree about where it rests. */
      const c = t * 0.9
      shoulder.rotation.y = Math.sin(c) * 0.5
      shoulder.rotation.z = SHOULDER_REST + Math.sin(c * 2) * 0.18
      elbow.rotation.z = ELBOW_REST + Math.sin(c * 2 + 0.6) * 0.25
    },
  }
}

/**
 * Model endpoint: a physical layered net.
 *
 * Five plates of nodes with links between adjacent layers, and an activation
 * that travels front to back. Modelled rather than badged for the same reason
 * as everything else here — and because the layered stack is already how anyone
 * who would draw this thinks about it.
 */
export function model(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')
  const frame = P.anodised('trim')
  const node = P.polymer('body')

  /* 0.72 deep, not 1.05. The lattice is 0.5 deep, so the old plinth read as a
     large empty slab with a small net standing on it. */
  g.add(mesh(roundedBox(1.7, 0.12, 0.72, 0.04), P.powder('trim'), [0, 0.06, 0]))
  /* Two slim posts at the ends. The first cut used 0.9u-deep slabs here and
     they became the part — the net inside was invisible behind them. Whatever
     is meant to be read has to be the largest thing in the silhouette. */
  for (const x of [-0.8, 0.8]) {
    g.add(mesh(roundedBox(0.07, 1.02, 0.16, 0.025), frame, [x, 0.61, 0]))
    g.add(mesh(roundedBox(0.16, 0.06, 0.24, 0.02), frame, [x, 1.09, 0]))
  }

  const LAYERS = [3, 4, 4, 4, 3]
  const centres: THREE.Vector3[][] = []
  const net = new THREE.Group()

  LAYERS.forEach((count, li) => {
    const x = -0.6 + li * 0.3
    const col: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      const z = ((i - (count - 1) / 2) * 0.5) / Math.max(1, count - 1)
      const p = V(x, 0.62 + (i - (count - 1) / 2) * 0.21, z)
      col.push(p)
      /* Alternating body and lit down each column, so the layers separate by
         value as well as position and survive being shrunk to a palette tile. */
      net.add(mesh(sphere(0.072, 16, 12), i % 2 ? P.polymer('lit') : node, [p.x, p.y, p.z]))
    }
    centres.push(col)
  })

  /* Links are thin tubes rather than lines: a Line renders one pixel wide at
     any distance, which vanishes on a merged part seen from across a diagram.

     Each node reaches only its two nearest in the next layer, not all of them.
     Fully connecting the layers is 56 tubes and cost this part 80 draw calls
     articulated — and it looked worse, because at any size a diagram is
     actually read at, all-to-all collapses into a grey mat. Sparse reads as
     wiring. */
  const link = P.steel(0x7c869a)
  for (let li = 0; li < centres.length - 1; li++) {
    const next = centres[li + 1]
    centres[li].forEach((a, i) => {
      for (const j of [i, i + 1]) {
        const b = next[Math.min(j, next.length - 1)]
        if (b) net.add(tubeMesh(new THREE.CatmullRomCurve3([a, b]), 0.009, link, 1))
      }
    })
  }
  g.add(net)

  /* One travelling pane, owning its material because it pulses. Kept faint and
     double-sided: it is a wavefront passing through the net, and at full
     opacity it was simply a white wall in front of it. */
  const pulseMat = P.lit('lit', 2.0, {
    unique: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
  })
  const pulse = mesh(plane(0.62, 0.94), pulseMat, [-0.62, 0.62, 0], [0, Math.PI / 2, 0])
  g.add(pulse)
  g.add(occlusion(3.0, 0.42))

  return {
    group: g,
    dist: 3.7,
    target: V(0, 0.62, 0),
    animated: [pulse],
    update: (t) => {
      const u = (t * 0.5) % 1
      pulse.position.x = -0.62 + u * 1.24
      pulseMat.emissiveIntensity = 2.4 * Math.sin(u * Math.PI)
    },
  }
}

/** Container: an actual shipping container, corrugated, with corner castings. */
export function container(): PartBuild {
  const g = new THREE.Group()
  const P = palette('compute')

  const box = (x: number, y: number, z: number, s: number, ry?: number): THREE.Group => {
    const u = new THREE.Group()
    const skin = P.powder('body', { surface: 'corr' })
    u.add(mesh(roundedBox(1.3 * s, 0.62 * s, 0.66 * s, 0.03), skin))

    const rail = P.anodised('trim')
    for (const sy of [-0.31, 0.31]) {
      u.add(mesh(roundedBox(1.32 * s, 0.06 * s, 0.68 * s, 0.02), rail, [0, sy * s, 0]))
    }
    const cast = P.steel(0x8d96a6)
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          u.add(
            mesh(roundedBox(0.13 * s, 0.13 * s, 0.13 * s, 0.02), cast, [
              sx * 0.6 * s,
              sy * 0.27 * s,
              sz * 0.3 * s,
            ]),
          )
        }
      }
    }
    const door = P.powder('trim')
    u.add(mesh(roundedBox(0.03, 0.5 * s, 0.6 * s, 0.02), door, [0.655 * s, 0, 0]))
    for (const z2 of [-0.16, 0.16]) {
      u.add(
        mesh(cylinder(0.022 * s, 0.022 * s, 0.5 * s, 14), P.steel(0xa0a9b8), [
          0.675 * s,
          0,
          z2 * s,
        ]),
      )
    }
    u.position.set(x, y, z)
    u.rotation.y = ry ?? 0
    return u
  }

  g.add(box(-0.14, 0.34, 0.2, 1.0, 0.06))
  g.add(box(0.3, 0.32, -0.42, 0.9, -0.5))
  g.add(box(0.0, 0.94, 0.06, 0.82, 0.22))
  g.add(occlusion(3.1, 0.45))
  return { group: g, dist: 3.7, target: V(0, 0.55, 0) }
}
