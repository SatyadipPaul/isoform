/**
 * Reconciler — projects a Doc into the scene.
 *
 * Diffs the previous document against the next and patches only what changed.
 * This is the single place where Doc state becomes three.js objects; nothing in
 * the tools or editor layer may add, move or remove an Object3D itself.
 *
 * Edges are rebuilt rather than mutated, because a route's geometry depends on
 * both endpoints and on how many other edges share its anchors — but only edges
 * incident to a changed node are touched, so dragging one part does not rebuild
 * a whole diagram's worth of tubing.
 */

import * as THREE from 'three'
import type { Doc, DocEdge, DocGroup, DocNode } from '../doc/schema.js'
import { build, manifestFor, measure, portsOf } from '../parts/registry.js'
import { boundary } from '../parts/boundary.js'
import { instantiateMerged, mergeWorld, mergedFor } from './merge.js'
import { NodeBatcher } from './batch.js'
import {
  declutter,
  disposeNameplate,
  makeNameplate,
  orientNameplate,
  setNameplateDimmed,
  type Nameplate,
} from './labels.js'
import { setStubsVisible } from '../foundry/geometry.js'
import { releaseMaterial, type IsoMaterial } from '../foundry/materials.js'
import {
  appearanceKey,
  appearanceMaterials,
  collectBaselines,
  paint,
  type Appearance,
} from '../foundry/appearance.js'
import { Router, groupPortBox } from '../route/router.js'
import { boxPorts, portBoxOf, type PortBox } from '../parts/registry.js'
import { boxCorners } from './camera.js'
import { TracePlayer } from './trace.js'
import { buildEdge } from '../route/styles.js'
import type { PortId } from '../parts/types.js'

export interface NodeView {
  id: string
  /** Transform carrier. Holds whichever detail level is currently shown. */
  group: THREE.Group
  /** Articulated build: every mesh, animation live. */
  full: THREE.Group
  /** Merged build: a handful of draw calls, animation frozen. */
  merged: THREE.Group
  detail: 'full' | 'merged'
  /** Whether modelled connector stubs are currently shown. */
  stubsShown: boolean
  /** Invisible hit volume. Raycasting 30-mesh parts per pointer-move is waste. */
  proxy: THREE.Mesh
  anchors: THREE.Mesh[]
  update?: (t: number) => void
  label?: Nameplate
  /** Snapshot of the node as last rendered, for cheap change detection. */
  last: DocNode
  /** `appearanceKey` of what is currently painted on this node. */
  appearance: string
  /**
   * Private material clones this node owns.
   *
   * Almost every appearance clone is shared through the module cache, but
   * materials built `unique` — the ones an update callback mutates per frame —
   * must not be, so their clones belong to the node and die with it.
   */
  owned: IsoMaterial[]
}

interface GroupView {
  group: THREE.Group
  proxy: THREE.Mesh
  /** Connector anchors on the boundary walls, as a part has on its faces. */
  anchors: THREE.Mesh[]
  label?: Nameplate
  last: DocGroup
}

interface EdgeView {
  group: THREE.Group
  /**
   * Fat invisible tube along the route.
   *
   * A connector is 0.035u across — a few pixels at normal framing, and
   * essentially unclickable. Same reasoning as the node pick volumes: hit-test
   * against something generous rather than against what is drawn.
   */
  proxy: THREE.Mesh
  /** Identity of the geometry currently built, so unchanged routes are left alone. */
  fingerprint: string
  update?: (t: number) => void
  /** Whether both endpoints are outside the focus set. */
  dimmed?: boolean
  /**
   * The resolved route, in world space.
   *
   * Kept because anything that travels a connector — a trace packet, today —
   * has to follow the line that was actually drawn. Recomputing it would mean
   * re-running the router, and re-deriving it from the tube geometry would mean
   * reading back a buffer. The router already produced it; hold on to it.
   */
  points: THREE.Vector3[]
  /** Tag naming what travels this connector, if the edge carries a label. */
  label?: Nameplate
  /** The text currently on that tag, so a relabel is noticed without a reroute. */
  labelText?: string
}

/**
 * How much smaller a connector's tag is than a part's.
 *
 * A diagram has more connectors than parts, so at equal weight the verbs shout
 * over the nouns. Small enough to read as annotation, large enough to read.
 */
const EDGE_LABEL_SCALE = 0.78

/**
 * The point half way along a polyline, measured by length.
 *
 * Not the middle *vertex*: a route from an L or a Z has its corner vertices
 * bunched together, so the middle one by index can sit almost on top of an
 * endpoint. Half way by arc length lands where a reader would point.
 */
function midpointOf(points: THREE.Vector3[]): THREE.Vector3 {
  if (points.length === 0) return new THREE.Vector3()
  if (points.length === 1) return points[0].clone()

  let total = 0
  for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1])
  if (total < 1e-6) return points[0].clone()

  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const seg = points[i].distanceTo(points[i - 1])
    if (walked + seg >= total / 2) {
      const t = seg < 1e-9 ? 0 : (total / 2 - walked) / seg
      return points[i - 1].clone().lerp(points[i], t)
    }
    walked += seg
  }
  return points[points.length - 1].clone()
}

/** Cheap identity for a resolved route. Quantised so float noise is not a change. */
function fingerprint(kind: string, pts: THREE.Vector3[]): string {
  let s = kind
  for (const p of pts) {
    s += `|${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`
  }
  return s
}

/** Free geometry owned by a discarded connector. Materials are shared — leave them. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (g) g.dispose()
  })
}

const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false })

/** Boundary pick shell — see the note where it is built. */
const GROUP_PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false, side: THREE.BackSide })

/** Forgiveness around a part's pick volume, in grid units. */
const PICK_PAD = 0.2

/** Radius of a connector's pick volume. Wide enough to click, narrow enough
    not to steal clicks from the parts it runs between. */
const EDGE_PICK_R = 0.16

/** Below this many static connectors, merging costs more than it saves. */
const EDGE_MERGE_MIN = 24

