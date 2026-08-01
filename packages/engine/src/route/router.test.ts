import { describe, expect, it } from 'vitest'
import { Router, resolveEdges } from './router.js'
import { obstaclesOf, segmentHits, pointInside, INFLATE } from './obstacles.js'
import { LaneAllocator, LANE_STEP } from './lanes.js'
import { emptyDoc, type Doc, type DocEdge, type DocNode } from '../doc/schema.js'
import { manifestFor } from '../parts/registry.js'
import type { PartId } from '../parts/types.js'

function doc(nodes: DocNode[], edges: DocEdge[]): Doc {
  return { ...emptyDoc(), nodes, edges }
}

function node(id: string, type: PartId, x: number, z: number, rot = 0): DocNode {
  return { id, type, pos: [x, z], rot }
}

function edge(id: string, from: string, to: string): DocEdge {
  return { id, from: { node: from }, to: { node: to }, kind: 'sync', route: 'auto' }
}

/** Does a resolved route cut through any part it does not terminate on? */
function crossings(d: Doc): string[] {
  const obs = obstaclesOf(d)
  const bad: string[] = []
  for (const r of resolveEdges(d)) {
    const skip = new Set([r.edge.from.node, r.edge.to.node])
    for (const o of obs) {
      if (skip.has(o.id)) continue
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]
        const b = r.points[i]
        if (segmentHits(o, a.x, a.z, b.x, b.z)) {
          bad.push(`${r.edge.id} crosses ${o.id}`)
          break
        }
      }
    }
  }
  return bad
}

interface Seg {
  edge: string
  axis: 'x' | 'z'
  coord: number
  lo: number
  hi: number
}

/**
 * Lane conflicts among routes the allocator actually governs.
 *
 * A* is excluded: it searches the obstacle field without consulting the lane
 * allocator, so a searched route can legitimately land in an occupied corridor.
 * Asserting otherwise tests a guarantee the router does not make — an earlier
 * version of this test did, and passed only because the scenes it used happened
 * never to reach the search rung.
 */
function conflictsIn(rs: ReturnType<typeof resolveEdges>): string[] {
  const segs: Seg[] = []
  const EPS = 1e-3
  for (const r of rs) {
    if (r.rung === 'search' || r.rung === 'fallback') continue
    const p = r.points
    for (let i = 2; i <= p.length - 2; i++) {
      const a = p[i - 1]
      const b = p[i]
      if (Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) >= EPS) {
        segs.push({ edge: r.edge.id, axis: 'x', coord: a.x, lo: Math.min(a.z, b.z), hi: Math.max(a.z, b.z) })
      } else if (Math.abs(a.z - b.z) < EPS && Math.abs(a.x - b.x) >= EPS) {
        segs.push({ edge: r.edge.id, axis: 'z', coord: a.z, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
      }
    }
  }
  const bad: string[] = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]
      const b = segs[j]
      if (a.edge === b.edge || a.axis !== b.axis) continue
      if (Math.abs(a.coord - b.coord) >= LANE_STEP * 0.9) continue
      if (a.hi < b.lo + 1e-6 || b.hi < a.lo + 1e-6) continue
      bad.push(`${a.edge} and ${b.edge} share ${a.axis}=${a.coord.toFixed(2)}`)
    }
  }
  return bad
}

describe('obstacles', () => {
  it('inflates the footprint by the clearance', () => {
    const d = doc([node('a', 'service', 0, 0)], [])
    const f = manifestFor('service').footprint
    const o = obstaclesOf(d)[0]
    expect(o.hw).toBeCloseTo(f.w / 2 + INFLATE, 6)
    expect(o.hd).toBeCloseTo(f.d / 2 + INFLATE, 6)
  })

  it('respects rotation exactly rather than using the rotated AABB', () => {
    /* A long thin part turned 90°: a point off its unrotated +x end is now
       clear, and a point off its unrotated +z side is now inside. */
    const [o] = obstaclesOf(doc([node('a', 'queue', 0, 0, Math.PI / 2)], []), 0)
    const f = manifestFor('queue').footprint
    expect(pointInside(o, f.w / 2 - 0.1, 0)).toBe(false)
    expect(pointInside(o, 0, f.w / 2 - 0.1)).toBe(true)
  })

  it('detects a segment passing through a box, and misses beside it', () => {
    const [o] = obstaclesOf(doc([node('a', 'service', 0, 0)], []), 0)
    expect(segmentHits(o, -5, 0, 5, 0)).toBe(true)
    expect(segmentHits(o, -5, 9, 5, 9)).toBe(false)
  })

  it('treats a grazing touch along the boundary as clear', () => {
    const [o] = obstaclesOf(doc([node('a', 'service', 0, 0)], []), 0)
    const f = manifestFor('service').footprint
    expect(segmentHits(o, -5, f.d / 2, 5, f.d / 2)).toBe(false)
  })
})

