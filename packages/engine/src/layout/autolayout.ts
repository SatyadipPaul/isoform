/**
 * Layered auto-layout — the "Tidy" button.
 *
 * Sugiyama, in the usual four steps: break cycles, rank by edge direction,
 * order within each rank to reduce crossings, then assign coordinates on the
 * grid honouring each part's footprint.
 *
 * Written out rather than pulled from dagre. The plan called for the library on
 * the grounds that this is not where the differentiation lies, and that reasoning
 * held right up until the integration was examined: dagre wants a node's size in
 * its own units, returns centres in a coordinate space with its own conventions,
 * knows nothing of our 0.5u grid, and would have to be taught about ranking
 * direction anyway. The adapter is most of the algorithm's length with none of
 * its clarity, and this version is a dependency we can debug.
 *
 * It also lets the layout speak the diagram's language directly: ranks advance
 * along +x because that is the direction the locked camera reads left-to-right.
 */

import { manifestFor } from '../parts/registry.js'
import type { Doc, DocGroup, DocNode } from '../doc/schema.js'

export interface LayoutOptions {
  /** Gap between ranks, in grid units. */
  rankGap?: number
  /** Gap between siblings within a rank. */
  nodeGap?: number
  /** Placement grid. */
  snap?: number
  /** Ordering passes. Four is where crossing reduction stops paying. */
  sweeps?: number
}

export interface LayoutResult {
  positions: Map<string, [number, number]>
  ranks: Map<string, number>
}

/**
 * Compute positions for every node in `doc`. Pure — returns placements and
 * leaves it to the caller to turn them into a command.
 */
export function layout(doc: Doc, opts: LayoutOptions = {}): LayoutResult {
  const rankGap = opts.rankGap ?? 2.2
  const nodeGap = opts.nodeGap ?? 1.1
  const snap = opts.snap ?? 0.5
  const sweeps = opts.sweeps ?? 4

  const ids = doc.nodes.map((n) => n.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))

  /* Adjacency, deduplicated and self-loops dropped — neither affects ranking. */
  const out = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]))
  const inn = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]))
  for (const e of doc.edges) {
    const a = e.from.node
    const b = e.to.node
    if (a === b || !index.has(a) || !index.has(b)) continue
    out.get(a)!.add(b)
    inn.get(b)!.add(a)
  }

  const acyclic = breakCycles(ids, out)
  const rank = rankNodes(ids, acyclic)
  const order = orderRanks(rank, acyclic, ids, sweeps)

  /* Coordinates. Ranks march along +x; members stack along z.
     Positions are built from snapped *steps* rather than by snapping each
     result. Rounding independently can pull two neighbours closer than the gap
     guarantees — a 1.22u part with a 1.1u gap wants centres 2.32u apart, and
     rounding both to the 0.5 grid can land them 2.0u apart, overlapping. */
  const positions = new Map<string, [number, number]>()
  const rankList = [...order.keys()].sort((a, b) => a - b)
  const stepUp = (need: number): number => Math.ceil(need / snap - 1e-9) * snap

  let x = 0
  for (const r of rankList) {
    const members = order.get(r)!
    const widths = members.map((id) => footprint(byId.get(id)!).w)
    const depths = members.map((id) => footprint(byId.get(id)!).d)
    const colWidth = Math.max(...widths, 0)

    /* Centre-to-centre offsets down the column, each a whole grid step. */
    const centres: number[] = []
    let cursor = 0
    members.forEach((_, i) => {
      if (i > 0) cursor += stepUp(depths[i - 1] / 2 + nodeGap + depths[i] / 2)
      centres.push(cursor)
    })
    /* Centre the column on the rank axis, keeping the shift on the grid. */
    const shift = stepUp((centres[centres.length - 1] ?? 0) / 2)
    const cx = round(x + colWidth / 2, snap)
    members.forEach((id, i) => positions.set(id, [cx, centres[i] - shift]))

    x = cx + colWidth / 2 + stepUp(rankGap)
  }

  return { positions, ranks: rank }
}

