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
  const groupOf = bandGroups(doc, order)

  /* Coordinates. Ranks march along +x; members stack along z.
     Positions are built from snapped *steps* rather than by snapping each
     result. Rounding independently can pull two neighbours closer than the gap
     guarantees — a 1.22u part with a 1.1u gap wants centres 2.32u apart, and
     rounding both to the 0.5 grid can land them 2.0u apart, overlapping. */
  const positions = new Map<string, [number, number]>()
  const rankList = [...order.keys()].sort((a, b) => a - b)
  const stepUp = (need: number): number => Math.ceil(need / snap - 1e-9) * snap

  /* Running mean depth of each group's already-placed members, so later ranks
     can line up with it. */
  const groupZ = new Map<string, { sum: number; n: number }>()

  let x = 0
  for (const r of rankList) {
    const members = order.get(r)!
    /* A lane placeholder takes depth so nothing else can occupy its group's
       band, and no width — it must not push the rank's column any wider. */
    const widths = members.map((id) => (isLanePlaceholder(id) ? 0 : footprint(byId.get(id)!).w))
    const depths = members.map((id) =>
      isLanePlaceholder(id) ? laneDepth(id, doc, byId) : footprint(byId.get(id)!).d,
    )
    const colWidth = Math.max(...widths, 0)

    /* Centre-to-centre offsets down the column, each a whole grid step.

       The gap widens where one lane ends and another begins. `fitGroups` draws a
       boundary `GROUP_PAD` beyond its members, so a neighbour parked one plain
       node-gap away is *inside* that padding — correctly ordered into its own
       lane and still rendered within the box. Ordering alone was never going to
       fix it; the lane needs clearance as well as position. */
    const bandAt = (i: number): string | undefined =>
      isLanePlaceholder(members[i]) ? members[i].slice(PHANTOM.length) : groupOf.get(members[i])

    const centres: number[] = []
    let cursor = 0
    members.forEach((_, i) => {
      if (i > 0) {
        const a = bandAt(i - 1)
        const b = bandAt(i)
        /* Only where a boundary is actually drawn — two ungrouped neighbours
           need no clearance from a box that does not exist. */
        const crossing = a !== b && (a !== undefined || b !== undefined)
        const gap = nodeGap + (crossing ? 2 * GROUP_PAD : 0)
        cursor += stepUp(depths[i - 1] / 2 + gap + depths[i] / 2)
      }
      centres.push(cursor)
    })

    /**
     * Where to slide the whole column.
     *
     * Centring each rank on its own axis is the obvious rule and it is what
     * broke grouping: a rank of two and a rank of five centre differently, so a
     * tier ordered into the same lane in both still lands at two different
     * depths — and its box then stretches across everything between them.
     *
     * When this rank contains members of a group already placed, the column is
     * slid to line them up with where that group already sits instead. The shift
     * stays a whole grid step, so relative spacing — which is what keeps parts
     * from overlapping — is untouched.
     */
    const anchors: number[] = []
    members.forEach((id, i) => {
      const gid = groupOf.get(id)
      const acc = gid ? groupZ.get(gid) : undefined
      if (acc) anchors.push(centres[i] - acc.sum / acc.n)
    })
    const shift = anchors.length
      ? round(anchors.reduce((a, b) => a + b, 0) / anchors.length, snap)
      : stepUp((centres[centres.length - 1] ?? 0) / 2)

    const cx = round(x + colWidth / 2, snap)
    members.forEach((id, i) => {
      const z = centres[i] - shift
      /* A placeholder is not a node; it reserved depth and that is all. It still
         reports its z, so the lane it is holding stays where the group is. */
      const gid = isLanePlaceholder(id) ? id.slice(PHANTOM.length) : groupOf.get(id)
      if (!isLanePlaceholder(id)) positions.set(id, [cx, z])
      if (!gid) return
      const acc = groupZ.get(gid) ?? { sum: 0, n: 0 }
      acc.sum += z
      acc.n += 1
      groupZ.set(gid, acc)
    })

    x = cx + colWidth / 2 + stepUp(rankGap)
  }

  return { positions, ranks: rank }
}

/**
 * Pull each group's members into one lane, consistently across ranks.
 *
 * Crossing reduction optimises for edges and knows nothing about grouping, so a
 * tier's members scatter across the depth axis — and `fitGroups` then draws a
 * box around whatever extent they ended up occupying. The result was boxes that
 * swallowed parts belonging to no tier at all: Netflix's "Edge tier" enclosing
 * the client devices, a URL shortener's "Write path" enclosing the URL store.
 * The picture asserted a containment the document never stated, which is worse
 * than drawing no boxes.
 *
 * Two things have to hold. Members must be **contiguous** within each rank, so
 * nothing is wedged between them; and each group must land in the **same lane**
 * in every rank it spans, or its box stretches across the depth of the diagram
 * and catches everything in between.
 *
 * A group's lane is its members' mean position, measured after crossing
 * reduction and normalised per rank so ranks of different sizes are comparable.
 * Taking it from the optimised order rather than imposing an arbitrary one keeps
 * the edges nearly as untangled as they were.
 *
 * Nested groups are ignored here: `fitGroups` resolves inner boxes before outer
 * ones, so an outer group follows its children's lanes without being banded
 * itself.
 */
