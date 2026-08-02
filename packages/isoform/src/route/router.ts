/**
 * Routing — where a connector goes.
 *
 * The ladder, in preference order: direct, single elbow (both orientations),
 * double elbow, then A* on the grid. Each rung is accepted only if it clears
 * every part's inflated footprint, so the cheap shapes are used whenever they
 * work and search is reserved for the cases that need it.
 *
 * Turn coordinates come from a LaneAllocator rather than being fixed, which is
 * what stops parallel runs collapsing into one thick line.
 */

import * as THREE from 'three'
import type { Doc, DocEdge, DocGroup } from '../doc/schema.js'
import { boxPort, chooseBoxPortPair, portBoxOf, type PortBox } from '../parts/registry.js'
import type { PartId, PortId, PortTransform } from '../parts/types.js'
import { ARROW_LEN } from './styles.js'
import { LaneAllocator, type Claim } from './lanes.js'
import { INFLATE, obstaclesOf, pointInside, polylineClear, type Obstacle } from './obstacles.js'

/** How far a run leaves an anchor before it is allowed to turn. */
const LEAD = 0.45

/** A* works on the design grid. */
const CELL = 0.25

interface P2 {
  x: number
  z: number
}

function dedupe2(pts: P2[]): P2[] {
  return pts.filter(
    (p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 1e-4,
  )
}

function len2(pts: P2[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return n
}

/** Lift a 2D route back to 3D, easing between the two anchor heights. */
function lift(pts: P2[], y0: number, y1: number): THREE.Vector3[] {
  const total = len2(pts) || 1
  let run = 0
  return pts.map((p, i) => {
    if (i > 0) run += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z)
    return new THREE.Vector3(p.x, y0 + (y1 - y0) * (run / total), p.z)
  })
}

export interface RouteContext {
  obstacles: Obstacle[]
  lanes: LaneAllocator
  /**
   * Whether the search rung may be used.
   *
   * A* is by far the most expensive rung, and in a crowded diagram it is reached
   * often: the lane allocator pushes a double elbow's mid-line sideways until it
   * runs into another part, and the ladder falls through. That is the right
   * answer for a route being committed and the wrong one for a frame of a drag,
   * where the alternative is an overlapping elbow nobody will see for more than
   * sixteen milliseconds.
   */
  allowSearch?: boolean
}

/**
 * Which rung of the ladder produced a route.
 *
 * Worth reporting rather than inferring from shape. `search` in particular is
 * the one rung that does not consult the lane allocator — A* finds a way through
 * the obstacle field without knowing which corridors are already spoken for — so
 * anything reasoning about lane separation has to know which routes were searched.
 * `fallback` means nothing cleared and an overlapping elbow was used rather than
 * dropping the edge.
 */
export type Rung = 'direct' | 'elbow' | 'double' | 'search' | 'fallback'

/**
 * Point list between two anchors, in the ground plane.
 *
 * `a`/`b` are the anchor positions; `na`/`nb` their outward normals. The target
 * end is pulled back by one arrowhead so the cone's tip lands on the part.
 */
export function path2(
  a: P2,
  na: P2,
  b: P2,
  nb: P2,
  ctx: RouteContext,
  skip: ReadonlySet<string>,
  arrowLen = ARROW_LEN,
): { points: P2[]; rung: Rung } {
  const a1 = { x: a.x + na.x * LEAD, z: a.z + na.z * LEAD }
  const bEnd = { x: b.x + nb.x * arrowLen, z: b.z + nb.z * arrowLen }
  const b1 = { x: bEnd.x + nb.x * LEAD, z: bEnd.z + nb.z * LEAD }

  const clear = (pts: P2[]): boolean => polylineClear(pts, ctx.obstacles, skip)

  /**
   * The axis-aligned interior runs of a candidate — every segment except the
   * lead-in and lead-out, which sit against their anchors and are separated by
   * fan-spreading rather than by lanes.
   *
   * Derived from the points rather than written out per orientation. Hardcoding
   * them produced degenerate zero-length spans for one of the two elbow
   * orientations, so its corridors were never actually reserved.
   */
  const interiorRuns = (pts: P2[]): Array<{ axis: 'x' | 'z'; coord: number; lo: number; hi: number }> => {
    const runs: Array<{ axis: 'x' | 'z'; coord: number; lo: number; hi: number }> = []
    for (let i = 2; i <= pts.length - 2; i++) {
      const p = pts[i - 1]
      const q = pts[i]
      const dx = Math.abs(p.x - q.x)
      const dz = Math.abs(p.z - q.z)
      if (dx < 1e-6 && dz >= 1e-6) runs.push({ axis: 'x', coord: p.x, lo: p.z, hi: q.z })
      else if (dz < 1e-6 && dx >= 1e-6) runs.push({ axis: 'z', coord: p.z, lo: p.x, hi: q.x })
    }
    return runs
  }

  const corridorsFree = (pts: P2[]): boolean =>
    interiorRuns(pts).every((r) => ctx.lanes.isFree(r.axis, r.coord, r.lo, r.hi))

  const takeCorridors = (pts: P2[]): void => {
    for (const r of interiorRuns(pts)) ctx.lanes.claimExact(r.axis, r.coord, r.lo, r.hi)
  }

  /* 1 — direct, but only when the two anchors genuinely line up.
     A collision-free diagonal is still the wrong shape: this language is
     Manhattan, and a long slanted run across a diagram reads as a mistake even
     when nothing is in its way. Anything not already collinear falls through to
     the elbow rungs, which turn at right angles. */
  const ALIGN_TOL = 0.1
  const aligned =
    Math.abs(a1.x - b1.x) < ALIGN_TOL || Math.abs(a1.z - b1.z) < ALIGN_TOL
  const direct = dedupe2([a, a1, b1, bEnd])
  /* A straight run occupies a corridor like any other, and has no freedom to
     move within it — so it must reserve it, and decline when it is taken. Two
     unrelated pairs that happen to align on nearly the same line would
     otherwise render as one thick run. */
  if (aligned && clear(direct) && corridorsFree(direct)) {
    takeCorridors(direct)
    return { points: direct, rung: 'direct' }
  }

  /* 2 — single elbow, both orientations, shorter first.
     An elbow's corner is fixed by its two anchors, so it cannot be nudged into a
     neighbouring lane: it either takes the corridor or declines it and falls
     through to the double elbow, which can be shifted. Without this check two
     elbows sharing a corridor render as one thick line. */
  const elbows = [
    dedupe2([a, a1, { x: b1.x, z: a1.z }, b1, bEnd]),
    dedupe2([a, a1, { x: a1.x, z: b1.z }, b1, bEnd]),
  ].sort((p, q) => len2(p) - len2(q))

  for (const l of elbows) {
    if (!clear(l) || !corridorsFree(l)) continue
    takeCorridors(l)
    return { points: l, rung: 'elbow' }
  }

  /* 3 — double elbow. The mid-line is the free parameter, so it comes from the
     lane allocator: two routes crossing the same corridor get their own. */
  const midXDesired = (a1.x + b1.x) / 2
  const midZDesired = (a1.z + b1.z) / 2
  const zs = [
    (): P2[] => {
      const mx = ctx.lanes.claim('x', midXDesired, a1.z, b1.z)
      return dedupe2([a, a1, { x: mx, z: a1.z }, { x: mx, z: b1.z }, b1, bEnd])
    },
    (): P2[] => {
      const mz = ctx.lanes.claim('z', midZDesired, a1.x, b1.x)
      return dedupe2([a, a1, { x: a1.x, z: mz }, { x: b1.x, z: mz }, b1, bEnd])
    },
  ]
  /* The allocator chooses the mid-line, but a double elbow has two further
     interior runs beside it — those have to be reserved too, or the rung that
     exists to resolve conflicts creates fresh ones on its flanks. */
  for (const make of zs) {
    const z = make()
    if (!clear(z)) continue
    takeCorridors(z)
    return { points: z, rung: 'double' }
  }

  /* 4 — search. */
  const found = ctx.allowSearch === false ? null : astar(a1, b1, ctx.obstacles, skip)
  if (found) {
    const searched = dedupe2([a, ...found, bEnd])
    takeCorridors(searched)
    return { points: searched, rung: 'search' }
  }

  /* Nothing clears; take the shortest elbow and let it overlap rather than
     dropping the edge, which would silently lose information. */
  return { points: elbows[0], rung: 'fallback' }
}

/** Binary min-heap over (node, priority). Enough for A*'s frontier. */
class MinHeap {
  private n: number[] = []
  private f: number[] = []

  get size(): number {
    return this.n.length
  }

  push(node: number, priority: number): void {
    this.n.push(node)
    this.f.push(priority)
    let i = this.n.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.f[p] <= this.f[i]) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const top = this.n[0]
    const lastN = this.n.pop()!
    const lastF = this.f.pop()!
    if (this.n.length) {
      this.n[0] = lastN
      this.f[0] = lastF
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.n.length && this.f[l] < this.f[m]) m = l
        if (r < this.n.length && this.f[r] < this.f[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const tn = this.n[a]
    this.n[a] = this.n[b]
    this.n[b] = tn
    const tf = this.f[a]
    this.f[a] = this.f[b]
    this.f[b] = tf
  }
}

/**
 * Orthogonal A* on a 0.25u lattice, with a turn penalty so paths prefer long
 * straight runs over staircases.
 *
 * Bounded two ways: the lattice covers only the endpoints' neighbourhood, and
 * expansion stops after a node cap. A diagram where routing is that constrained
 * wants a different layout, not a longer search.
 */
function astar(
  from: P2,
  to: P2,
  obstacles: Obstacle[],
  skip: ReadonlySet<string>,
  maxNodes = 20000,
): P2[] | null {
  const pad = 4
  const minX = Math.min(from.x, to.x) - pad
  const maxX = Math.max(from.x, to.x) + pad
  const minZ = Math.min(from.z, to.z) - pad
  const maxZ = Math.max(from.z, to.z) + pad

  const cols = Math.ceil((maxX - minX) / CELL) + 1
  const rows = Math.ceil((maxZ - minZ) / CELL) + 1
  if (cols * rows > 400000) return null

  const live = obstacles.filter((o) => !skip.has(o.id))
  const gx = (x: number): number => Math.round((x - minX) / CELL)
  const gz = (z: number): number => Math.round((z - minZ) / CELL)
  const wx = (i: number): number => minX + i * CELL
  const wz = (j: number): number => minZ + j * CELL

  /**
   * Mark blocked cells by walking each obstacle, not each cell.
   *
   * Testing every cell against every obstacle is O(cells × parts), which for a
   * long route in a hundred-and-fifty-node diagram is millions of checks per
   * edge — enough to wedge the renderer outright. Iterating obstacles and
   * touching only the cells under each one is proportional to the area actually
   * covered, which is a small fraction of the lattice.
   */
  const blocked = new Uint8Array(cols * rows)
  for (const o of live) {
    const i0 = Math.max(0, Math.floor((o.cx - o.r - minX) / CELL))
    const i1 = Math.min(cols - 1, Math.ceil((o.cx + o.r - minX) / CELL))
    const j0 = Math.max(0, Math.floor((o.cz - o.r - minZ) / CELL))
    const j1 = Math.min(rows - 1, Math.ceil((o.cz + o.r - minZ) / CELL))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (blocked[j * cols + i]) continue
        if (pointInside(o, wx(i), wz(j))) blocked[j * cols + i] = 1
      }
    }
  }

  const start = { i: gx(from.x), j: gz(from.z) }
  const goal = { i: gx(to.x), j: gz(to.z) }
  const idx = (i: number, j: number): number => j * cols + i
  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < cols && j < rows
  if (!inside(start.i, start.j) || !inside(goal.i, goal.j)) return null
  /* Endpoints sit against their own parts; treat them as passable regardless. */
  blocked[idx(start.i, start.j)] = 0
  blocked[idx(goal.i, goal.j)] = 0

  const N = cols * rows
  const g = new Float64Array(N).fill(Infinity)
  const cameFrom = new Int32Array(N).fill(-1)
  const dirOf = new Int8Array(N).fill(-1)
  /* A binary heap, not a scan. The frontier on a long route runs to thousands of
     nodes, and picking the minimum linearly makes the search quadratic in it. */
  const open = new MinHeap()
  const h = (i: number, j: number): number => (Math.abs(i - goal.i) + Math.abs(j - goal.j)) * CELL

  g[idx(start.i, start.j)] = 0
  open.push(idx(start.i, start.j), h(start.i, start.j))

  const DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  let expanded = 0

  while (open.size) {
    const cur = open.pop()
    if (cur === idx(goal.i, goal.j)) break
    if (++expanded > maxNodes) return null

    const ci = cur % cols
    const cj = (cur - ci) / cols
    for (let d = 0; d < 4; d++) {
      const ni = ci + DIRS[d][0]
      const nj = cj + DIRS[d][1]
      if (!inside(ni, nj)) continue
      const nId = idx(ni, nj)
      if (blocked[nId]) continue
      /* Turning is what makes a route hard to read, so price it. */
      const turn = dirOf[cur] >= 0 && dirOf[cur] !== d ? CELL * 2 : 0
      const ng = g[cur] + CELL + turn
      if (ng < g[nId] - 1e-9) {
        g[nId] = ng
        cameFrom[nId] = cur
        dirOf[nId] = d
        open.push(nId, ng + h(ni, nj))
      }
    }
  }

  const goalId = idx(goal.i, goal.j)
  if (!isFinite(g[goalId])) return null

  const cells: number[] = []
  for (let c = goalId; c !== -1; c = cameFrom[c]) cells.push(c)
  cells.reverse()

  /* Keep only the corners; the intermediate lattice points carry no shape. */
  const out: P2[] = []
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k] % cols
    const j = (cells[k] - i) / cols
    const isEnd = k === 0 || k === cells.length - 1
    if (!isEnd) {
      const pi = cells[k - 1] % cols
      const pj = (cells[k - 1] - pi) / cols
      const ni = cells[k + 1] % cols
      const nj = (cells[k + 1] - ni) / cols
      if (pi === ni || pj === nj) continue
    }
    out.push({ x: wx(i), z: wz(j) })
  }
  return out
}

