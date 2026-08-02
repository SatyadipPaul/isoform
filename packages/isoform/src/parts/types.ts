import type * as THREE from 'three'
import type { Category } from '../foundry/materials.js'

/** Every part id the registry knows. */
export type PartId =
  | 'service'
  | 'gateway'
  | 'balancer'
  | 'lambda'
  | 'container'
  | 'worker'
  | 'model'
  | 'database'
  | 'cache'
  | 'blob'
  | 'warehouse'
  | 'search'
  | 'vectordb'
  | 'queue'
  | 'stream'
  | 'cdn'
  | 'firewall'
  | 'dns'
  | 'auth'
  | 'monitor'
  | 'registry'
  | 'client'
  | 'mobile'
  | 'external'
  | 'boundary'

export interface PartBuild {
  group: THREE.Group
  /** Camera distance that frames the part on a square tile. */
  dist: number
  /** Camera look-at, usually the visual centre of mass rather than the origin. */
  target: THREE.Vector3
  /** Per-frame animation, driven by elapsed seconds. */
  update?: (t: number) => void
  /**
   * Objects that `update` moves or mutates.
   *
   * Declared by hand, never inferred, and currently **advisory** — nothing in
   * the render layer reads it. This comment used to claim that a merge pass in
   * `render/lod.ts` folded every unlisted mesh into static geometry and that
   * this list was what kept the spinning vane alive. There is no `render/lod.ts`
   * — merging lives in `render/merge.ts`, it builds a *separate* group rather
   * than rewriting the articulated one, and LOD is a visibility flip between
   * the two. A merged part simply stops being ticked; nothing gets frozen into
   * a buffer, so nothing needs exempting.
   *
   * It is kept because it is the honest answer to "which meshes in this part
   * move", which is what an instancing pass would have to ask before it could
   * batch anything, and because `manifests.test.ts` uses it to assert that a
   * part with an `update` has actually said what that update touches.
   */
  animated?: THREE.Object3D[]
}

export type PartBuilder = () => PartBuild

/** Which face of the footprint a port sits on. */
export type PortSide = '+x' | '-x' | '+z' | '-z'

/**
 * Every part carries exactly these four connector anchors, at the centre of
 * each footprint face.
 *
 * Uniformity is the point. Parts previously declared their own semantic port
 * sets — the gateway three-in/one-out, the queue just in/out, the boundary
 * none — which meant a user could not predict where a connector would attach
 * without knowing the part. Four compass anchors on everything makes snapping
 * guessable, which is what makes it fast.
 *
 * The semantics that model carried are not lost: several connectors may share
 * one anchor and are fanned across the face by slot (see `portTransform`), so a
 * gateway still reads as three routes arriving on its west face.
 */
export type PortId = 'n' | 'e' | 's' | 'w'

export const PORT_IDS: readonly PortId[] = ['n', 'e', 's', 'w']

export interface PortSpec {
  id: PortId
  side: PortSide
  /** Height above the ground plane where a connector meets the part. */
  y: number
}

/** Where several connectors share one anchor, spread them across the face. */
export interface FanSlot {
  /** 0-based index among the connectors sharing this anchor. */
  slot: number
  /** How many share it. */
  of: number
}

export interface PortTransform {
  position: THREE.Vector3
  normal: THREE.Vector3
}

export interface PartManifest {
  id: PartId
  name: string
  /** Catalog part number, e.g. CMP-01. */
  pn: string
  cat: Category
  finish: string
  /** Ground-plane extent in grid units, used for snapping and route obstacles. */
  footprint: { w: number; d: number }
  height: number
  /** Height at which connectors meet this part. Drives all four anchors. */
  portY: number
  /** Always exactly four, derived from `footprint` and `portY`. */
  ports: PortSpec[]
  camera: { dist: number; target: [number, number, number] }
  desc: string
  spec: string[]
}