/**
 * Connector count past which even animated connectors are merged.
 *
 * Deliberately far above `EDGE_MERGE_MIN`. Merging a `flow` conduit freezes the
 * packets travelling along it, and that animation is most of what distinguishes
 * a data flow from a plain call — worth keeping in any diagram someone is
 * actually reading. Past a hundred connectors a packet is a couple of pixels
 * among hundreds, and holding on to it costs more than every part in the scene:
 * measured, unmerged animated connectors were 1707 draw calls against 473.
 */
const EDGE_MERGE_ALL = 96

/** Shown when a connector is hovered or selected — a sleeve around the run. */
const EDGE_HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0x7d8aa0,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
})
const EDGE_SELECT_MAT = new THREE.MeshBasicMaterial({
  color: 0xd9ae6b,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
})

export interface ReconcilerOptions {
  /** Materials for the connector anchor markers. */
  anchorIdle: THREE.Material
  anchorGeometry?: THREE.BufferGeometry
}

export class Reconciler {
  readonly nodeLayer = new THREE.Group()
  /** Holds the InstancedMeshes. Separate so it can be hidden or counted alone. */
  readonly batchLayer = new THREE.Group()
  readonly edgeLayer = new THREE.Group()
  readonly anchorLayer = new THREE.Group()
  readonly labelLayer = new THREE.Group()
  readonly groupLayer = new THREE.Group()
  readonly edgePickLayer = new THREE.Group()
  readonly groupPickLayer = new THREE.Group()
  /** Trace packets and their markers. Last, so they read over the diagram. */
  readonly traceLayer = new THREE.Group()

  private nodes = new Map<string, NodeView>()
  private groups = new Map<string, GroupView>()
  private edges = new Map<string, EdgeView>()
  private edgeUpdaters: Array<(t: number) => void> = []
  private doc: Doc | null = null
  private anchorGeo: THREE.BufferGeometry
  private router = new Router()
  private batcher: NodeBatcher
  /** Concatenated static connectors, or null when they are drawn individually. */
  private edgeMerged: THREE.Group | null = null
  /** Which connectors the merged buffer currently contains. */
  private mergedIds = new Set<string>()
  /** Connectors re-tubed on the last sync. Diagnostics only. */
  lastRebuildCount = 0
  /**
   * Nodes currently carrying emphasis, or null when emphasis is off.
   *
   * Null and "every node" are the same picture but not the same state: with
   * emphasis off nothing is dimmed, so `setFocus([])` clears rather than dimming
   * the entire diagram, which no caller has ever wanted.
   */
  private focus: Set<string> | null = null
  /** Absolute time of the previous `tick`, for deriving elapsed seconds. */
  private lastTick: number | null = null
  /** Drives trace playback. Owned here because routes move and it has to follow. */
  readonly trace: TracePlayer

  /** Routes recomputed on the last sync, as opposed to reused. Diagnostics. */
  get lastRoutesRecomputed(): number {
    return this.router.lastRecomputed
  }

  constructor(
    scene: THREE.Scene,
    private opts: ReconcilerOptions,
  ) {
    this.anchorGeo = opts.anchorGeometry ?? new THREE.SphereGeometry(0.085, 16, 12)
    this.batcher = new NodeBatcher(this.batchLayer)
    this.trace = new TracePlayer(this)
    this.traceLayer.add(this.trace.group)
    /* Groups first so their translucent volumes sort behind the parts inside. */
    scene.add(
      this.groupLayer,
      this.batchLayer,
      this.nodeLayer,
      this.edgeLayer,
      this.edgePickLayer,
      this.groupPickLayer,
      this.labelLayer,
      this.anchorLayer,
      this.traceLayer,
    )
  }

  /** Invisible hit shells for group boundaries. */
  get groupProxies(): THREE.Mesh[] {
    return [...this.groups.values()].map((g) => g.proxy)
  }

  /** Invisible hit volumes for connectors. */
  get edgeProxies(): THREE.Mesh[] {
    return [...this.edges.values()].map((e) => e.proxy)
  }

  /**
   * Mark a connector hovered, selected, or neither.
   *
   * The pick volume doubles as the highlight: it already traces the route, so
   * making it visible draws a sleeve around the run rather than a box around
   * its bounds, which for a long orthogonal path would enclose half the diagram.
   */
  setEdgeHighlight(hovered: string | null, selected: string | null): void {
    for (const [id, e] of this.edges) {
      const mat =
        id === selected ? EDGE_SELECT_MAT : id === hovered ? EDGE_HOVER_MAT : PROXY_MAT
      if (e.proxy.material !== mat) e.proxy.material = mat
    }
  }

  /** Show or hide every nameplate. Off for a clean export or a dense overview. */
  setLabelsVisible(on: boolean): void {
    this.labelLayer.visible = on
  }

  /**
   * Rebuild every nameplate from scratch.
   *
   * Needed after a webfont loads: plates are sized by measuring canvas text, so
   * any built against the fallback face carry the wrong dimensions and their
   * cached textures have to go with them.
   */
  rebuildLabels(): void {
    for (const v of this.nodes.values()) this.applyLabel(v, v.last)
    for (const v of this.groups.values()) {
      if (v.label) disposeNameplate(v.label)
      v.label = undefined
      if (!v.last.label) continue
      const g = v.last
      v.label = makeNameplate(g.label!, undefined, g.cat)
      this.labelLayer.add(v.label.group, v.label.stem)
    }
  }

  get views(): ReadonlyMap<string, NodeView> {
    return this.nodes
  }

  get proxies(): THREE.Mesh[] {
    return [...this.nodes.values()].map((v) => v.proxy)
  }

  /** Connector anchors for an endpoint — a part or a boundary. */
  anchorsOf(id: string): THREE.Mesh[] {
    return this.nodes.get(id)?.anchors ?? this.groups.get(id)?.anchors ?? []
  }

  /** Ids that can terminate a connector: every part, and every boundary. */
  get endpointIds(): string[] {
    return [...this.nodes.keys(), ...this.groups.keys()]
  }