/**
 * Obstacle-free route between two 3D anchors.
 *
 * For the drag preview, where the far end is still following the pointer and
 * has no settled anchor to route around. Committed edges go through
 * `resolveEdges`, which runs the full ladder.
 */
export function path(
  a: THREE.Vector3,
  na: THREE.Vector3,
  b: THREE.Vector3,
  nb: THREE.Vector3,
  arrowLen = ARROW_LEN,
): THREE.Vector3[] {
  const ctx: RouteContext = { obstacles: [], lanes: new LaneAllocator(), allowSearch: false }
  const flat = path2(
    { x: a.x, z: a.z },
    { x: na.x, z: na.z },
    { x: b.x, z: b.z },
    { x: nb.x, z: nb.z },
    ctx,
    new Set(),
    arrowLen,
  )
  return lift(flat.points, a.y, b.y)
}

export interface ResolvedEdge {
  edge: DocEdge
  from: PortTransform
  to: PortTransform
  /** Anchors actually chosen — pinned when the edge says so, else by facing. */
  fromPort: PortId
  toPort: PortId
  points: THREE.Vector3[]
  /** Which rung of the ladder produced this. `search` is not lane-aware. */
  rung: Rung
}

/**
 * An endpoint a connector can attach to.
 *
 * A box rather than a part id, so a *group boundary* is a first-class endpoint.
 * Wiring a tier as one thing is the whole point — otherwise every line into
 * "Backend" has to land on some arbitrary member inside it, and the picture
 * says something the architecture does not.
 */
