/**
 * The document.
 *
 * THE DOC IS TRUTH; three.js objects are a projection of it. Commands mutate
 * the Doc, the reconciler diffs and patches the scene. Undo/redo, save/load,
 * text import, PNG and glTF export all fall out of that one decision rather
 * than each being built separately — and nothing in the tools or editor layer
 * is allowed to touch an Object3D directly.
 *
 * Everything here is plain JSON: no class instances, no Vector3, no undefined
 * where null would do. That is what makes structural equality, serialisation
 * and the undo property test all work without special cases.
 */

import type { Category } from '../foundry/materials.js'
import type { PartId, PortId } from '../parts/types.js'

/* Re-exported so document authors import their vocabulary from one place. The
   type lives in the foundry because it is defined by how it renders — six states
   are only worth having if every diagram draws them identically. */
import type { NodeState } from '../foundry/appearance.js'
export { NODE_STATES, type NodeState } from '../foundry/appearance.js'

/** Connector style. Routing mode is a separate axis — see route/. */
export type EdgeKind = 'sync' | 'async' | 'duplex' | 'flow' | 'secure'

export const EDGE_KINDS: readonly EdgeKind[] = ['sync', 'async', 'duplex', 'flow', 'secure']

export type CameraPreset = 'hero' | 'iso' | 'top' | 'free'

export interface DocNode {
  id: string
  type: PartId
  label?: string
  sublabel?: string
  /** Ground-plane placement, in grid units. */
  pos: [number, number]
  /** Tier height, for stacked placement. Defaults to 0. */
  y?: number
  /** Yaw in radians. */
  rot: number
  scale?: number
  /** Per-node hue override; absent means the category theme applies. */
  tint?: string
  /**
   * What the node is doing, as opposed to what colour it is.
   *
   * Absent and 'healthy' render identically. They differ only as a claim: one
   * says nothing, the other says someone checked. Keeping both means a document
   * can distinguish an unaudited system from an audited one that is fine.
   */
  state?: NodeState
}

export interface DocEdgeEnd {
  /**
   * What this end attaches to: a node id, or a **group id**.
   *
   * Named `node` because that is all it could be until boundaries became
   * connectable, and renaming it would break every document already written.
   * Read it as "endpoint". A collision between a node id and a group id resolves
   * in the node's favour — the compatible answer, and the safer one, since
   * silently promoting an edge to the coarser thing changes what the picture
   * claims.
   */
  node: string
  /** Pinned anchor. Absent means the router picks by facing. */
  port?: PortId
}

export interface DocEdge {
  id: string
  from: DocEdgeEnd
  to: DocEdgeEnd
  kind: EdgeKind
  label?: string
  route: 'auto' | 'manual'
  /** Only meaningful when `route` is 'manual'. */
  waypoints?: Array<[number, number]>
}

export interface DocGroup {
  id: string
  label?: string
  pos: [number, number]
  /** w, h, d in grid units. */
  size: [number, number, number]
  cat: Category
  /**
   * Ids the boundary encloses — nodes, or other groups.
   *
   * A group that only knows its own box goes stale the moment a member moves,
   * so membership is recorded and `fitGroups` derives the box from it. Group ids
   * are allowed here so a tier can contain a sub-tier; `fitGroups` resolves
   * inner boxes before the outer ones that depend on them.
   */
  members?: string[]
}

/**
 * A path through the system, as a thing the document asserts.
 *
 * The one kind of content the library had no way to express. A diagram shows
 * what exists; almost everything worth saying about a system is a *path* through
 * it — where a request goes, which hop is slow, what a failure takes down with
 * it — and until now that lived entirely in whatever the reader was told out
 * loud beside the picture.
 *
 * Document content rather than view state, unlike focus: "checkout goes web →
 * cdn → api → orders → pg" is a claim about the system, true whether or not
 * anyone is currently looking at it, and it should survive a save.
 */
export interface DocTrace {
  id: string
  label?: string
  /**
   * Node ids in order. Each consecutive pair needs a connector between them.
   *
   * Deliberately node ids and not edge ids. A path is a thing a person says out
   * loud — "web, then cdn, then api" — and nobody names the edges. It also keeps
   * a trace stable across rerouting, since edges are rebuilt but ids are not.
   */
  path: string[]
  /**
   * Milliseconds per hop, so `path.length - 1` of them.
   *
   * Optional, and the difference between decoration and information. Without it
   * the packet moves at constant speed and shows only the route; with it the
   * slow hop is visibly slow, which is usually the entire reason the trace is
   * being shown.
   */
  timings?: number[]
}

export interface DocView {
  preset: CameraPreset
  az: number
  el: number
  dist: number
  target: [number, number, number]
}

export interface Doc {
  version: 1
  units: { grid: number; fillet: number }
  nodes: DocNode[]
  edges: DocEdge[]
  groups: DocGroup[]
  traces: DocTrace[]
  view: DocView
  theme: { hues: Partial<Record<Category, string>> }
}

/** The catalog's locked camera: 32° lens, azimuth 34°, elevation 24°. */
export const DEFAULT_VIEW: DocView = {
  preset: 'hero',
  az: 0.6,
  el: 0.42,
  dist: 20,
  target: [0, 0.5, 0],
}

export function emptyDoc(): Doc {
  return {
    version: 1,
    units: { grid: 0.25, fillet: 0.06 },
    nodes: [],
    edges: [],
    groups: [],
    traces: [],
    view: { ...DEFAULT_VIEW, target: [...DEFAULT_VIEW.target] },
    theme: { hues: {} },
  }
}

export function findNode(doc: Doc, id: string): DocNode | undefined {
  return doc.nodes.find((n) => n.id === id)
}

export function findEdge(doc: Doc, id: string): DocEdge | undefined {
  return doc.edges.find((e) => e.id === id)
}

export function findTrace(doc: Doc, id: string): DocTrace | undefined {
  return doc.traces.find((t) => t.id === id)
}

/** Edges touching any of `nodeIds` — the set a move invalidates. */
export function incidentEdges(doc: Doc, nodeIds: Set<string>): DocEdge[] {
  return doc.edges.filter((e) => nodeIds.has(e.from.node) || nodeIds.has(e.to.node))
}

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

let counter = 0

/**
 * Monotonic ids, seeded from the document so a loaded file cannot collide with
 * newly created objects. Deliberately not random: a diff between two saves
 * should show what changed, not a wall of new uuids.
 */
export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}${counter}`
}

export function seedIds(doc: Doc): void {
  let max = 0
  for (const list of [doc.nodes, doc.edges, doc.groups, doc.traces]) {
    for (const item of list as Array<{ id: string }>) {
      const m = /(\d+)$/.exec(item.id)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  counter = Math.max(counter, max)
}

/** Test seam. */
export function resetIds(): void {
  counter = 0
}
