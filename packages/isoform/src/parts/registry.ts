/**
 * Part registry — the single place that maps a `PartId` to geometry.
 *
 * Nothing above this layer imports a builder directly. The document stores
 * `type: 'service'`; the reconciler asks the registry for it.
 *
 * On sharing: builders run per instance rather than being built once and
 * cloned. The sharing that matters happens a level down — every parametric
 * geometry and every material is memoised in the foundry — so a second
 * `service` costs a few dozen Mesh wrappers and no new GPU resources. Cloning a
 * prototype instead would break animation, because each part's `update` closure
 * captures its own meshes and materials; every clone would drive the
 * prototype's state and all instances would move in lockstep.
 */

import * as THREE from 'three'
import { balancer, container, gateway, lambda, model, service, worker } from './compute.js'
import { blob, cache, database, search, vectordb, warehouse } from './data.js'
import { queue, stream } from './msg.js'
import { cdn, dns, firewall } from './netedge.js'
import { auth, monitor, registry } from './ops.js'
import { actor, client, external, mobile } from './client.js'
import { boundary } from './boundary.js'
import { MANIFESTS } from './manifests.js'
import { PORT_IDS } from './types.js'
import type {
  FanSlot,
  PartBuild,
  PartBuilder,
  PartId,
  PartManifest,
  PortId,
  PortTransform,
} from './types.js'

const BUILDERS: Record<PartId, PartBuilder> = {
  service,
  gateway,
  balancer,
  lambda,
  container,
  worker,
  model,
  database,
  cache,
  blob,
  warehouse,
  search,
  vectordb,
  queue,
  stream,
  cdn,
  firewall,
  dns,
  auth,
  monitor,
  registry,
  client,
  actor,
  mobile,
  external,
  boundary: () => boundary(),
}

export function builderFor(id: PartId): PartBuilder {
  const b = BUILDERS[id]
  if (!b) throw new Error(`Isoform: unknown part "${id}"`)
  return b
}

/** Build a fresh instance of a part. */
export function build(id: PartId): PartBuild {
  return builderFor(id)()
}

export function manifestFor(id: PartId): PartManifest {
  return MANIFESTS[id]
}

/**
 * True extent of a part's geometry, contact-shadow blobs excluded.
 *
 * The blob is a 2.7u ground plane under a 1.6u chassis, so including it would
 * make every part's bounds meaningless. Measured once per part and cached.
 */
const boundsCache = new Map<PartId, THREE.Box3>()

export function measure(id: PartId): THREE.Box3 {
  const hit = boundsCache.get(id)
  if (hit) return hit
  const box = measureBounds(build(id).group)
  boundsCache.set(id, box)
  return box
}

export function measureBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  const tmp = new THREE.Box3()
  root.traverse((o) => {
    if (o.userData.isShadow) return
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!g) return
    if (!g.boundingBox) g.computeBoundingBox()
    if (!g.boundingBox) return
    tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld)
    box.union(tmp)
  })
  return box
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * How far across a face co-located connectors may spread, as a fraction of the
 * half-face. Below 1 so a fan never reaches the corner and collide with a
 * neighbouring anchor.
 */
const FAN_SPREAD = 0.62

/**
 * World-space position and outward normal of one of a part's four anchors.
 *
 * `fan` spreads connectors that share an anchor across its face. Four anchors
 * would otherwise stack every route from the same direction into one line —
 * this is what lets a gateway still read as three routes arriving on its west
 * side without reintroducing bespoke per-part port lists.
 *
 * The router consumes this; nothing else should compute port positions.
 */
/**
 * Anything a connector can attach to: a ground-plane extent and a height.
 *
 * Introduced so a *group boundary* can carry connectors too. A group is a box
 * with a size and no manifest, and everything below only ever needed the
 * footprint and the port height — the part id was standing in for those two
 * numbers. Taking the box directly is what lets a tier be wired up as one thing
 * rather than forcing every line to land on some arbitrary member inside it.
 */
export interface PortBox {
  w: number
  d: number
  /** Height at which connectors meet it. */
  y: number
}

export function portBoxOf(id: PartId): PortBox {
  const m = MANIFESTS[id]
  return { w: m.footprint.w, d: m.footprint.d, y: m.portY }
}

/**
 * Which face each compass anchor sits on.
 *
 * Derived here rather than read from a manifest's `ports` array, because that
 * array is itself derived from exactly this mapping — and a box has no manifest
 * to read it from.
 */
const SIDE: Record<PortId, { axis: 'x' | 'z'; sign: 1 | -1 }> = {
  n: { axis: 'z', sign: -1 },
  e: { axis: 'x', sign: 1 },
  s: { axis: 'z', sign: 1 },
  w: { axis: 'x', sign: -1 },
}