interface Placed {
  box: PortBox
  origin: THREE.Vector3
  yaw: number
  /** Present for parts. Absent for a group, which has no manifest. */
  type?: PartId
}

/**
 * Resolve every edge to a concrete anchor pair and point list.
 *
 * Three passes. Anchor choice depends only on geometry; fan position along an
 * anchor's face depends on how many other edges chose the same one, so
 * occupancy has to be counted first; and lane allocation is order-dependent, so
 * routing runs last with a fresh allocator.
 */
/**
 * What an edge's route depends on.
 *
 * If none of this changed, neither did the route — so an unchanged edge can keep
 * its previous resolution and its previous lane claims instead of being
 * recomputed. Node placement enters through both endpoints; nothing else about a
 * node can move a route.
 */
function signatureOf(edge: DocEdge, a: Placed, b: Placed): string {
  return [
    edge.kind,
    edge.route,
    edge.from.port ?? '-',
    edge.to.port ?? '-',
    /* The box, not the type: a group has no type, and resizing one moves its
       anchors exactly as surely as replacing a part with a bigger one does. */
    a.box.w,
    a.box.d,
    a.box.y,
    a.origin.x,
    a.origin.y,
    a.origin.z,
    a.yaw,
    b.box.w,
    b.box.d,
    b.box.y,
    b.origin.x,
    b.origin.y,
    b.origin.z,
    b.yaw,
    edge.waypoints ? JSON.stringify(edge.waypoints) : '-',
  ].join('|')
}

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface CacheEntry {
  signature: string
  resolved: ResolvedEdge
  claims: Claim[]
  /** Fan slot the edge held, so re-use stays consistent with occupancy. */
  fromSlot: { slot: number; of: number }
  toSlot: { slot: number; of: number }
  /** Ground-plane extent of the route, for locality invalidation. */
  box: Rect
}

