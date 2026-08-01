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
import { client, external, mobile } from './client.js'
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
export function portTransform(
  id: PartId,
  portId: PortId,
  origin: THREE.Vector3,
  yaw = 0,
  fan?: FanSlot,
): PortTransform | null {
  const m = MANIFESTS[id]
  const spec = m.ports.find((p) => p.id === portId)
  if (!spec) return null

  const hw = m.footprint.w / 2
  const hd = m.footprint.d / 2

  /* −1..+1 across the face; a lone connector sits dead centre. */
  const t = !fan || fan.of <= 1 ? 0 : (fan.slot / (fan.of - 1) - 0.5) * 2 * FAN_SPREAD

  let local: THREE.Vector3
  let normal: THREE.Vector3
  switch (spec.side) {
    case '-x':
      local = new THREE.Vector3(-hw, spec.y, t * hd)
      normal = new THREE.Vector3(-1, 0, 0)
      break
    case '+x':
      local = new THREE.Vector3(hw, spec.y, t * hd)
      normal = new THREE.Vector3(1, 0, 0)
      break
    case '-z':
      local = new THREE.Vector3(t * hw, spec.y, -hd)
      normal = new THREE.Vector3(0, 0, -1)
      break
    case '+z':
      local = new THREE.Vector3(t * hw, spec.y, hd)
      normal = new THREE.Vector3(0, 0, 1)
      break
  }

  if (yaw) {
    local.applyAxisAngle(UP, yaw)
    normal.applyAxisAngle(UP, yaw)
  }
  return { position: local.add(origin), normal }
}

/** All four anchors of a placed part, in N/E/S/W order. */
export function portsOf(
  id: PartId,
  origin: THREE.Vector3,
  yaw = 0,
): Array<PortTransform & { id: PortId }> {
  return PORT_IDS.map((pid) => {
    const t = portTransform(id, pid, origin, yaw)!
    return { id: pid, ...t }
  })
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
  let best: (PortTransform & { id: PortId }) | null = null
  let bestScore = Infinity
  for (const p of portsOf(id, origin, yaw)) {
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
  const fromPorts = portsOf(fromId, fromOrigin, opts.fromYaw ?? 0).filter(
    (p) => !opts.pinFrom || p.id === opts.pinFrom,
  )
  const toPorts = portsOf(toId, toOrigin, opts.toYaw ?? 0).filter(
    (p) => !opts.pinTo || p.id === opts.pinTo,
  )

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
