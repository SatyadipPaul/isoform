/**
 * Connector construction and the drag-to-connect interaction.
 *
 * Routing here is still the simple L-route; the Phase 4 router replaces
 * `route()` and leaves everything either side of it — anchor choice, fan
 * slotting, and geometry emission — in place.
 */

import * as THREE from 'three'
import {
  R_LINK,
  arrowHead,
  choosePortPair,
  dashedRun,
  elbowCurve,
  nearestPort,
  palette,
  portTransform,
  tubeMesh,
  type PartId,
  type PortId,
  type PortTransform,
} from '@isoform/engine'

export interface PlacedNode {
  key: string
  type: PartId
  x: number
  z: number
  yaw?: number
}

export interface Link {
  from: string
  to: string
  dashed?: boolean
  /** Set only when the user pinned an anchor by dragging from it. */
  pinFrom?: PortId
  pinTo?: PortId
}

const link = palette('link')
const wire = link.steel('body')
const tip = link.lit('lit', 2.2)
const ghostMat = link.lit('lit', 1.4)

/** Lathed arrowhead length for a tube radius — see the foundry's `arrowGeo`. */
export const ARROW_R = R_LINK * 0.8
const ARROW_LEN = ARROW_R * 6.4
const LEAD = 0.45

function dedupe(pts: THREE.Vector3[]): THREE.Vector3[] {
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-4)
}

function pathLength(pts: THREE.Vector3[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += pts[i].distanceTo(pts[i - 1])
  return n
}

/**
 * L-route between two anchors: leave along each outward normal, then turn once.
 * Both orientations are tried and the shorter wins — turning on the source's own
 * axis looks squarer, but doubles the run back on itself when the target sits
 * behind that anchor.
 */
export function route(
  a: THREE.Vector3,
  na: THREE.Vector3,
  b: THREE.Vector3,
  nb: THREE.Vector3,
  arrowLen = ARROW_LEN,
): THREE.Vector3[] {
  const a1 = a.clone().addScaledVector(na, LEAD)
  /* Stop short by exactly one arrowhead so its tip lands on the part surface. */
  const bEnd = b.clone().addScaledVector(nb, arrowLen)
  const b1 = bEnd.clone().addScaledVector(nb, LEAD)
  const midY = (a1.y + b1.y) / 2

  const candidates = [
    [a, a1, new THREE.Vector3(b1.x, midY, a1.z), b1, bEnd],
    [a, a1, new THREE.Vector3(a1.x, midY, b1.z), b1, bEnd],
  ].map(dedupe)

  return pathLength(candidates[0]) <= pathLength(candidates[1]) ? candidates[0] : candidates[1]
}

export function buildConnector(
  a: PortTransform,
  b: PortTransform,
  dashed = false,
): THREE.Group {
  const curve = elbowCurve(route(a.position, a.normal, b.position, b.normal), 0.28)
  const g = new THREE.Group()
  g.add(dashed ? dashedRun(curve, R_LINK * 0.85, wire, 14) : tubeMesh(curve, R_LINK * 0.7, wire, 120))
  g.add(arrowHead(curve, 1, ARROW_R, tip))
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.castShadow = true
  })
  return g
}

/** A translucent preview drawn while the user is dragging a new connector. */
export function buildGhost(a: PortTransform, b: PortTransform): THREE.Group {
  const curve = elbowCurve(route(a.position, a.normal, b.position, b.normal, 0.02), 0.28)
  const g = new THREE.Group()
  g.add(tubeMesh(curve, R_LINK * 0.5, ghostMat, 60))
  return g
}

/**
 * Resolve every link to a concrete anchor pair, then fan out the ones sharing
 * an anchor.
 *
 * Two passes are necessary: which anchor a link uses depends only on geometry,
 * but where along that anchor's face it sits depends on how many other links
 * chose the same one.
 */
export function resolveLinks(
  nodes: Map<string, PlacedNode>,
  links: Link[],
): Array<{ link: Link; from: PortTransform; to: PortTransform }> {
  const origin = (n: PlacedNode): THREE.Vector3 => new THREE.Vector3(n.x, 0, n.z)

  type Choice = { link: Link; fromPort: PortId; toPort: PortId; a: PlacedNode; b: PlacedNode }
  const choices: Choice[] = []

  for (const l of links) {
    const a = nodes.get(l.from)
    const b = nodes.get(l.to)
    if (!a || !b) continue
    const pair = choosePortPair(a.type, origin(a), b.type, origin(b), {
      fromYaw: a.yaw ?? 0,
      toYaw: b.yaw ?? 0,
      pinFrom: l.pinFrom,
      pinTo: l.pinTo,
    })
    if (!pair) continue
    choices.push({ link: l, fromPort: pair.from.id, toPort: pair.to.id, a, b })
  }

  /* Count occupancy per (node, anchor) so co-located links can be spread. */
  const counts = new Map<string, number>()
  const bump = (key: string, port: PortId): void => {
    const k = `${key}/${port}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (const c of choices) {
    bump(c.link.from, c.fromPort)
    bump(c.link.to, c.toPort)
  }

  const used = new Map<string, number>()
  const take = (key: string, port: PortId): { slot: number; of: number } => {
    const k = `${key}/${port}`
    const slot = used.get(k) ?? 0
    used.set(k, slot + 1)
    return { slot, of: counts.get(k) ?? 1 }
  }

  const out: Array<{ link: Link; from: PortTransform; to: PortTransform }> = []
  for (const c of choices) {
    const from = portTransform(
      c.a.type,
      c.fromPort,
      origin(c.a),
      c.a.yaw ?? 0,
      take(c.link.from, c.fromPort),
    )
    const to = portTransform(
      c.b.type,
      c.toPort,
      origin(c.b),
      c.b.yaw ?? 0,
      take(c.link.to, c.toPort),
    )
    if (from && to) out.push({ link: c.link, from, to })
  }
  return out
}

/** Snap a world point to the best-facing anchor of a placed node. */
export function snapTo(node: PlacedNode, point: THREE.Vector3) {
  return nearestPort(node.type, new THREE.Vector3(node.x, 0, node.z), node.yaw ?? 0, point)
}