  /** The footprint an endpoint presents to the router, for snapping. */
  portBoxFor(id: string): { box: PortBox; origin: THREE.Vector3; yaw: number } | null {
    const n = this.nodes.get(id)
    if (n) {
      return {
        box: portBoxOf(n.last.type),
        origin: new THREE.Vector3(n.last.pos[0], n.last.y ?? 0, n.last.pos[1]),
        yaw: n.last.rot,
      }
    }
    const g = this.groups.get(id)
    if (!g) return null
    return {
      box: groupPortBox(g.last),
      origin: new THREE.Vector3(g.last.pos[0], 0, g.last.pos[1]),
      yaw: 0,
    }
  }

  /**
   * Interactive mode: routes may be reused even where lane ordering makes that
   * inexact, so a drag stays responsive. The editor turns it on for the duration
   * of a gesture and off when it commits, which triggers an exact pass.
   */
  get interactive(): boolean {
    return this._interactive
  }

  set interactive(on: boolean) {
    if (on === this._interactive) return
    this._interactive = on
    /* Ending a gesture returns every connector to the merge. Starting one keeps
       the set empty until a route actually changes, so a drag that moves nothing
       incident to a connector never disturbs it. */
    if (!on) this.liveEdges.clear()
  }

  private _interactive = false

  /**
   * Connectors held out of the merged buffer for the duration of a gesture.
   *
   * Un-merging everything while dragging was correct but cost 2659 draw calls
   * against 491 at rest — a 74ms frame — because the whole diagram's tubing went
   * back to one mesh apiece to accommodate the two or three routes that were
   * actually moving. Only the routes that change need to leave.
   */
  private liveEdges = new Set<string>()

  /** Bring the scene into line with `next`. */
  sync(next: Doc): void {
    this.lastRebuildCount = 0
    const prev = this.doc
    const seen = new Set<string>()
    /* Nodes whose placement changed — their edges need re-routing. */
    const moved = new Set<string>()

    for (const n of next.nodes) {
      seen.add(n.id)
      const view = this.nodes.get(n.id)
      if (!view) {
        this.addNode(n)
        moved.add(n.id)
        continue
      }
      /* A type change is a different part; rebuild rather than patch. */
      if (view.last.type !== n.type) {
        this.removeNode(n.id)
        this.addNode(n)
        moved.add(n.id)
        continue
      }
      const shifted = this.applyTransform(view, n)
      if (shifted) moved.add(n.id)
      const restyled = appearanceKey(this.appearanceOf(n)) !== view.appearance
      if (restyled) this.applyAppearance(view, n)
      if (view.last.label !== n.label || view.last.sublabel !== n.sublabel) {
        this.applyLabel(view, n)
      }
      view.last = n
      /* A move only rewrites this node's matrix; a change of appearance moves it
         to a different batch. Nodes that did neither are not touched — that is
         what keeps a drag in a large diagram from costing a hundred and fifty
         buffer writes. */
      if (restyled) this.syncBatch(view, n)
      else if (shifted && view.detail === 'merged') {
        view.group.updateMatrixWorld(true)
        this.batcher.move(n.id, view.group.matrixWorld)
      }
    }

    for (const id of [...this.nodes.keys()]) {
      if (!seen.has(id)) {
        this.removeNode(id)
        moved.add(id)
      }
    }

    const edgesChanged =
      !prev ||
      prev.edges !== next.edges ||
      moved.size > 0 ||
      prev.edges.length !== next.edges.length

    if (!prev || prev.groups !== next.groups) this.syncGroups(next)
    if (edgesChanged) this.rebuildEdges(next)

    this.doc = next
  }

  /**
   * Drive per-frame animation. Only nodes at full detail are ticked — a merged
   * node's moving parts are baked into its geometry and cannot respond anyway.
   */
  tick(t: number): void {
    for (const v of this.nodes.values()) if (v.detail === 'full') v.update?.(t)
    for (const u of this.edgeUpdaters) u(t)
    /* The trace player works in elapsed seconds, not absolute ones — playback
       has a duration, and a request that took 900ms should take about 900ms to
       watch however long the page has been open. The first tick has no previous
       time to subtract, and the clamp also swallows the jump after a tab has
       been backgrounded, which would otherwise teleport the packet. */
    if (this.lastTick !== null) this.trace.tick(Math.min(t - this.lastTick, 0.1))
    this.lastTick = t
  }

  /**
   * Emphasise a subset: everything outside it dims toward the backdrop.
   *
   * View state, deliberately not document state. The same document supports as
   * many arguments as there are subsets worth pointing at, and none of them is a
   * property of the system being drawn.
   *
   * Note this is emphasis, not detail. `updateDetail` also takes a set of ids
   * and means something else entirely — which parts get their articulated rig.
   * A node is routinely in one set and not the other.
   */
  setFocus(ids: Iterable<string> | null): void {
    const next = ids ? new Set(ids) : null
    this.focus = next && next.size ? next : null
    for (const v of this.nodes.values()) {
      if (appearanceKey(this.appearanceOf(v.last)) === v.appearance) continue
      this.applyAppearance(v, v.last)
      this.syncBatch(v, v.last)
    }
    this.applyFocusToEdgesAndLabels(this.doc)
    /* The merged connector buffer holds baked copies of materials that just
       changed, and `mergeEdges` skips a rebuild when membership and geometry are
       both unchanged — which is exactly this case. Drop it so the next pass has
       to concatenate again, this time splitting on the substituted materials. */
    if (this.edgeMerged) {
      this.dropEdgeMerge()
      this.mergeEdges(new Set())
    }
  }

  /** Which nodes carry emphasis, or null when emphasis is off. */
  get focused(): ReadonlySet<string> | null {
    return this.focus
  }

  /**
   * The route a connector currently follows, in world space.
   *
   * The line as drawn, not as requested: lane allocation and anchor fanning both
   * move it, so anything travelling along a connector has to ask rather than
   * recompute the straight path between two parts.
   */
  routeOf(edgeId: string): readonly THREE.Vector3[] | null {
    return this.edges.get(edgeId)?.points ?? null
  }

