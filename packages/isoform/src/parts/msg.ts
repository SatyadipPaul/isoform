/**
 * Messaging parts — acrylic shells, so the payload stays visible while it moves.
 * Both parts animate: direction is read from motion, not from a label.
 */

import * as THREE from 'three'
import { palette } from '../foundry/materials.js'
import {
  V,
  arrowHead,
  capsule,
  extrudeShape,
  mesh,
  occlusion,
  ringGeo,
  roundedBox,
  stub,
} from '../foundry/geometry.js'
import type { PartBuild } from './types.js'

/** Queue: open channel with clamp rings carrying envelopes, strictly FIFO. */
export function queue(): PartBuild {
  const g = new THREE.Group()
  const P = palette('msg')
  const rail = P.anodised('trim')

  g.add(mesh(capsule(0.4, 1.7), P.acrylic('body', 0.22), [0, 0.46, 0], [0, 0, Math.PI / 2]))
  for (let i = -2; i <= 2; i++) {
    g.add(mesh(ringGeo(0.408, 0.022, 48), rail, [i * 0.42, 0.46, 0], [0, 0, Math.PI / 2]))
  }
  g.add(mesh(roundedBox(2.1, 0.07, 0.5, 0.03), P.powder('trim'), [0, 0.035, 0]))

  const msgs: THREE.Group[] = []
  for (let i = 0; i < 3; i++) {
    const env = new THREE.Group()
    env.add(mesh(roundedBox(0.34, 0.24, 0.05, 0.03), P.polymer('lit')))
    const flap = new THREE.Shape()
    flap.moveTo(-0.16, 0.11)
    flap.lineTo(0, -0.02)
    flap.lineTo(0.16, 0.11)
    flap.lineTo(0.13, 0.11)
    flap.lineTo(0, 0.02)
    flap.lineTo(-0.13, 0.11)
    flap.closePath()
    env.add(
      mesh(extrudeShape(flap, 0.012, 0.004, 'queue-flap'), P.polymer('trim'), [0, 0.02, 0.032]),
    )
    env.position.set(-0.6 + i * 0.6, 0.46, 0)
    msgs.push(env)
    g.add(env)
  }

  const exit = new THREE.CatmullRomCurve3([V(1.05, 0.46, 0), V(1.25, 0.46, 0), V(1.4, 0.46, 0)])
  g.add(stub(arrowHead(exit, 1, 0.05, P.lit('lit', 2.2))))
  g.add(occlusion(3.3, 0.42))

  return {
    group: g,
    dist: 3.6,
    target: V(0, 0.44, 0),
    animated: msgs,
    update: (t) => {
      msgs.forEach((m, i) => {
        m.position.x = ((t * 0.4 + i * 0.333) % 1) * 2.0 - 1.0
        m.rotation.z = Math.sin(t * 2 + i) * 0.09
      })
    },
  }
}

/** Event stream: three partitions of an append-only log, heads travelling independently. */
export function stream(): PartBuild {
  const g = new THREE.Group()
  const P = palette('msg')
  const seg = P.polymer('body')
  const rail = P.anodised('trim')

  const heads: THREE.Mesh[] = []
  const lanes: number[] = []

  ;[-0.42, 0, 0.42].forEach((z, li) => {
    g.add(mesh(roundedBox(2.0, 0.05, 0.3, 0.02), rail, [0, 0.06, z]))
    for (let i = 0; i < 9; i++) {
      /* Written segments are solid, unwritten are acrylic. The uneven fill
         across lanes is what makes it read as a live log rather than a bar chart. */
      const filled = i < 6 + (li % 2)
      g.add(
        mesh(
          roundedBox(0.18, 0.22, 0.24, 0.03),
          filled ? seg : P.acrylic('body', 0.14),
          [-0.85 + i * 0.21, 0.2, z],
        ),
      )
    }
    for (let i = 0; i < 5; i++) {
      g.add(mesh(roundedBox(0.015, 0.012, 0.05, 0.004), rail, [-0.85 + i * 0.42, 0.09, z + 0.17]))
    }
    const head = mesh(roundedBox(0.05, 0.3, 0.3, 0.02), P.lit('lit', 2.4), [0, 0.22, z])
    heads.push(head)
    lanes.push(li)
    g.add(head)
  })

  g.add(mesh(roundedBox(2.2, 0.05, 1.35, 0.03), P.powder('trim'), [0, 0.025, 0]))
  g.add(occlusion(3.4, 0.42))

  return {
    group: g,
    dist: 3.7,
    target: V(0, 0.25, 0),
    animated: heads,
    update: (t) => {
      heads.forEach((h, i) => {
        h.position.x = ((t * (0.16 + lanes[i] * 0.05)) % 1) * 1.9 - 0.95
      })
    },
  }
}