describe('lane allocation', () => {
  it('gives overlapping runs distinct lanes', () => {
    const l = new LaneAllocator()
    const a = l.claim('x', 0, 0, 10)
    const b = l.claim('x', 0, 0, 10)
    const c = l.claim('x', 0, 0, 10)
    expect(a).toBe(0)
    expect(Math.abs(b - a)).toBeCloseTo(LANE_STEP, 6)
    expect(Math.abs(c - a)).toBeCloseTo(LANE_STEP, 6)
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('lets non-overlapping runs share a coordinate', () => {
    const l = new LaneAllocator()
    expect(l.claim('x', 4, 0, 5)).toBe(4)
    expect(l.claim('x', 4, 20, 25)).toBe(4)
  })

  it('keeps axes independent', () => {
    const l = new LaneAllocator()
    expect(l.claim('x', 2, 0, 9)).toBe(2)
    expect(l.claim('z', 2, 0, 9)).toBe(2)
  })
})

describe('routing ladder', () => {
  it('routes a clear pair without detouring', () => {
    const d = doc(
      [node('a', 'service', -4, 0), node('b', 'database', 4, 0)],
      [edge('e1', 'a', 'b')],
    )
    const [r] = resolveEdges(d)
    expect(r).toBeTruthy()
    expect(crossings(d)).toEqual([])
    /* Straight shot: no more than the lead-in/lead-out shaping. */
    expect(r.points.length).toBeLessThanOrEqual(4)
  })

  it('does not cut through a part standing between the endpoints', () => {
    const d = doc(
      [
        node('a', 'service', -6, 0),
        node('blocker', 'warehouse', 0, 0),
        node('b', 'database', 6, 0),
      ],
      [edge('e1', 'a', 'b')],
    )
    expect(crossings(d)).toEqual([])
  })

  it('threads a gap between two blockers', () => {
    const d = doc(
      [
        node('a', 'service', -7, 0),
        node('u', 'warehouse', 0, -2.6),
        node('l', 'warehouse', 0, 2.6),
        node('b', 'database', 7, 0),
      ],
      [edge('e1', 'a', 'b')],
    )
    expect(crossings(d)).toEqual([])
  })

  it('keeps every route clear in a dense grid', () => {
    const nodes: DocNode[] = []
    const edges: DocEdge[] = []
    let i = 0
    for (let gx = 0; gx < 4; gx++) {
      for (let gz = 0; gz < 3; gz++) {
        nodes.push(node(`n${i++}`, 'service', gx * 4.5, gz * 4))
      }
    }
    for (let k = 0; k + 1 < nodes.length; k++) edges.push(edge(`e${k}`, nodes[k].id, nodes[k + 1].id))
    const d = doc(nodes, edges)
    expect(resolveEdges(d)).toHaveLength(edges.length)
    expect(crossings(d)).toEqual([])
  })

  it('never lets two routes share a lane', () => {
    /* A hub fanning out, which is where overlapping corridors are likeliest. */
    const nodes: DocNode[] = [node('hub', 'gateway', 0, 0)]
    const edges: DocEdge[] = []
    const ring: Array<[number, number]> = [
      [7, -5],
      [7, 0],
      [7, 5],
      [-7, -5],
      [-7, 5],
      [0, 7],
    ]
    ring.forEach(([x, z], i) => {
      nodes.push(node(`t${i}`, 'service', x, z))
      edges.push(edge(`e${i}`, 'hub', `t${i}`))
    })
    const d = doc(nodes, edges)
    expect(crossings(d)).toEqual([])
    expect(conflictsIn(resolveEdges(d))).toEqual([])
  })

  it('keeps lanes separated across a dense grid too', () => {
    const nodes: DocNode[] = []
    const edges: DocEdge[] = []
    let i = 0
    for (let gx = 0; gx < 4; gx++) {
      for (let gz = 0; gz < 3; gz++) nodes.push(node(`n${i++}`, 'service', gx * 4.5, gz * 4))
    }
    for (let k = 0; k + 1 < nodes.length; k++) edges.push(edge(`e${k}`, nodes[k].id, nodes[k + 1].id))
    expect(conflictsIn(resolveEdges(doc(nodes, edges)))).toEqual([])
  })

  it('still produces a route when the target is fully walled in', () => {
    /* Boxed on all four sides: the ladder must degrade, not drop the edge. */
    const d = doc(
      [
        node('a', 'service', -9, 0),
        node('b', 'cache', 0, 0),
        node('w1', 'warehouse', -2.6, 0, Math.PI / 2),
        node('w2', 'warehouse', 2.6, 0, Math.PI / 2),
        node('w3', 'warehouse', 0, -2.6),
        node('w4', 'warehouse', 0, 2.6),
      ],
      [edge('e1', 'a', 'b')],
    )
    const rs = resolveEdges(d)
    expect(rs).toHaveLength(1)
    expect(rs[0].points.length).toBeGreaterThanOrEqual(2)
  })

  it('honours a pinned anchor', () => {
    const d = doc(
      [node('a', 'service', 0, 0), node('b', 'database', 6, 0)],
      [{ ...edge('e1', 'a', 'b'), from: { node: 'a', port: 'n' } }],
    )
    const [r] = resolveEdges(d)
    expect(r.fromPort).toBe('n')
  })

  it('drops edges whose endpoints are missing instead of throwing', () => {
    const d = doc([node('a', 'service', 0, 0)], [edge('e1', 'a', 'ghost')])
    expect(resolveEdges(d)).toEqual([])
  })
})

describe('incremental Router', () => {
  const scene = (): Doc => {
    const nodes: DocNode[] = []
    const edges: DocEdge[] = []
    let i = 0
    for (let gx = 0; gx < 4; gx++) {
      for (let gz = 0; gz < 3; gz++) nodes.push(node(`n${i++}`, 'service', gx * 4.5, gz * 4))
    }
    for (let k = 0; k + 1 < nodes.length; k++) edges.push(edge(`e${k}`, nodes[k].id, nodes[k + 1].id))
    /* A hub, so several edges compete for anchors and corridors. */
    edges.push(edge('h1', 'n0', 'n5'), edge('h2', 'n0', 'n7'), edge('h3', 'n0', 'n9'))
    return doc(nodes, edges)
  }

  const shape = (rs: ReturnType<typeof resolveEdges>): string =>
    rs
      .map(
        (r) =>
          `${r.edge.id}:${r.fromPort}->${r.toPort}:` +
          r.points.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(';'),
      )
      .join('|')

  /**
   * The property the cache rests on: reusing an unchanged edge's route must give
   * byte-identical output to recomputing everything. If it does not, a drag
   * silently produces different geometry than a reload of the same document.
   */
  it('matches the stateless resolver on first pass', () => {
    const d = scene()
    expect(shape(new Router().resolve(d))).toBe(shape(resolveEdges(d)))
  })

  it('matches the stateless resolver after a node moves', () => {
    const d = scene()
    const router = new Router()
    router.resolve(d)

    const moved: Doc = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === 'n4' ? { ...n, pos: [7, 6] as [number, number] } : n)),
    }
    expect(shape(router.resolve(moved))).toBe(shape(resolveEdges(moved)))
  })

  it('matches the stateless resolver over a sequence of moves', () => {
    const d = scene()
    const router = new Router()
    let cursor = d
    router.resolve(cursor)
    for (let step = 0; step < 6; step++) {
      cursor = {
        ...cursor,
        nodes: cursor.nodes.map((n) =>
          n.id === 'n6' ? { ...n, pos: [9 + step * 0.5, 4] as [number, number] } : n,
        ),
      }
      expect(shape(router.resolve(cursor))).toBe(shape(resolveEdges(cursor)))
    }
  })

  it('matches the stateless resolver when an edge is added and removed', () => {
    const d = scene()
    const router = new Router()
    router.resolve(d)

    const added: Doc = { ...d, edges: [...d.edges, edge('extra', 'n2', 'n11')] }
    expect(shape(router.resolve(added))).toBe(shape(resolveEdges(added)))

    const removed: Doc = { ...added, edges: added.edges.filter((e) => e.id !== 'e3') }
    expect(shape(router.resolve(removed))).toBe(shape(resolveEdges(removed)))
  })

  it('reuses routes that did not change', () => {
    const d = scene()
    const router = new Router()
    router.resolve(d)
    const total = router.lastRecomputed
    expect(total).toBe(d.edges.length)

    /* Re-resolving an untouched document must recompute nothing. */
    router.resolve(d)
    expect(router.lastRecomputed).toBe(0)

    /* Moving one leaf should touch only the edges attached to it. */
    const moved: Doc = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === 'n11' ? { ...n, pos: [14, 9] as [number, number] } : n)),
    }
    router.resolve(moved)
    expect(router.lastRecomputed).toBeGreaterThan(0)
    expect(router.lastRecomputed).toBeLessThan(total)
  })

  it('still separates lanes when only some edges are recomputed', () => {
    const d = scene()
    const router = new Router()
    router.resolve(d)
    const moved: Doc = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === 'n5' ? { ...n, pos: [4.5, 9] as [number, number] } : n)),
    }
    /* Reuse must not weaken the guarantee: the incremental result has to be as
       lane-clean as a fresh pass on the same document, no more and no less. */
    const incremental = router.resolve(moved)
    expect(conflictsIn(incremental)).toEqual(conflictsIn(resolveEdges(moved)))
  })
})