  /**
   * The connector joining two nodes, and whether it runs the way asked.
   *
   * `forward` is false when the edge is declared `b -> a` and the caller wants
   * to go `a → b`. Traces are written the way someone would say them out loud,
   * so a path routinely traverses an edge against its declared direction — a
   * cache read replies to the service that asked.
   *
   * Only routed connectors are considered. An edge in the document that has not
   * been resolved yet has no line to travel.
   */
  /**
   * Where a node stands and how far its silhouette reaches.
   *
   * The radius comes from the measured build rather than the declared footprint,
   * because a few parts overhang what they declare — and anything ringing a part
   * has to clear what is actually drawn, not what the manifest claims.
   */
  anchorOf(nodeId: string): { position: THREE.Vector3; radius: number } | null {
    const v = this.nodes.get(nodeId)
    if (!v) return null
    const n = v.last
    const box = measure(n.type)
    const reach = Math.max(
      Math.abs(box.max.x),
      Math.abs(box.min.x),
      Math.abs(box.max.z),
      Math.abs(box.min.z),
    )
    return {
      position: new THREE.Vector3(n.pos[0], n.y ?? 0, n.pos[1]),
      radius: reach * (n.scale ?? 1),
    }
  }

  edgeBetween(a: string, b: string): { id: string; forward: boolean } | null {
    for (const e of this.doc?.edges ?? []) {
      if (!this.edges.has(e.id)) continue
      if (e.from.node === a && e.to.node === b) return { id: e.id, forward: true }
      if (e.from.node === b && e.to.node === a) return { id: e.id, forward: false }
    }
    return null
  }

  /**
   * Choose a detail level per node.
   *
   * Merged is the default. A node returns to its articulated build when it is
   * selected or hovered — where the user is looking and where the moving parts
   * are worth seeing — or when the diagram is small enough that there is no
   * reason to economise.
   *
   * The honest cost at scale: a merged `cache` does not pulse, a merged `queue`
   * does not carry envelopes along its channel, and a merged `balancer`'s vane
   * holds still. They resume the moment you select or hover them.
   */
  updateDetail(opts: { detailed?: Iterable<string>; fullBelow?: number } = {}): void {
    const fullBelow = opts.fullBelow ?? 24
    const everythingFull = this.nodes.size <= fullBelow
    /* Named `detailed`, not `focus`. This set is about draw cost — which parts
       are worth their articulated rig — and `setFocus` is about emphasis. They
       are routinely different sets, and one name for both invites passing the
       wrong one, which fails silently in each direction. */
    const detailed = new Set(opts.detailed ?? [])

    for (const v of this.nodes.values()) {
      const want = everythingFull || detailed.has(v.id) ? 'full' : 'merged'
      if (want === v.detail) continue
      v.detail = want
      v.full.visible = want === 'full'
      v.merged.visible = want === 'merged'
      /* Joins or leaves the shared instance buffer. Both directions matter: a
         node left in the batch while its articulated rig is also drawn shows as
         z-fighting across every surface of the part. */
      this.syncBatch(v, v.last)
    }
  }