/**
 * Resize each group's box around the members it declares.
 *
 * A boundary that stores only its own extent goes stale as soon as a member
 * moves, so the box is derived from membership instead of being stored as truth.
 * Groups with no members are left as the user sized them.
 */
interface Extent {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  top: number
}

export function fitGroups(doc: Doc, pad = 0.55): DocGroup[] {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  const groupById = new Map(doc.groups.map((g) => [g.id, g]))
  const fitted = new Map<string, DocGroup>()
  /* Guards against a group listing itself, directly or through a chain. */
  const visiting = new Set<string>()

  const extentOf = (id: string): Extent | null => {
    const n = nodeById.get(id)
    if (n) {
      const f = footprint(n)
      return {
        minX: n.pos[0] - f.w / 2,
        maxX: n.pos[0] + f.w / 2,
        minZ: n.pos[1] - f.d / 2,
        maxZ: n.pos[1] + f.d / 2,
        top: manifestFor(n.type).height * (n.scale ?? 1),
      }
    }
    const g = groupById.get(id)
    if (!g) return null
    const inner = resolve(g)
    return {
      minX: inner.pos[0] - inner.size[0] / 2,
      maxX: inner.pos[0] + inner.size[0] / 2,
      minZ: inner.pos[1] - inner.size[2] / 2,
      maxZ: inner.pos[1] + inner.size[2] / 2,
      top: inner.size[1],
    }
  }

  /* Inner groups are sized before the outer ones that contain them. */
  const resolve = (g: DocGroup): DocGroup => {
    const done = fitted.get(g.id)
    if (done) return done
    if (visiting.has(g.id)) return g // cycle: leave as authored rather than loop
    visiting.add(g.id)

    const parts = (g.members ?? [])
      .map(extentOf)
      .filter((e): e is Extent => !!e)

    let out = g
    if (parts.length) {
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      let top = 0
      for (const e of parts) {
        minX = Math.min(minX, e.minX)
        maxX = Math.max(maxX, e.maxX)
        minZ = Math.min(minZ, e.minZ)
        maxZ = Math.max(maxZ, e.maxZ)
        top = Math.max(top, e.top)
      }
      out = {
        ...g,
        pos: [(minX + maxX) / 2, (minZ + maxZ) / 2] as [number, number],
        size: [maxX - minX + pad * 2, top + 0.5, maxZ - minZ + pad * 2] as [number, number, number],
      }
    }

    visiting.delete(g.id)
    fitted.set(g.id, out)
    return out
  }

  return doc.groups.map(resolve)
}

/** Ids a group encloses, following nesting. Used to guard against cycles. */
export function groupDescendants(doc: Doc, id: string, out = new Set<string>()): Set<string> {
  const g = doc.groups.find((x) => x.id === id)
  if (!g) return out
  for (const m of g.members ?? []) {
    if (out.has(m)) continue
    out.add(m)
    if (doc.groups.some((x) => x.id === m)) groupDescendants(doc, m, out)
  }
  return out
}

/**
 * Axis-aligned extent a part occupies, including its yaw.
 *
 * The rotated AABB, not the part's own frame. Routing deliberately works in each
 * part's frame instead, because there the extra width an AABB claims is wasted
 * clearance. Here it is the answer to the actual question: both callers place
 * things on world axes — a boundary box is axis-aligned by construction, and a
 * layout column is a world-space column. Using the unturned footprint let a part
 * rotated 45° overhang its own boundary by 41% of its width.
 */
function footprint(n: DocNode): { w: number; d: number } {
  const f = manifestFor(n.type).footprint
  const s = n.scale ?? 1
  const c = Math.abs(Math.cos(n.rot))
  const sn = Math.abs(Math.sin(n.rot))
  return { w: (f.w * c + f.d * sn) * s, d: (f.w * sn + f.d * c) * s }
}