function routeBox(points: THREE.Vector3[]): Rect {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { minX, maxX, minZ, maxZ }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ
}

/** Ground extent a placed endpoint occupies, inflated by the routing clearance. */
function placedRect(p: Placed, pad: number): Rect {
  const hw = p.box.w / 2 + pad
  const hd = p.box.d / 2 + pad
  const origin = p.origin
  return {
    minX: origin.x - hw,
    maxX: origin.x + hw,
    minZ: origin.z - hd,
    maxZ: origin.z + hd,
  }
}

/**
 * Incremental route resolver.
 *
 * Resolution is O(edges), and it runs on every document change — including every
 * frame of a drag. At 200 edges that was ~40ms, which is a 25fps drag no matter
 * how cheap the geometry is. This keeps each edge's resolution against a
 * signature and recomputes only what actually moved.
 *
 * Two things make that safe rather than merely fast. Fan slots are recounted
 * from scratch every pass, because how many edges share an anchor is a global
 * fact; and the lane allocator is preloaded with the claims of every unchanged
 * edge, so a re-routed edge cannot occupy a corridor someone else still holds.
 */
export class Router {
  private cache = new Map<string, CacheEntry>()
  private prevPlaced = new Map<string, Placed>()
  /** Edges recomputed on the last pass. Diagnostics. */
  lastRecomputed = 0