function bandGroups(doc: Doc, order: Map<number, string[]>): Map<string, string> {
  /* One group per node. A part listed by two groups is banded with the first,
     which is arbitrary but stable — and the alternative, splitting it, is not
     available since a node has one position. */
  const groupOf = new Map<string, string>()
  for (const g of doc.groups) {
    for (const m of g.members ?? []) if (!groupOf.has(m)) groupOf.set(m, g.id)
  }
  if (!groupOf.size) return groupOf

  /* Where each node sits in its rank, on 0..1 so ranks of different sizes can
     be averaged against each other. */
  const place = new Map<string, number>()
  for (const list of order.values()) {
    list.forEach((id, i) => place.set(id, list.length > 1 ? i / (list.length - 1) : 0.5))
  }

  const lane = new Map<string, { sum: number; n: number }>()
  /* Which ranks each group reaches across, so the lane can be held open in the
     ranks between its members. */
  const span = new Map<string, { min: number; max: number }>()
  const rankOf = new Map<string, number>()
  for (const [r, list] of order) for (const id of list) rankOf.set(id, r)

  for (const [id, gid] of groupOf) {
    const p = place.get(id)
    if (p === undefined) continue
    const acc = lane.get(gid) ?? { sum: 0, n: 0 }
    acc.sum += p
    acc.n += 1
    lane.set(gid, acc)

    const r = rankOf.get(id)!
    const sp = span.get(gid) ?? { min: r, max: r }
    sp.min = Math.min(sp.min, r)
    sp.max = Math.max(sp.max, r)
    span.set(gid, sp)
  }

  for (const [r, list] of order) {
    /* Each group present becomes one item carrying its members in their existing
       relative order; every ungrouped node is an item of its own. Sorting items
       rather than nodes is what makes members contiguous. */
    const items = new Map<string, { key: number; ids: string[] }>()
    list.forEach((id, i) => {
      const gid = groupOf.get(id)
      const at = list.length > 1 ? i / (list.length - 1) : 0.5
      if (gid) {
        const acc = lane.get(gid)!
        const item = items.get(gid) ?? { key: acc.sum / acc.n, ids: [] }
        item.ids.push(id)
        items.set(gid, item)
      } else {
        items.set(` ${id}`, { key: at, ids: [id] })
      }
    })

    /* Reserve the lane in ranks the group spans but has no member in.
       A tier whose members sit at ranks 1 and 6 is a box six ranks long, and
       without a placeholder the ranks between it are free to put something else
       at that depth — which lands inside the box and reads as belonging to the
       tier. The placeholder occupies depth and nothing else. */
    for (const [gid, sp] of span) {
      if (r <= sp.min || r >= sp.max || items.has(gid)) continue
      const acc = lane.get(gid)!
      items.set(gid, { key: acc.sum / acc.n, ids: [PHANTOM + gid] })
    }

    order.set(
      r,
      [...items.entries()]
        .sort((a, b) => a[1].key - b[1].key || a[0].localeCompare(b[0]))
        .flatMap(([, item]) => item.ids),
    )
  }
  return groupOf
}

/**
 * Marks a placeholder standing in for an absent group in a rank it spans.
 *
 * A leading NUL cannot collide with any node id: ids come from the text format
 * or from `nextId`, and neither can produce one.
 */
const PHANTOM = ' lane:'

function isLanePlaceholder(id: string): boolean {
  return id.startsWith(PHANTOM)
}

/**
 * Depth a placeholder must hold: the widest member of the group it stands for.
 *
 * Anything narrower and a neighbouring part overhangs the lane and ends up
 * inside the box after all — the reservation has to be as deep as the thing it
 * is reserving for.
 */
function laneDepth(placeholder: string, doc: Doc, byId: Map<string, DocNode>): number {
  const gid = placeholder.slice(PHANTOM.length)
  const group = doc.groups.find((g) => g.id === gid)
  let d = 0
  for (const m of group?.members ?? []) {
    const node = byId.get(m)
    if (node) d = Math.max(d, footprint(node).d)
  }
  return d
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

/**
 * How far a boundary is drawn beyond the members it encloses.
 *
 * Shared with the layout: it is the clearance a neighbouring part needs from a
 * lane, and the two drifting apart is what puts a part inside a tier it does not
 * belong to.
 */
export const GROUP_PAD = 0.55

export function fitGroups(doc: Doc, pad = GROUP_PAD): DocGroup[] {
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
