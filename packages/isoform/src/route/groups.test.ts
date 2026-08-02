/**
 * Connectors that terminate on a group boundary.
 *
 * Wiring a tier as one thing is the point: without it every line into "Backend"
 * has to land on whichever member happens to sit nearest the edge of the box,
 * and the picture says something the architecture does not.
 *
 * Every failure here is geometric and silent. A line that docks on the group's
 * *centre* rather than its wall still routes; so does one that picks the far
 * face and wraps around; so does one that resolves against a member instead of
 * the group. None of them throw, and all of them look plausible in a thumbnail.
 */

import { describe, expect, it } from 'vitest'
import { resolveEdges } from './router.js'
import { fitGroups } from '../layout/autolayout.js'
import { emptyDoc, type Doc, type DocNode } from '../doc/schema.js'

/** A tier of two parts, with one node clearly west of it and one clearly east. */
function doc(): Doc {
  const d = emptyDoc()
  const at: Array<[string, [number, number]]> = [
    ['api', [-7, 0]],
    ['orders', [0, -1.6]],
    ['pg', [0, 1.6]],
    ['metrics', [7, 0]],
  ]
  d.nodes = at.map(([id, pos]): DocNode => ({ id, type: 'service', pos, rot: 0 }))
  d.groups = [
    { id: 'backend', label: 'Backend', pos: [0, 0], size: [4, 1.5, 4], cat: 'compute', members: ['orders', 'pg'] },
  ]
  d.groups = fitGroups(d)
  return d
}

const edge = (from: string, to: string) => ({
  id: `${from}-${to}`,
  from: { node: from },
  to: { node: to },
  kind: 'sync' as const,
  route: 'auto' as const,
})

describe('a group as an endpoint', () => {
  it('resolves an edge naming a group', () => {
    const d = doc()
    d.edges = [edge('api', 'backend')]
    expect(resolveEdges(d)).toHaveLength(1)
  })

  it('docks on the wall facing the other end, not on the centre', () => {
    const d = doc()
    d.edges = [edge('api', 'backend')]
    const [r] = resolveEdges(d)
    const g = d.groups[0]
    const westWall = g.pos[0] - g.size[0] / 2

    expect(r.toPort).toBe('w')
    const end = r.points[r.points.length - 1]
    /* Just outside the wall — the endpoint is pulled back by one arrowhead so
       the cone's tip lands on the surface rather than through it. */
    expect(end.x).toBeLessThan(westWall)
    expect(end.x).toBeGreaterThan(westWall - 0.6)
    /* And nowhere near the middle of the box, which is where a naive endpoint
       resolution would put it. */
    expect(Math.abs(end.x - g.pos[0])).toBeGreaterThan(1)
  })

  it('leaves from the wall facing the destination', () => {
    const d = doc()
    d.edges = [edge('backend', 'metrics')]
    const [r] = resolveEdges(d)
    expect(r.fromPort).toBe('e')
    expect(r.points[0].x).toBeCloseTo(d.groups[0].pos[0] + d.groups[0].size[0] / 2, 2)
  })

  it('meets the boundary below its roof', () => {
    /* A connector arriving halfway up a translucent box reads as floating
       inside the tier rather than docking against it. */
    const d = doc()
    d.edges = [edge('api', 'backend')]
    const [r] = resolveEdges(d)
    const height = d.groups[0].size[1]
    const y = r.points[r.points.length - 1].y
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(height)
  })

  it('joins two groups to each other', () => {
    const d = doc()
    d.groups = [
      ...d.groups,
      { id: 'edgeTier', label: 'Edge', pos: [0, 0], size: [2, 1.5, 2], cat: 'edge', members: ['api'] },
    ]
    d.groups = fitGroups(d)
    d.edges = [edge('edgeTier', 'backend')]
    const [r] = resolveEdges(d)
    expect(r).toBeDefined()
    expect(r.fromPort).toBe('e')
    expect(r.toPort).toBe('w')
  })

  it('routes a group edge and a member edge independently', () => {
    const d = doc()
    d.edges = [edge('api', 'backend'), edge('api', 'orders')]
    const rs = resolveEdges(d)
    expect(rs).toHaveLength(2)
    /* The two must not collapse onto the same line: one ends at the wall, the
       other carries on to the part inside. */
    const toGroup = rs.find((r) => r.edge.to.node === 'backend')!
    const toMember = rs.find((r) => r.edge.to.node === 'orders')!
    const endG = toGroup.points[toGroup.points.length - 1]
    const endM = toMember.points[toMember.points.length - 1]
    expect(endG.distanceTo(endM)).toBeGreaterThan(0.5)
  })

  it('follows the boundary when it is resized', () => {
    /* A group's box is derived from its members, so moving one moves the wall —
       and the route caches on a signature that has to notice. */
    const d = doc()
    d.edges = [edge('api', 'backend')]
    const before = resolveEdges(d)[0].points.at(-1)!.x

    const wider = { ...d, nodes: d.nodes.map((n) => (n.id === 'orders' ? { ...n, pos: [-3, -1.6] as [number, number] } : n)) }
    wider.groups = fitGroups(wider)
    const after = resolveEdges(wider)[0].points.at(-1)!.x

    expect(after).toBeLessThan(before)
  })
})