  /**
   * @param interactive Reuse cached routes even where lane ordering makes that
   *   inexact. During a gesture the diagram is mid-thought and a corridor being
   *   momentarily shared matters far less than the drag stuttering; the exact
   *   pass runs when the gesture commits. Leave it off for anything whose output
   *   is kept — a render, an export, a saved document.
   */
  resolve(doc: Doc, interactive = false): ResolvedEdge[] {
    const placed = placementsOf(doc)
    const obstacles = obstaclesOf(doc)

    /**
     * Regions of the ground plane whose obstacle field changed.
     *
     * A route depends on *every* part, not only the two it joins — each one is
     * an obstacle. So moving a node can legitimately reshape a route that does
     * not touch it, and a signature over the endpoints alone is not enough to
     * decide reuse. Both the vacated and the newly occupied footprint count as
     * dirty; any cached route crossing either has to be recomputed.
     */
    const dirty: Rect[] = []
    const pad = INFLATE + 0.05
    for (const [id, now] of placed) {
      const was = this.prevPlaced.get(id)
      if (!was) {
        dirty.push(placedRect(now, pad))
        continue
      }
      /* Compared by box rather than by type: a group has no type, and resizing
         one moves its walls exactly as surely as swapping a part does. */
      const same =
        was.box.w === now.box.w &&
        was.box.d === now.box.d &&
        was.box.y === now.box.y &&
        was.yaw === now.yaw &&
        was.origin.equals(now.origin)
      if (same) continue
      dirty.push(placedRect(was, pad), placedRect(now, pad))
    }
    for (const [id, was] of this.prevPlaced) {
      if (!placed.has(id)) dirty.push(placedRect(was, pad))
    }

    type Choice = {
      edge: DocEdge
      a: Placed
      b: Placed
      fromPort: PortId
      toPort: PortId
      signature: string
      reusable: CacheEntry | undefined
    }
    const choices: Choice[] = []

    for (const edge of doc.edges) {
      const a = placed.get(edge.from.node)
      const b = placed.get(edge.to.node)
      if (!a || !b) continue
      const signature = signatureOf(edge, a, b)
      const cached = this.cache.get(edge.id)
      const stale = cached ? dirty.some((r) => overlaps(cached.box, r)) : false
      const reusable = cached && cached.signature === signature && !stale ? cached : undefined

      /* Anchor choice is geometry-only, so a reusable entry already has it. */
      let fromPort: PortId
      let toPort: PortId
      if (reusable) {
        fromPort = reusable.resolved.fromPort
        toPort = reusable.resolved.toPort
      } else {
        const pair = chooseBoxPortPair(
          { box: a.box, origin: a.origin, yaw: a.yaw, pin: edge.from.port },
          { box: b.box, origin: b.origin, yaw: b.yaw, pin: edge.to.port },
        )
        if (!pair) continue
        fromPort = pair.from.id
        toPort = pair.to.id
      }
      choices.push({ edge, a, b, fromPort, toPort, signature, reusable })
    }

    /* Occupancy is global, so it is always recounted. */
    const counts = new Map<string, number>()
    const key = (node: string, port: PortId): string => `${node}/${port}`
    for (const c of choices) {
      const kf = key(c.edge.from.node, c.fromPort)
      const kt = key(c.edge.to.node, c.toPort)
      counts.set(kf, (counts.get(kf) ?? 0) + 1)
      counts.set(kt, (counts.get(kt) ?? 0) + 1)
    }
    const used = new Map<string, number>()
    const slotFor = (node: string, port: PortId): { slot: number; of: number } => {
      const k = key(node, port)
      const slot = used.get(k) ?? 0
      used.set(k, slot + 1)
      return { slot, of: counts.get(k) ?? 1 }
    }

    const lanes = new LaneAllocator()
    const ctx: RouteContext = { obstacles, lanes, allowSearch: !interactive }
    const next = new Map<string, CacheEntry>()
    const out: ResolvedEdge[] = []
    let recomputed = 0

    /**
     * Any recompute invalidates later lane-holding reuse.
     *
     * A recomputed edge can take a corridor that a cached route assumed free,
     * and equally can *release* one that a cached route would now prefer — so
     * the trigger is the recompute itself, not whether it happened to claim
     * anything. Narrower rules were tried and diverge from a fresh pass, which
     * would mean a dragged diagram and a reloaded one disagreeing.
     *
     * Edges before the first change keep their routes, and lane-free edges
     * (direct runs) stay reusable throughout.
     */
    let laneOrderBroken = false

    /* Document order matters: the allocator must see claims in the same
       sequence a stateless pass would, or a reused route and a recomputed one
       disagree about who owns which corridor. */
    for (const c of choices) {
      const fromSlot = slotFor(c.edge.from.node, c.fromPort)
      const toSlot = slotFor(c.edge.to.node, c.toPort)

      /* A slot change moves the endpoint, so the route has to be redone even
         though the edge itself did not move. */
      const slotsMatch =
        c.reusable &&
        c.reusable.fromSlot.slot === fromSlot.slot &&
        c.reusable.fromSlot.of === fromSlot.of &&
        c.reusable.toSlot.slot === toSlot.slot &&
        c.reusable.toSlot.of === toSlot.of

      const holdsLanes = (c.reusable?.claims.length ?? 0) > 0
      const canReuse =
        c.reusable && slotsMatch && (interactive || !(holdsLanes && laneOrderBroken))

      if (canReuse && c.reusable) {
        lanes.preload(c.reusable.claims)
        const entry: CacheEntry = {
          ...c.reusable,
          resolved: { ...c.reusable.resolved, edge: c.edge },
        }
        next.set(c.edge.id, entry)
        out.push(entry.resolved)
        continue
      }

      lanes.beginEdge()
      const resolved = resolveOne(c.edge, c.a, c.b, c.fromPort, c.toPort, fromSlot, toSlot, ctx)
      if (!resolved) continue
      recomputed++
      const claims = lanes.edgeClaims()
      laneOrderBroken = true
      next.set(c.edge.id, {
        signature: c.signature,
        resolved,
        claims,
        fromSlot,
        toSlot,
        box: routeBox(resolved.points),
      })
      out.push(resolved)
    }

    this.cache = next
    this.prevPlaced = placed
    this.lastRecomputed = recomputed
    return out
  }