/** World-space position and outward normal of one anchor on a box. */
export function boxPort(
  box: PortBox,
  portId: PortId,
  origin: THREE.Vector3,
  yaw = 0,
  fan?: FanSlot,
): PortTransform {
  const hw = box.w / 2
  const hd = box.d / 2

  /* −1..+1 across the face; a lone connector sits dead centre. */
  const t = !fan || fan.of <= 1 ? 0 : (fan.slot / (fan.of - 1) - 0.5) * 2 * FAN_SPREAD

  const { axis, sign } = SIDE[portId]
  const local =
    axis === 'x'
      ? new THREE.Vector3(sign * hw, box.y, t * hd)
      : new THREE.Vector3(t * hw, box.y, sign * hd)
  const normal =
    axis === 'x' ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign)

  if (yaw) {
    local.applyAxisAngle(UP, yaw)
    normal.applyAxisAngle(UP, yaw)
  }
  return { position: local.add(origin), normal }
}

/** All four anchors of a box, in N/E/S/W order. */
export function boxPorts(
  box: PortBox,
  origin: THREE.Vector3,
  yaw = 0,
): Array<PortTransform & { id: PortId }> {
  return PORT_IDS.map((id) => ({ id, ...boxPort(box, id, origin, yaw) }))
}

export function portTransform(
  id: PartId,
  portId: PortId,
  origin: THREE.Vector3,
  yaw = 0,
  fan?: FanSlot,
): PortTransform | null {
  return boxPort(portBoxOf(id), portId, origin, yaw, fan)
}

/** All four anchors of a placed part, in N/E/S/W order. */
export function portsOf(
  id: PartId,
  origin: THREE.Vector3,
  yaw = 0,
): Array<PortTransform & { id: PortId }> {
  return boxPorts(portBoxOf(id), origin, yaw)
}

/**
 * The anchor of a placed part that best faces a world point.
 *
 * Used for snapping while dragging a connector: the anchor nearest the pointer
 * is often not the one that should catch it, because an anchor on the far side
 * can be closer in raw distance while facing away.
 */
export function nearestPort(
  id: PartId,
  origin: THREE.Vector3,
  yaw: number,
  toward: THREE.Vector3,
): (PortTransform & { id: PortId }) | null {
  return nearestBoxPort(portBoxOf(id), origin, yaw, toward)
}

/** As `nearestPort`, for anything with a footprint — a part or a group. */
export function nearestBoxPort(
  box: PortBox,
  origin: THREE.Vector3,
  yaw: number,
  toward: THREE.Vector3,
): (PortTransform & { id: PortId }) | null {
  let best: (PortTransform & { id: PortId }) | null = null
  let bestScore = Infinity
  for (const p of boxPorts(box, origin, yaw)) {
    const dir = toward.clone().sub(p.position)
    const dist = dir.length()
    if (dist < 1e-6) return p
    dir.divideScalar(dist)
    /* Facing the target is worth more than being marginally closer. */
    const facing = p.normal.dot(dir)
    const score = dist * (2 - facing)
    if (score < bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

export interface PortPair {
  from: PortTransform & { id: PortId }
  to: PortTransform & { id: PortId }
}

/**
 * Auto-snap: choose which anchor on each part a connector should use.
 *
 * Scores every one of the sixteen candidate pairs by separation, penalised by
 * how far each anchor's outward normal points away from the other part. Picking
 * on raw distance alone produces routes that leave the back of a part and wrap
 * around it, which is the single most common way 3D connectors look wrong.
 */
export function choosePortPair(
  fromId: PartId,
  fromOrigin: THREE.Vector3,
  toId: PartId,
  toOrigin: THREE.Vector3,
  opts: { fromYaw?: number; toYaw?: number; pinFrom?: PortId; pinTo?: PortId } = {},
): PortPair | null {
  return chooseBoxPortPair(
    { box: portBoxOf(fromId), origin: fromOrigin, yaw: opts.fromYaw ?? 0, pin: opts.pinFrom },
    { box: portBoxOf(toId), origin: toOrigin, yaw: opts.toYaw ?? 0, pin: opts.pinTo },
  )
}

/** One end of a candidate connector: where it is, how big, and any pinned anchor. */
export interface PortEnd {
  box: PortBox
  origin: THREE.Vector3
  yaw?: number
  pin?: PortId
}

/** As `choosePortPair`, for anything with a footprint — a part or a group. */
export function chooseBoxPortPair(a: PortEnd, b: PortEnd): PortPair | null {
  const fromPorts = boxPorts(a.box, a.origin, a.yaw ?? 0).filter((p) => !a.pin || p.id === a.pin)
  const toPorts = boxPorts(b.box, b.origin, b.yaw ?? 0).filter((p) => !b.pin || p.id === b.pin)

  let best: PortPair | null = null
  let bestScore = Infinity
  for (const a of fromPorts) {
    for (const b of toPorts) {
      const ab = b.position.clone().sub(a.position)
      const dist = ab.length()
      if (dist < 1e-6) continue
      ab.divideScalar(dist)
      const outward = a.normal.dot(ab)
      const inward = b.normal.dot(ab.clone().negate())
      const score = dist * (2 - outward) * (2 - inward)
      if (score < bestScore) {
        bestScore = score
        best = { from: a, to: b }
      }
    }
  }
  return best
}

export { MANIFESTS, PART_IDS } from './manifests.js'
export { PORT_IDS } from './types.js'
export type {
  FanSlot,
  PartBuild,
  PartBuilder,
  PartId,
  PartManifest,
  PortId,
  PortSpec,
  PortTransform,
} from './types.js'