function round(v: number, snap: number): number {
  return Math.round(v / snap) * snap
}

/**
 * Reverse the back-edges of any cycle so ranking terminates.
 *
 * Depth-first: an edge to a node still on the current stack closes a loop, so it
 * is dropped from the ranking graph. A cyclic architecture is entirely normal —
 * a service calling a cache that invalidates through the service — so this has
 * to be handled rather than treated as bad input.
 */
function breakCycles(ids: string[], out: Map<string, Set<string>>): Map<string, Set<string>> {
  const acyclic = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]))
  const state = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]))

  const visit = (id: string): void => {
    state.set(id, 1)
    for (const next of out.get(id) ?? []) {
      const s = state.get(next)
      if (s === 1) continue // back-edge: closes a cycle, so leave it out
      acyclic.get(id)!.add(next)
      if (s === 0) visit(next)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (state.get(id) === 0) visit(id)
  return acyclic
}

/** Longest-path ranking: a node sits one rank past its deepest predecessor. */
function rankNodes(ids: string[], out: Map<string, Set<string>>): Map<string, number> {
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const [, tos] of out) for (const to of tos) indeg.set(to, (indeg.get(to) ?? 0) + 1)

  const rank = new Map<string, number>(ids.map((id) => [id, 0]))
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0)
  /* Fully cyclic components leave nothing with in-degree zero; seed with the
     first node so they still get laid out instead of collapsing onto rank 0. */
  if (!queue.length && ids.length) queue.push(ids[0])

  const seen = new Set(queue)
  while (queue.length) {
    const id = queue.shift()!
    for (const to of out.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(id) ?? 0) + 1))
      const left = (indeg.get(to) ?? 1) - 1
      indeg.set(to, left)
      if (left <= 0 && !seen.has(to)) {
        seen.add(to)
        queue.push(to)
      }
    }
  }
  return rank
}

/**
 * Order each rank to reduce edge crossings, by the median heuristic.
 *
 * Each node moves to the median position of its neighbours in the adjacent
 * rank, sweeping forwards then backwards. This is the standard approach and it
 * gets most of the available improvement; exact crossing minimisation is
 * NP-hard and not worth it for diagrams of this size.
 */
function orderRanks(
  rank: Map<string, number>,
  out: Map<string, Set<string>>,
  ids: string[],
  sweeps: number,
): Map<number, string[]> {
  const byRank = new Map<number, string[]>()
  for (const id of ids) {
    const r = rank.get(id) ?? 0
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r)!.push(id)
  }

  const preds = new Map<string, string[]>(ids.map((id) => [id, []]))
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const [from, tos] of out) {
    for (const to of tos) {
      succs.get(from)!.push(to)
      preds.get(to)!.push(from)
    }
  }

  const ranks = [...byRank.keys()].sort((a, b) => a - b)

  const median = (id: string, neighbours: Map<string, string[]>, pos: Map<string, number>): number => {
    const xs = (neighbours.get(id) ?? [])
      .map((n) => pos.get(n))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b)
    if (!xs.length) return pos.get(id) ?? 0
    const mid = Math.floor(xs.length / 2)
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
  }

  const positionsOf = (): Map<string, number> => {
    const pos = new Map<string, number>()
    for (const r of ranks) byRank.get(r)!.forEach((id, i) => pos.set(id, i))
    return pos
  }

  for (let s = 0; s < sweeps; s++) {
    const forward = s % 2 === 0
    const seq = forward ? ranks : [...ranks].reverse()
    const pos = positionsOf()
    for (const r of seq) {
      const neighbours = forward ? preds : succs
      const list = byRank.get(r)!
      const keys = new Map(list.map((id) => [id, median(id, neighbours, pos)]))
      list.sort((a, b) => keys.get(a)! - keys.get(b)! || a.localeCompare(b))
    }
  }

  return byRank
}