  invalidate(): void {
    this.cache.clear()
    this.prevPlaced.clear()
  }
}

/**
 * Every endpoint an edge may name, keyed by id.
 *
 * Nodes first, then groups. A collision is resolved in the node's favour, which
 * is both the compatible answer — every document written before groups became
 * connectable means the node — and the safer one, since a group is the coarser
 * thing and silently promoting an edge to it would change what the picture says.
 */
function placementsOf(doc: Doc): Map<string, Placed> {
  const placed = new Map<string, Placed>()
  for (const g of doc.groups) {
    placed.set(g.id, {
      box: groupPortBox(g),
      origin: new THREE.Vector3(g.pos[0], 0, g.pos[1]),
      /* Boundaries are axis-aligned; `fitGroups` derives them from member extents
         and there is no affordance for turning one. */
      yaw: 0,
    })
  }
  for (const n of doc.nodes) {
    placed.set(n.id, {
      type: n.type,
      box: portBoxOf(n.type),
      origin: new THREE.Vector3(n.pos[0], n.y ?? 0, n.pos[1]),
      yaw: n.rot,
    })
  }
  return placed
}

/**
 * Where connectors meet a boundary.
 *
 * Low on the wall rather than at mid-height: the box is translucent and a line
 * arriving halfway up it reads as floating inside the tier rather than docking
 * against it. Capped so a tall boundary does not lift its connectors above the
 * parts they come from.
 */