  /**
   * Draw calls the node layer currently costs, for diagnostics.
   *
   * Batched instances count once per batch, not once per node — which is the
   * whole point, and makes this number comparable to `renderer.info.render.calls`
   * rather than to a count of parts.
   */
  nodeDrawCalls(): number {
    let n = this.batcher.drawCalls
    for (const v of this.nodes.values()) {
      const shown = v.detail === 'full' ? v.full : v.merged
      shown.traverse((o) => {
        if (o.userData.isShadow) return
        if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine) n++
      })
    }
    return n
  }

  /** Diagnostics: how many instance batches are live. */
  get batchCount(): number {
    return this.batcher.batchCount
  }

  /* ---------------------------------------------------------------- */

  private addNode(n: DocNode): void {
    const part = build(n.type)
    part.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mm = m.material as THREE.Material | undefined
      const soft = mm && (mm.transparent || mm.depthWrite === false)
      m.castShadow = !soft
      m.receiveShadow = !soft
    })

    /* Two detail levels under one transform carrier, so switching between them
       is a visibility flip rather than a rebuild.

       At merged detail the opaque geometry is not here at all — it is one
       instance inside a shared `InstancedMesh`, drawn in world space by the
       batcher. What stays per-node is the transparent and line work the merge
       pass could not fold, which still has to move with the carrier. */
    const carrier = new THREE.Group()
    /* The pick proxy has carried a `nodeId` since selection was built; the
       carrier holding the actual geometry had nothing. Anything walking the
       scene — a test, a debugger, an exporter — otherwise has to infer which
       node a group belongs to from its position in `nodeLayer.children`. */
    carrier.userData.nodeId = n.id
    const merged = instantiateMerged(mergedFor(n.type), 'lines')
    carrier.add(part.group, merged)
    part.group.visible = false
    this.nodeLayer.add(carrier)

    /* The pick volume is the footprint padded outward, and tall enough to cover
       the measured silhouette rather than just the declared height — clicking
       the top of the gateway arch or the edge of a chassis should select it.
       Footprint (not measured extent) still sets X/Z, so a part's decorative
       pipework does not steal clicks from its neighbours. */
    const man = manifestFor(n.type)
    const top = Math.max(man.height, measure(n.type).max.y)
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(man.footprint.w + PICK_PAD, top + PICK_PAD, man.footprint.d + PICK_PAD),
      PROXY_MAT,
    )
    proxy.userData.nodeId = n.id
    proxy.userData.pickHeight = top
    this.nodeLayer.add(proxy)

    const anchors: THREE.Mesh[] = []
    for (const pid of ['n', 'e', 's', 'w'] as PortId[]) {
      const m = new THREE.Mesh(this.anchorGeo, this.opts.anchorIdle)
      m.visible = false
      m.userData = { nodeId: n.id, portId: pid }
      this.anchorLayer.add(m)
      anchors.push(m)
    }

    const view: NodeView = {
      id: n.id,
      group: carrier,
      full: part.group,
      merged,
      detail: 'merged',
      stubsShown: true,
      proxy,
      anchors,
      update: part.update,
      last: n,
      appearance: '',
      owned: [],
    }
    this.nodes.set(n.id, view)
    this.applyTransform(view, n)
    this.applyAppearance(view, n)
    this.applyLabel(view, n)
    this.syncBatch(view, n)
  }

  /**
   * Keep a node's instanced slot in step with its appearance and detail level.
   *
   * A node is in the batch exactly when it is drawn merged. Going to full detail
   * vacates its slot, because the articulated rig draws the same geometry and
   * leaving the instance in place would draw the part twice — visible as
   * z-fighting on every surface, not as a quiet overdraw cost.
   */
  private syncBatch(v: NodeView, n: DocNode): void {
    if (v.detail !== 'merged') {
      this.batcher.remove(v.id)
      return
    }
    v.group.updateMatrixWorld(true)
    this.batcher.set(n.id, n.type, this.appearanceOf(n), v.stubsShown, v.group.matrixWorld)
  }

  /** (Re)build a node's nameplate. Cheap: label textures are cached by text. */
  private applyLabel(v: NodeView, n: DocNode): void {
    if (v.label) {
      disposeNameplate(v.label)
      v.label = undefined
    }
    if (!n.label) return
    v.label = makeNameplate(n.label, n.sublabel, manifestFor(n.type).cat)
    /* A fresh plate arrives undimmed. Retyping a label neither moves the node
       nor changes its edges, so nothing else this sync would notice — and the
       renamed part would be the one bright label in a dimmed diagram. */
    if (this.focus !== null && !this.focus.has(n.id)) setNameplateDimmed(v.label, true)
    this.labelLayer.add(v.label.group, v.label.stem)
  }

  /** Apex of a placed part — where its label's leader starts. */
  private apexOf(n: DocNode): THREE.Vector3 {
    const man = manifestFor(n.type)
    const s = n.scale ?? 1
    const top = Math.max(man.height, measure(n.type).max.y) * s
    return new THREE.Vector3(n.pos[0], (n.y ?? 0) + top, n.pos[1])
  }

  private removeNode(id: string): void {
    const v = this.nodes.get(id)
    if (!v) return
    this.batcher.remove(id)
    v.group.removeFromParent()
    v.proxy.removeFromParent()
    v.proxy.geometry.dispose()
    for (const a of v.anchors) a.removeFromParent()
    if (v.label) disposeNameplate(v.label)
    for (const m of v.owned) releaseMaterial(m)
    this.nodes.delete(id)
  }

  /** Project group boundaries. Rebuilt on any change — there are few, and they
      are a box plus an outline. */
  private syncGroups(doc: Doc): void {
    const seen = new Set<string>()
    for (const g of doc.groups) {
      seen.add(g.id)
      const prev = this.groups.get(g.id)
      const unchanged =
        prev &&
        prev.last.pos[0] === g.pos[0] &&
        prev.last.pos[1] === g.pos[1] &&
        prev.last.size[0] === g.size[0] &&
        prev.last.size[1] === g.size[1] &&
        prev.last.size[2] === g.size[2] &&
        prev.last.cat === g.cat &&
        prev.last.label === g.label
      if (unchanged) continue
      if (prev) this.removeGroup(g.id)

      const built = boundary({ w: g.size[0], h: g.size[1], d: g.size[2], cat: g.cat })
      built.group.position.set(g.pos[0], 0, g.pos[1])
      this.groupLayer.add(built.group)

      /* Pick volume is a shell, not a solid: clicking inside a boundary should
         reach whatever is in there, and only the enclosure itself should select
         the enclosure. BackSide means the ray passes through the near face and
         registers on the far one, so the interior stays clickable. */
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(g.size[0], g.size[1], g.size[2]),
        GROUP_PROXY_MAT,
      )
      proxy.position.set(g.pos[0], g.size[1] / 2, g.pos[1])
      proxy.userData.groupId = g.id
      this.groupPickLayer.add(proxy)

      /* A boundary carries the same four anchors a part does, so a tier can be
         wired as one thing. Keyed on `nodeId` like a part's — the editor's
         anchor picking and `DocEdgeEnd.node` both read that field as "endpoint",
         and a group is one. */
      const anchors: THREE.Mesh[] = []
      for (const p of boxPorts(groupPortBox(g), new THREE.Vector3(g.pos[0], 0, g.pos[1]))) {
        const m = new THREE.Mesh(this.anchorGeo, this.opts.anchorIdle)
        m.visible = false
        m.position.copy(p.position)
        m.userData = { nodeId: g.id, portId: p.id, isGroup: true }
        this.anchorLayer.add(m)
        anchors.push(m)
      }

      const view: GroupView = { group: built.group, proxy, anchors, last: g }
      if (g.label) {
        view.label = makeNameplate(g.label, undefined, g.cat)
        this.labelLayer.add(view.label.group, view.label.stem)
      }
      this.groups.set(g.id, view)
    }
    for (const id of [...this.groups.keys()]) if (!seen.has(id)) this.removeGroup(id)
  }

  private removeGroup(id: string): void {
    const v = this.groups.get(id)
    if (!v) return
    v.group.removeFromParent()
    v.proxy.removeFromParent()
    v.proxy.geometry.dispose()
    for (const a of v.anchors) a.removeFromParent()
    if (v.label) disposeNameplate(v.label)
    this.groups.delete(id)
  }

  /**
   * Create, retext or drop a connector's tag to match the document.
   *
   * Kept out of the geometry path because the two change independently: a route
   * reflows whenever a node moves, and the words on it almost never do.
   */
  private syncEdgeLabel(view: EdgeView, edge: DocEdge): void {
    const want = edge.label?.trim() || undefined
    if (view.labelText === want && (want === undefined) === (view.label === undefined)) return

    if (view.label) {
      disposeNameplate(view.label)
      view.label = undefined
    }
    view.labelText = want
    if (!want) return

    /* The connector palette, not the endpoints': a tag on a line belongs to the
       line. Only the plate is added — `orientLabels` lays the stem, and it is
       added with it so a tag that declutter slides aside keeps its leader. */
    view.label = makeNameplate(want, undefined, 'link', EDGE_LABEL_SCALE)
    this.labelLayer.add(view.label.group, view.label.stem)
  }

  /**
   * Point every nameplate at the camera.
   *
   * Called from the render loop rather than on document change, because it
   * depends on the view rather than the document — a plate has to stay readable
   * while the user orbits, not only when something is edited.
   */
  orientLabels(camera: THREE.Camera, declutterOverlaps = true): void {
    if (!this.labelLayer.visible) return
    const plates: Array<{ plate: Nameplate; top: THREE.Vector3 }> = []
    for (const v of this.nodes.values()) {
      if (!v.label) continue
      const top = this.apexOf(v.last)
      orientNameplate(v.label, top, camera)
      plates.push({ plate: v.label, top })
    }
    for (const v of this.groups.values()) {
      if (!v.label) continue
      const g = v.last
      /* A boundary's tag rides at the height of its own volume. */
      const top = new THREE.Vector3(g.pos[0], g.size[1], g.pos[1])
      orientNameplate(v.label, top, camera)
      plates.push({ plate: v.label, top })
    }
    /* Connector tags go through the same pass as everything else. They are the
       tags most likely to land on something — a route runs *between* parts, so
       its midpoint is exactly where the parts' own tags are heading — and a
       separate pass would let the two collections resolve into each other. */
    for (const v of this.edges.values()) {
      if (!v.label) continue
      const at = midpointOf(v.points)
      orientNameplate(v.label, at, camera)
      plates.push({ plate: v.label, top: at })
    }
    /* Optional because decluttering resolves overlaps along the camera's right
       vector, and that vector turns as the camera orbits — so the arrangement it
       settles on changes every frame and the tags visibly slide. Correct for a
       still or a camera the user is driving; wrong for an animated export. */
    if (declutterOverlaps) declutter(plates, camera)
  }

  /** Returns true when the placement actually moved. */
  private applyTransform(v: NodeView, n: DocNode): boolean {
    const y = n.y ?? 0
    const s = n.scale ?? 1
    const same =
      v.group.position.x === n.pos[0] &&
      v.group.position.y === y &&
      v.group.position.z === n.pos[1] &&
      v.group.rotation.y === n.rot &&
      v.group.scale.x === s

    /* Every sync visits every node, but only a handful move. Recomputing four
       anchor transforms for the rest dominated the cost of a drag in a large
       diagram — a hundred and fifty nodes' worth of allocation to reproduce
       positions that were already correct. */
    if (same) return false

    v.group.position.set(n.pos[0], y, n.pos[1])
    v.group.rotation.y = n.rot
    v.group.scale.setScalar(s)

    const man = manifestFor(n.type)
    const top = (v.proxy.userData.pickHeight as number) ?? man.height
    /* Box is `top + PICK_PAD` tall, so centring at top/2 spreads the padding
       evenly above the silhouette and just below the ground plane. */
    v.proxy.position.set(n.pos[0], y + (top * s) / 2, n.pos[1])
    v.proxy.rotation.y = n.rot
    v.proxy.scale.setScalar(s)

    const origin = new THREE.Vector3(n.pos[0], y, n.pos[1])
    portsOf(n.type, origin, n.rot).forEach((p, i) => v.anchors[i].position.copy(p.position))

    return true
  }

  /** What this node should currently look like: its own styling, plus emphasis. */
  private appearanceOf(n: DocNode): Appearance {
    return { tint: n.tint, state: n.state, dim: this.focus !== null && !this.focus.has(n.id) }
  }

  /**
   * Repaint a node's articulated build to match its appearance.
   *
   * Always starts from the baseline, never from what is currently assigned, so
   * appearances replace each other rather than stacking — dimming a tinted node
   * and then clearing the dim leaves the tint, and clearing both leaves the part
   * as the foundry built it.
   *
   * Only the articulated build needs this. A merged node's colours come from the
   * batch it sits in, which `syncBatch` selects.
   */
  private applyAppearance(v: NodeView, n: DocNode, force = false): void {
    const app = this.appearanceOf(n)
    const key = appearanceKey(app)
    if (key === v.appearance && !force) return

    for (const m of v.owned) releaseMaterial(m)
    v.owned = []
    v.appearance = key

    if (!key) {
      paint(v.group, null)
      return
    }

    const sub = appearanceMaterials(collectBaselines(v.group), manifestFor(n.type).cat, app)
    paint(v.group, sub)
    for (const c of sub.values()) if (c.userData.unique) v.owned.push(c)
  }

  /**
   * Dim the connectors and labels that belong to nothing in focus.
   *
   * Without this, focus stops at the node boundary and the result is worse than
   * no focus at all: the brightest thing left in the frame is a connector
   * running between two parts the reader was just told to ignore, and five
   * nameplates shout at the same volume as the two that matter.
   *
   * A connector is dimmed only when *both* its endpoints are — an edge with one
   * end in focus is part of what the focus is saying, because half of what a
   * part does is who it talks to.
   */
  private applyFocusToEdgesAndLabels(doc: Doc | null): void {
    const dim = (id: string): boolean => this.focus !== null && !this.focus.has(id)

    for (const e of doc?.edges ?? []) {
      const view = this.edges.get(e.id)
      if (!view) continue
      const want = dim(e.from.node) && dim(e.to.node)
      if (view.dimmed === want) continue
      view.dimmed = want
      /* The category argument is inert here: it selects which materials a *tint*
         may touch, and this appearance carries no tint. That matters because a
         connector is not all one category — `route/styles.ts` draws the runs from
         `link` and the flow packets from `data` — and dim has to reach both.
         Passing `link` and having it apply to everything is the intent, not an
         oversight to be tidied into a per-material lookup later.

         Baselines make this reversible, and `mergeWorld` buckets by material — so
         substituting *before* the merge is what lets dimmed and undimmed runs
         fall into separate buffers with no partitioning logic here. */
      paint(
        view.group,
        want ? appearanceMaterials(collectBaselines(view.group), 'link', { dim: true }) : null,
      )
      /* The tag recedes with the line it names. Left bright, a dimmed connector
         still shouts its verb — and text is the loudest thing in the frame, so
         the emphasis would read as pointing at the very edges being played
         down. */
      if (view.label) setNameplateDimmed(view.label, want)
    }

    for (const v of this.nodes.values()) {
      if (v.label) setNameplateDimmed(v.label, dim(v.id))
    }
  }

  /**
   * Rebuild only the connectors whose geometry actually changed.
   *
   * Resolving routes is arithmetic and runs for every edge each sync — it has
   * to, because anchor fanning and lane allocation are both global decisions.
   * Turning a route into tube geometry is the expensive half, so each resolved
   * path is fingerprinted and only genuine changes are re-tubed. Dragging one
   * part in a large diagram therefore re-tubes its own edges, not all of them.
   */
  private rebuildEdges(doc: Doc): void {
    /* A part loses its modelled connector stubs once it terminates a real edge,
       or the stubs dangle into empty space beside the actual route. Hidden
       rather than removed on the articulated build, and swapped for the
       stub-free merged form on the other — a node that loses its last edge has
       to get its pipework back. */
    const connected = new Set<string>()
    for (const e of doc.edges) {
      connected.add(e.from.node)
      connected.add(e.to.node)
    }
    for (const v of this.nodes.values()) {
      const wantStubs = !connected.has(v.id)
      if (v.stubsShown === wantStubs) continue
      v.stubsShown = wantStubs
      setStubsVisible(v.full, wantStubs)
      v.merged.removeFromParent()
      v.merged = instantiateMerged(mergedFor(v.last.type, wantStubs), 'lines')
      v.merged.visible = v.detail === 'merged'
      v.group.add(v.merged)
      /* The replacement arrives with shipped materials and no recorded baseline,
         so a styled node would lose its appearance on the pieces the merge pass
         could not fold. Forced, because the appearance itself did not change —
         only the geometry carrying it. */
      if (v.appearance) this.applyAppearance(v, v.last, true)
      /* Stub state is part of the batch key — with and without pipework are two
         different geometries — so gaining or losing an edge moves the node to a
         different batch. */
      this.syncBatch(v, v.last)
    }

    const seen = new Set<string>()
    /* Ids whose geometry was rebuilt this pass. The merged buffer holds baked
       copies, so it is stale the moment any connector inside it changes. */
    const changed = new Set<string>()
    let rebuilt = 0

    for (const r of this.router.resolve(doc, this.interactive)) {
      seen.add(r.edge.id)
      const fp = fingerprint(r.edge.kind, r.points)
      const prev = this.edges.get(r.edge.id)
      if (prev && prev.fingerprint === fp) {
        /* The route is unchanged, but the words on it may not be. Renaming an
           edge moves no geometry, so a label synced only on rebuild would keep
           showing the old text until something unrelated forced a reroute. */
        this.syncEdgeLabel(prev, r.edge)
        continue
      }

      if (prev) {
        prev.group.removeFromParent()
        disposeTree(prev.group)
        prev.proxy.removeFromParent()
        prev.proxy.geometry.dispose()
      }
      const built = buildEdge(r.edge.kind, r.points)
      built.group.userData.edgeId = r.edge.id
      built.group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.castShadow = true
      })
      this.edgeLayer.add(built.group)

      const curve = new THREE.CatmullRomCurve3(r.points)
      curve.arcLengthDivisions = 24
      const proxy = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(8, r.points.length * 4), EDGE_PICK_R, 6, false),
        PROXY_MAT,
      )
      proxy.userData.edgeId = r.edge.id
      proxy.renderOrder = 2
      this.edgePickLayer.add(proxy)

      const view: EdgeView = {
        group: built.group,
        proxy,
        fingerprint: fp,
        update: built.update,
        points: r.points.map((p) => p.clone()),
        /* Carried across a rebuild rather than recreated: the route changing is
           not the label changing, and rebuilding the plate would drop its dim
           state and re-upload a texture the cache already holds. */
        label: prev?.label,
        labelText: prev?.labelText,
      }
      this.edges.set(r.edge.id, view)
      this.syncEdgeLabel(view, r.edge)
      /* A route that moves during a gesture stays out of the merge until the
         gesture ends — re-concatenating the whole diagram for it would cost far
         more than drawing it on its own. */
      if (this._interactive) this.liveEdges.add(r.edge.id)
      rebuilt++
      changed.add(r.edge.id)
    }

    for (const [id, view] of [...this.edges]) {
      if (seen.has(id)) continue
      view.group.removeFromParent()
      disposeTree(view.group)
      view.proxy.removeFromParent()
      view.proxy.geometry.dispose()
      /* Unlike a rebuild, where the tag is carried across, a deleted edge takes
         its tag with it — otherwise the words stay in the scene naming a
         connector that no longer exists. */
      if (view.label) disposeNameplate(view.label)
      this.edges.delete(id)
    }

    this.edgeUpdaters = [...this.edges.values()]
      .map((e) => e.update)
      .filter((u): u is (t: number) => void => !!u)

    this.lastRebuildCount = rebuilt
    /* Before the merge, not after: a rebuilt connector comes back with shipped
       materials, and `mergeWorld` buckets by material — so dimming has to be in
       place for the concatenation to separate dimmed runs from the rest. */
    this.applyFocusToEdgesAndLabels(doc)
    this.mergeEdges(changed)

    /* A route that moved invalidates the curve a packet is travelling along.
       Dragging a part mid-playback is exactly when this happens, and without it
       the packet keeps following the line the connector used to take. */
    if (changed.size) this.trace.refresh()
  }

  /**
   * Fold static connectors into one mesh per material.
   *
   * Measured at 150 nodes with instancing already in place, connectors were the
   * single largest remaining cost: 560 draw calls and 22.6ms of a 48ms frame,
   * more than every part in the diagram put together. Each is only a tube and an
   * arrowhead, but there is one of each per connector and no two share geometry.
   *
   * They do share *materials*, though, and they are built in world space — so
   * concatenating them costs nothing but the concatenation itself.
   *
   * Rebuilt whole rather than incrementally, which is why it is gated:
   *
   * · **Not during a drag.** `interactive` means routes are being resolved every
   *   frame, and re-concatenating a hundred tubes per frame costs far more than
   *   the calls it saves. Connectors go back to one mesh each for the gesture.
   * · **Not below a threshold.** A dozen connectors are two dozen calls; merging
   *   them saves nothing worth a buffer rebuild.
   * · **Animated ones only past `EDGE_MERGE_ALL`.** A `flow` conduit carries
   *   travelling packets and merging bakes them still. That is the same bargain
   *   the node LOD makes — except a connector has no articulated form to return
   *   to, so it is only worth making when the diagram is too dense to read the
   *   animation anyway.
   */
  private mergeEdges(changed: Set<string>): void {
    const entries = [...this.edges.entries()]
    const takeAnimated = entries.length >= EDGE_MERGE_ALL
    const mergeable = entries.filter(
      ([id, e]) => (takeAnimated || !e.update) && !this.liveEdges.has(id),
    )

    if (mergeable.length < EDGE_MERGE_MIN) {
      this.dropEdgeMerge()
      for (const [, e] of entries) e.group.visible = true
      this.edgeUpdaters = entries
        .map(([, e]) => e.update)
        .filter((u): u is (t: number) => void => !!u)
      return
    }

    const ids = mergeable.map(([id]) => id)
    /* Rebuild only when the buffer would actually differ: a different set of
       connectors in it, or one of the ones in it having changed shape. During a
       drag neither happens — the moving routes are held out by `liveEdges` — so
       the concatenation survives the whole gesture. */
    const sameMembership =
      this.edgeMerged !== null &&
      ids.length === this.mergedIds.size &&
      ids.every((id) => this.mergedIds.has(id))
    const contentsStale = ids.some((id) => changed.has(id))
    if (sameMembership && !contentsStale) return

    this.dropEdgeMerge()
    const merged = mergeWorld(mergeable.map(([, e]) => e.group))
    const holder = new THREE.Group()
    for (const piece of merged.opaque) {
      const mesh = new THREE.Mesh(piece.geometry, piece.material)
      mesh.castShadow = true
      holder.add(mesh)
    }
    for (const l of merged.loose) holder.add(l.object)
    this.edgeLayer.add(holder)
    this.edgeMerged = holder
    this.mergedIds = new Set(ids)

    for (const [, e] of entries) e.group.visible = true
    for (const [, e] of mergeable) e.group.visible = false

    /* Merged connectors are frozen geometry — ticking their updaters would move
       objects nobody can see while the baked copy stayed put. */
    this.edgeUpdaters = entries
      .filter(([id]) => !this.mergedIds.has(id))
      .map(([, e]) => e.update)
      .filter((u): u is (t: number) => void => !!u)
  }

  /** Tear down the merged connector mesh, returning to one group per connector. */
  private dropEdgeMerge(): void {
    if (!this.edgeMerged) return
    this.edgeMerged.removeFromParent()
    disposeTree(this.edgeMerged)
    this.edgeMerged = null
    this.mergedIds.clear()
  }

  /**
   * World-space bounds of everything placed.
   *
   * Includes group boundaries: a group can extend well past the parts inside it,
   * and framing that ignored them would clip the very thing that shows where the
   * system's edges are.
   */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3()
    for (const v of this.groups.values()) {
      const g = v.last
      box.union(
        new THREE.Box3(
          new THREE.Vector3(g.pos[0] - g.size[0] / 2, 0, g.pos[1] - g.size[2] / 2),
          new THREE.Vector3(g.pos[0] + g.size[0] / 2, g.size[1], g.pos[1] + g.size[2] / 2),
        ),
      )
    }
    for (const v of this.nodes.values()) {
      const man = manifestFor(v.last.type)
      const s = v.last.scale ?? 1
      const c = new THREE.Vector3(v.last.pos[0], v.last.y ?? 0, v.last.pos[1])
      box.union(
        new THREE.Box3(
          new THREE.Vector3(c.x - (man.footprint.w * s) / 2, c.y, c.z - (man.footprint.d * s) / 2),
          new THREE.Vector3(
            c.x + (man.footprint.w * s) / 2,
            c.y + man.height * s,
            c.z + (man.footprint.d * s) / 2,
          ),
        ),
      )
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 1, 2))
    return box
  }

  /**
   * Corners of every part and boundary, rather than of the diagram as a whole.
   *
   * For framing. One box around the whole diagram is mostly air — a system laid
   * out as a chain occupies a thin ribbon and the corners of the box around it
   * hold nothing — so fitting that box reserves the picture for empty volume.
   * These points are what is actually drawn.
   */
  contentPoints(): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    for (const v of this.groups.values()) {
      const g = v.last
      out.push(
        ...boxCorners(
          new THREE.Box3(
            new THREE.Vector3(g.pos[0] - g.size[0] / 2, 0, g.pos[1] - g.size[2] / 2),
            new THREE.Vector3(g.pos[0] + g.size[0] / 2, g.size[1], g.pos[1] + g.size[2] / 2),
          ),
        ),
      )
    }
    for (const v of this.nodes.values()) {
      const n = v.last
      const man = manifestFor(n.type)
      const s = n.scale ?? 1
      const y = n.y ?? 0
      out.push(
        ...boxCorners(
          new THREE.Box3(
            new THREE.Vector3(n.pos[0] - (man.footprint.w * s) / 2, y, n.pos[1] - (man.footprint.d * s) / 2),
            new THREE.Vector3(
              n.pos[0] + (man.footprint.w * s) / 2,
              y + man.height * s,
              n.pos[1] + (man.footprint.d * s) / 2,
            ),
          ),
        ),
      )
    }
    return out
  }
}
