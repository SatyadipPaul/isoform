/**
 * Edge and network parts — where traffic is shaped before it reaches compute.
 */

import * as THREE from 'three'
import { HUE, palette, registerTintable } from '../foundry/materials.js'
import {
  V,
  cylinder,
  drum,
  mesh,
  occlusion,
  plane,
  roundedBox,
  sphere,
  tubeMesh,
} from '../foundry/geometry.js'
import type { PartBuild } from './types.js'

/** Edge node: a globe with meridians, surface pins and routed arcs between them. */
export function cdn(): PartBuild {
  const g = new THREE.Group()
  const P = palette('edge')
  const R = 0.76
  const cy = 0.94

  g.add(mesh(sphere(R, 48, 32), P.polymer('body'), [0, cy, 0]))

  /* A LineBasicMaterial, so it never came from a finish preset — but it does
     carry the category's lit token, and the catalog retints it. Registering it
     keeps it in step with theme changes. */
  const wireMat = new THREE.LineBasicMaterial({
    color: HUE.edge.lit,
    transparent: true,
    opacity: 0.42,
  })
  registerTintable(wireMat, 'edge', 'lit')

  const wires = new THREE.Group()
  for (let i = 0; i < 8; i++) {
    const cur = new THREE.EllipseCurve(0, 0, R * 1.004, R * 1.004, 0, Math.PI * 2, false, 0)
    const pts = cur.getPoints(72).map((p) => V(p.x, p.y, 0))
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat)
    l.rotation.y = (i * Math.PI) / 8
    wires.add(l)
  }
  for (const y of [-0.45, 0, 0.45]) {
    const r = Math.sqrt(Math.max(0.001, R * R - y * y)) * 1.004
    const cur = new THREE.EllipseCurve(0, 0, r, r, 0, Math.PI * 2, false, 0)
    const pts = cur.getPoints(72).map((p) => V(p.x, y, p.y))
    wires.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat))
  }
  wires.position.y = cy
  g.add(wires)

  const pins: THREE.Vector3[] = []
  const pinLit = P.lit('lit', 2.6)
  const pinSteel = P.steel(0xb4bdcb)
  for (const s of [
    [0.5, 0.7],
    [1.9, 0.3],
    [3.3, 0.9],
    [4.6, 0.5],
    [2.6, -0.4],
    [5.6, -0.1],
  ]) {
    const lon = s[0]
    const lat = s[1]
    const p = V(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))
    pins.push(p)
    const pin = new THREE.Group()
    pin.add(mesh(cylinder(0.014, 0.022, 0.16, 12), pinSteel, [0, 0.08, 0]))
    pin.add(mesh(sphere(0.052, 18, 14), pinLit, [0, 0.19, 0]))
    pin.position.copy(p.clone().multiplyScalar(R))
    pin.quaternion.setFromUnitVectors(V(0, 1, 0), p.clone().normalize())
    wires.add(pin)
  }
  const arcMat = P.lit('lit', 1.5)
  for (let i = 0; i < 4; i++) {
    const a = pins[i]
    const b = pins[(i + 2) % pins.length]
    const mid = a.clone().add(b).normalize().multiplyScalar(R * 1.34)
    const arc = new THREE.QuadraticBezierCurve3(
      a.clone().multiplyScalar(R),
      mid,
      b.clone().multiplyScalar(R),
    )
    wires.add(tubeMesh(arc, 0.016, arcMat, 36))
  }

  g.add(mesh(cylinder(0.06, 0.1, 0.2, 20), P.steel(0x99a2b1), [0, 0.1, 0]))
  g.add(mesh(drum(0.3, 0.05, 0.02, 40), P.powder('trim'), [0, 0, 0]))
  g.add(occlusion(2.9, 0.4))

  return {
    group: g,
    dist: 3.5,
    target: V(0, 0.9, 0),
    animated: [wires],
    update: (t) => {
      wires.rotation.y = t * 0.22
    },
  }
}

/**
 * DNS: a signpost.
 *
 * Four fingerboards on a post, each pointing somewhere else. Resolution is
 * "which way to this name", and a signpost is the object that has meant exactly
 * that for two centuries — no glyph gets close, and the silhouette survives
 * being shrunk to a palette tile.
 */