export function groupPortBox(g: DocGroup): PortBox {
  return { w: g.size[0], d: g.size[2], y: Math.min(0.34, g.size[1] * 0.42) }
}

function resolveOne(
  edge: DocEdge,
  a: Placed,
  b: Placed,
  fromPort: PortId,
  toPort: PortId,
  fromSlot: { slot: number; of: number },
  toSlot: { slot: number; of: number },
  ctx: RouteContext,
): ResolvedEdge | null {
  const from = boxPort(a.box, fromPort, a.origin, a.yaw, fromSlot)
  const to = boxPort(b.box, toPort, b.origin, b.yaw, toSlot)

  let pts: THREE.Vector3[]
  let rung: Rung = 'direct'
  if (edge.route === 'manual' && edge.waypoints?.length) {
    pts = [
      from.position,
      ...edge.waypoints.map(([x, z]) => new THREE.Vector3(x, from.position.y, z)),
      to.position.clone().addScaledVector(to.normal, ARROW_LEN),
    ]
    /* Hand-placed waypoints bypass the ladder and are not obstacle-checked. */
    rung = 'fallback'
  } else {
    const skip = new Set([edge.from.node, edge.to.node])
    const flat = path2(
      { x: from.position.x, z: from.position.z },
      { x: from.normal.x, z: from.normal.z },
      { x: to.position.x, z: to.position.z },
      { x: to.normal.x, z: to.normal.z },
      ctx,
      skip,
    )
    pts = lift(flat.points, from.position.y, to.position.y)
    rung = flat.rung
  }
  return { edge, from, to, fromPort, toPort, points: pts, rung }
}

/**
 * Resolve every edge from scratch.
 *
 * A `Router` with no accumulated state, which is exactly what "stateless" means
 * here. Sharing the implementation rather than keeping a second copy is
 * deliberate: two independent bodies of this logic drifted apart once already,
 * and the difference only showed up as a diagram that rendered differently after
 * a drag than after a reload.
 */
export function resolveEdges(doc: Doc): ResolvedEdge[] {
  return new Router().resolve(doc)
}

export { INFLATE, obstaclesOf } from './obstacles.js'
export { LaneAllocator, LANE_STEP } from './lanes.js'
export type { Obstacle } from './obstacles.js'