export function dns(): PartBuild {
  const g = new THREE.Group()
  const P = palette('edge')
  const post = P.anodised('trim')
  const board = P.polymer('body')
  const steel = P.steel(0xa7b0c0)

  g.add(mesh(drum(0.34, 0.07, 0.025, 36), P.powder('trim'), [0, 0, 0]))
  g.add(mesh(cylinder(0.075, 0.095, 1.62, 20), post, [0, 0.81, 0]))
  g.add(mesh(sphere(0.1, 20, 16), steel, [0, 1.66, 0]))

  /* Each board hangs off the post at its own height and heading. The pointed
     end is a separate wedge so the outline reads as an arrow from any angle. */
  const arms = new THREE.Group()
  const HEADINGS = [0.3, 1.9, 3.5, 5.0]
  const HEIGHTS = [1.44, 1.2, 0.96, 0.72]
  HEADINGS.forEach((h, i) => {
    const arm = new THREE.Group()
    arm.add(mesh(roundedBox(0.66, 0.19, 0.05, 0.02), board, [0.42, 0, 0]))
    /* Rotated square = the arrow tip, at a quarter turn about the long axis. */
    arm.add(mesh(roundedBox(0.135, 0.135, 0.05, 0.015), board, [0.79, 0, 0], [0, 0, Math.PI / 4]))
    /* Lettering band, sitting *on* the board's face at z=0.025 rather than
       inside it. It was 0.055 deep centred at z=0.006, which buried most of it
       in a board only 0.05 thick and left a sliver poking out of both sides,
       z-fighting on each — so three of the four boards showed nothing at all.

       On both faces, because the four boards point four different ways: a band
       on one side alone left half of them blank from any given viewpoint, which
       is the same failure by a different route. A real signpost is painted both
       sides for exactly this reason. */
    for (const face of [0.031, -0.031]) {
      arm.add(mesh(roundedBox(0.44, 0.05, 0.012, 0.004), P.lit('lit', 1.3), [0.4, -0.035, face]))
    }
    arm.add(mesh(cylinder(0.02, 0.02, 0.1, 10), steel, [0.1, 0, 0], [Math.PI / 2, 0, 0]))
    arm.position.y = HEIGHTS[i]
    arm.rotation.y = h
    arms.add(arm)
  })
  g.add(arms)
  g.add(occlusion(2.6, 0.4))

  return {
    group: g,
    dist: 3.6,
    target: V(0, 1.0, 0),
    animated: [arms],
    update: (t) => {
      /* A slow sway, not a spin: a signpost that revolves is a weathervane. */
      arms.rotation.y = Math.sin(t * 0.45) * 0.16
    },
  }
}

/** Firewall: brick wall with a real mortar recess in the normal map. */
export function firewall(): PartBuild {
  const g = new THREE.Group()
  const P = palette('edge')
  const brick = P.powder('body', { surface: 'brick' })

  g.add(mesh(roundedBox(1.9, 1.2, 0.3, 0.03), brick, [0, 0.68, 0]))
  g.add(mesh(roundedBox(2.0, 0.1, 0.4, 0.03), P.powder(0x2c3039), [0, 0.05, 0]))
  g.add(mesh(roundedBox(1.96, 0.08, 0.36, 0.03), P.anodised('trim'), [0, 1.31, 0]))
  for (const s of [-1, 1]) {
    g.add(mesh(roundedBox(0.16, 1.0, 0.44, 0.03), brick, [s * 0.87, 0.58, 0]))
  }

  /* Pulses every frame, so it owns its material — see the cache halo. */
  const slitMat = P.lit('lit', 2.2, { unique: true })
  const slit = mesh(plane(1.5, 0.09), slitMat, [0, 0.68, 0.153])
  g.add(slit)
  g.add(occlusion(3.2, 0.5))

  return {
    group: g,
    dist: 3.7,
    target: V(0, 0.66, 0),
    animated: [slit],
    update: (t) => {
      slitMat.emissiveIntensity = 1.6 + Math.sin(t * 2.4) * 0.7
    },
  }
}
