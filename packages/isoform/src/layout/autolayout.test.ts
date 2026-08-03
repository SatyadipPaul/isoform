import { describe, expect, it } from 'vitest'
import { fitGroups, layout } from './autolayout.js'
import { parseDsl, DSL_EXAMPLE } from '../io/dsl.js'
import { emptyDoc, type Doc, type DocEdge, type DocNode } from '../doc/schema.js'
import { manifestFor } from '../parts/registry.js'
import type { PartId } from '../parts/types.js'

function doc(nodes: DocNode[], edges: DocEdge[] = []): Doc {
  return { ...emptyDoc(), nodes, edges }
}
const n = (id: string, type: PartId = 'service'): DocNode => ({ id, type, pos: [0, 0], rot: 0 })
const e = (id: string, from: string, to: string): DocEdge => ({
  id,
  from: { node: from },
  to: { node: to },
  kind: 'sync',
  route: 'auto',
})

/**
 * Every part whose own footprint overlaps a group's box while not belonging to
 * it. This is the property the picture asserts: a boundary means "these parts,
 * and only these".
 */
function intruders(d: Doc): string[] {
  const placed = { ...d, groups: fitGroups(d) }
  const bad: string[] = []
  for (const g of placed.groups) {
    const members = new Set(g.members ?? [])
    const gx = [g.pos[0] - g.size[0] / 2, g.pos[0] + g.size[0] / 2]
    const gz = [g.pos[1] - g.size[2] / 2, g.pos[1] + g.size[2] / 2]
    for (const node of placed.nodes) {
      if (members.has(node.id)) continue
      const f = manifestFor(node.type).footprint
      const nx = [node.pos[0] - f.w / 2, node.pos[0] + f.w / 2]
      const nz = [node.pos[1] - f.d / 2, node.pos[1] + f.d / 2]
      /* Any overlap at all — a part half inside a tier reads as belonging to it. */
      if (nx[0] < gx[1] && gx[0] < nx[1] && nz[0] < gz[1] && gz[0] < nz[1]) {
        bad.push(`${node.id} inside ${g.id}`)
      }
    }
  }
  return bad
}

/** Apply a layout result to a document, the way every caller does. */
function place(d: Doc): Doc {
  const { positions } = layout(d)
  return {
    ...d,
    nodes: d.nodes.map((node) => ({ ...node, pos: positions.get(node.id) ?? node.pos })),
  }
}

describe('group-aware layout', () => {
  /**
   * The failure this exists for, reduced from the real one.
   *
   * Crossing reduction cares about edges and nothing else, so a tier's members
   * scatter down the depth axis and `fitGroups` draws a box around the scatter —
   * enclosing parts that belong to no tier. Found by rebuilding five published
   * architectures: Netflix's edge tier swallowed the client devices, and a URL
   * shortener's write path swallowed the URL store.
   */
  it('does not draw a boundary around parts that are not in it', () => {
    const d = doc(
      [n('user', 'client'), n('lb', 'balancer'), n('api'), n('kgs'), n('keys', 'database'), n('kv', 'database'), n('cache', 'cache')],
      [
        e('1', 'user', 'lb'),
        e('2', 'lb', 'api'),
        e('3', 'api', 'kgs'),
        e('4', 'kgs', 'keys'),
        e('5', 'api', 'cache'),
        e('6', 'api', 'kv'),
        e('7', 'cache', 'kv'),
      ],
    )
    d.groups = [
      { id: 'write', label: 'Write path', pos: [0, 0], size: [4, 1.5, 4], cat: 'compute', members: ['kgs', 'keys'] },
    ]
    expect(intruders(place(d))).toEqual([])
  })

  it('keeps two tiers from overlapping each other', () => {
    const d = doc(
      [n('a'), n('b'), n('c'), n('d'), n('e'), n('f')],
      [e('1', 'a', 'c'), e('2', 'b', 'd'), e('3', 'c', 'e'), e('4', 'd', 'f'), e('5', 'a', 'd')],
    )
    d.groups = [
      { id: 'g1', label: 'One', pos: [0, 0], size: [4, 1.5, 4], cat: 'compute', members: ['a', 'c', 'e'] },
      { id: 'g2', label: 'Two', pos: [0, 0], size: [4, 1.5, 4], cat: 'data', members: ['b', 'd', 'f'] },
    ]
    const placed = place(d)
    expect(intruders(placed)).toEqual([])

    /* And each tier occupies its own depth band rather than interleaving. */
    const zOf = (id: string) => placed.nodes.find((x) => x.id === id)!.pos[1]
    const g1 = ['a', 'c', 'e'].map(zOf)
    const g2 = ['b', 'd', 'f'].map(zOf)
    expect(Math.max(...g1)).toBeLessThan(Math.min(...g2))
  })

  it('leaves an ungrouped document exactly as it was', () => {
    /* Banding must not perturb the crossing-reduced order when there is nothing
       to band — that order is the whole value of the layout. */
    const d = doc(
      [n('a'), n('b'), n('c'), n('d')],
      [e('1', 'a', 'b'), e('2', 'a', 'c'), e('3', 'b', 'd'), e('4', 'c', 'd')],
    )
    const before = layout(d).positions
    const after = layout(d).positions
    for (const [id, p] of before) expect(after.get(id)).toEqual(p)
  })

  it('handles the shipped example, which has two tiers', () => {
    const { doc: parsed } = parseDsl(DSL_EXAMPLE)
    expect(intruders(place(parsed))).toEqual([])
  })
})

describe('layout', () => {
  it('ranks a chain left to right', () => {
    const d = doc([n('a'), n('b'), n('c')], [e('1', 'a', 'b'), e('2', 'b', 'c')])
    const { positions, ranks } = layout(d)
    expect(ranks.get('a')).toBe(0)
    expect(ranks.get('b')).toBe(1)
    expect(ranks.get('c')).toBe(2)
    expect(positions.get('a')![0]).toBeLessThan(positions.get('b')![0])
    expect(positions.get('b')![0]).toBeLessThan(positions.get('c')![0])
  })

  it('puts siblings in one rank and spreads them across z', () => {
    const d = doc(
      [n('hub'), n('x'), n('y'), n('z')],
      [e('1', 'hub', 'x'), e('2', 'hub', 'y'), e('3', 'hub', 'z')],
    )
    const { positions, ranks } = layout(d)
    expect([ranks.get('x'), ranks.get('y'), ranks.get('z')]).toEqual([1, 1, 1])
    const zs = ['x', 'y', 'z'].map((id) => positions.get(id)![1])
    expect(new Set(zs).size).toBe(3)
    /* Same rank means one column. */
    const xs = ['x', 'y', 'z'].map((id) => positions.get(id)![0])
    expect(new Set(xs).size).toBe(1)
  })

  it('never overlaps footprints, whatever the mix of part sizes', () => {
    /* Deliberately mixed depths, and enough of them to expose the rounding bug
       where snapping each centre independently pulled neighbours together. */
    const kinds: PartId[] = ['service', 'cache', 'queue', 'database', 'stream', 'blob', 'lambda']
    const d = doc(
      [n('root'), ...kinds.map((t, i) => n('m' + i, t))],
      kinds.map((_, i) => e(`x${i}`, 'root', 'm' + i)),
    )
    const { positions } = layout(d)
    const all = ['root', ...kinds.map((_, i) => 'm' + i)]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = d.nodes.find((x) => x.id === all[i])!
        const b = d.nodes.find((x) => x.id === all[j])!
        const pa = positions.get(a.id)!
        const pb = positions.get(b.id)!
        const fa = manifestFor(a.type).footprint
        const fb = manifestFor(b.type).footprint
        const overlapX = Math.abs(pa[0] - pb[0]) < (fa.w + fb.w) / 2 - 1e-6
        const overlapZ = Math.abs(pa[1] - pb[1]) < (fa.d + fb.d) / 2 - 1e-6
        expect(overlapX && overlapZ, `${a.id}(${a.type}) vs ${b.id}(${b.type})`).toBe(false)
      }
    }
  })

  it('keeps ranks clear of each other with wide parts', () => {
    const d = doc(
      [n('a', 'queue'), n('b', 'balancer'), n('c', 'warehouse')],
      [e('1', 'a', 'b'), e('2', 'b', 'c')],
    )
    const { positions } = layout(d)
    const gapBetween = (p: string, q: string): number => {
      const np = d.nodes.find((x) => x.id === p)!
      const nq = d.nodes.find((x) => x.id === q)!
      const half = (manifestFor(np.type).footprint.w + manifestFor(nq.type).footprint.w) / 2
      return Math.abs(positions.get(p)![0] - positions.get(q)![0]) - half
    }
    expect(gapBetween('a', 'b')).toBeGreaterThan(0)
    expect(gapBetween('b', 'c')).toBeGreaterThan(0)
  })

  it('snaps every position to the grid', () => {
    const d = doc([n('a'), n('b', 'cache'), n('c', 'queue')], [e('1', 'a', 'b'), e('2', 'b', 'c')])
    for (const [, p] of layout(d, { snap: 0.5 }).positions) {
      expect(Math.abs(p[0] / 0.5 - Math.round(p[0] / 0.5))).toBeLessThan(1e-9)
      expect(Math.abs(p[1] / 0.5 - Math.round(p[1] / 0.5))).toBeLessThan(1e-9)
    }
  })

  it('terminates on a cycle', () => {
    const d = doc(
      [n('a'), n('b'), n('c')],
      [e('1', 'a', 'b'), e('2', 'b', 'c'), e('3', 'c', 'a')],
    )
    const { positions } = layout(d)
    expect(positions.size).toBe(3)
  })

  it('terminates on a self-loop and places the node', () => {
    const d = doc([n('a')], [e('1', 'a', 'a')])
    expect(layout(d).positions.size).toBe(1)
  })

  it('lays out disconnected nodes', () => {
    const d = doc([n('a'), n('b'), n('c')], [])
    const { positions } = layout(d)
    expect(positions.size).toBe(3)
    /* No edges means one rank, so they must not stack. */
    expect(new Set([...positions.values()].map((p) => p[1])).size).toBe(3)
  })

  it('handles an empty document', () => {
    expect(layout(doc([])).positions.size).toBe(0)
  })

  it('reduces crossings versus declaration order', () => {
    /* Deliberately crossed: a→y, b→x. A good ordering swaps one rank. */
    const d = doc(
      [n('a'), n('b'), n('x'), n('y')],
      [e('1', 'a', 'y'), e('2', 'b', 'x')],
    )
    const { positions, ranks } = layout(d)
    expect(ranks.get('x')).toBe(1)
    expect(ranks.get('y')).toBe(1)
    /* a is above b, so its partner y should end up above x. */
    const az = positions.get('a')![1]
    const bz = positions.get('b')![1]
    const xz = positions.get('x')![1]
    const yz = positions.get('y')![1]
    expect(Math.sign(az - bz)).toBe(Math.sign(yz - xz))
  })
})

describe('fitGroups', () => {
  it('grows to cover a member that has been turned', () => {
    const make = (rot: number): Doc => ({
      ...doc([{ ...n('a'), pos: [0, 0], rot }]),
      groups: [
        { id: 'g1', label: 'T', pos: [0, 0], size: [1, 1, 1], cat: 'compute', members: ['a'] },
      ],
    })
    const f = manifestFor('service').footprint
    const [square] = fitGroups(make(0), 0)
    const [turned] = fitGroups(make(Math.PI / 4), 0)

    expect(square.size[0]).toBeCloseTo(f.w, 6)
    /* At 45° a rectangle sweeps to (w + d) / √2 on each axis. Sizing from the
       unturned footprint left the part hanging outside its own boundary. */
    const swept = (f.w + f.d) / Math.SQRT2
    expect(turned.size[0]).toBeCloseTo(swept, 6)
    expect(turned.size[2]).toBeCloseTo(swept, 6)
    expect(turned.size[0]).toBeGreaterThan(square.size[0])
  })

  it('is unchanged by a quarter turn, with the axes swapped', () => {
    const make = (rot: number): Doc => ({
      ...doc([{ ...n('a'), pos: [0, 0], rot }]),
      groups: [
        { id: 'g1', label: 'T', pos: [0, 0], size: [1, 1, 1], cat: 'compute', members: ['a'] },
      ],
    })
    const [a] = fitGroups(make(0), 0)
    const [b] = fitGroups(make(Math.PI / 2), 0)
    expect(b.size[0]).toBeCloseTo(a.size[2], 6)
    expect(b.size[2]).toBeCloseTo(a.size[0], 6)
  })

  it('wraps its members with padding', () => {
    const d: Doc = {
      ...doc([
        { ...n('a'), pos: [0, 0] },
        { ...n('b'), pos: [6, 4] },
      ]),
      groups: [
        { id: 'g1', label: 'Tier', pos: [0, 0], size: [1, 1, 1], cat: 'compute', members: ['a', 'b'] },
      ],
    }
    const [g] = fitGroups(d, 1)
    const f = manifestFor('service').footprint
    expect(g.pos[0]).toBeCloseTo(3, 6)
    expect(g.pos[1]).toBeCloseTo(2, 6)
    expect(g.size[0]).toBeCloseTo(6 + f.w + 2, 6)
    expect(g.size[2]).toBeCloseTo(4 + f.d + 2, 6)
  })

  it('leaves a memberless group as the user sized it', () => {
    const d: Doc = {
      ...doc([]),
      groups: [{ id: 'g1', pos: [2, 2], size: [5, 1.5, 5], cat: 'data' }],
    }
    expect(fitGroups(d)[0]).toEqual(d.groups[0])
  })

  it('ignores members that no longer exist', () => {
    const d: Doc = {
      ...doc([{ ...n('a'), pos: [0, 0] }]),
      groups: [{ id: 'g1', pos: [0, 0], size: [1, 1, 1], cat: 'compute', members: ['a', 'ghost'] }],
    }
    expect(() => fitGroups(d)).not.toThrow()
    expect(fitGroups(d)[0].size[0]).toBeGreaterThan(0)
  })
})

describe('parseDsl', () => {
  /* Asserted by property, not by transcription. The previous version listed the
     example's seven node ids literally, so editing the example — which is
     documentation, and should change as the catalog does — failed the test for
     no reason other than that it had changed. What must hold is that the thing
     we ship as a worked example is valid, connected and complete. */
  it('parses the shipped example without issues', () => {
    const { doc: d, issues } = parseDsl(DSL_EXAMPLE)
    expect(issues).toEqual([])
    expect(d.nodes.length).toBeGreaterThan(3)
    expect(d.edges.length).toBeGreaterThan(3)
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(d.nodes.length)
    for (const n of d.nodes) expect(n.label, n.id).toBeTruthy()
  })

  it('ships an example whose every edge and group member resolves', () => {
    const { doc: d } = parseDsl(DSL_EXAMPLE)
    const ids = new Set(d.nodes.map((n) => n.id))
    for (const e of d.edges) {
      expect(ids, `edge ${e.id} from`).toContain(e.from.node)
      expect(ids, `edge ${e.id} to`).toContain(e.to.node)
    }
    for (const g of d.groups) {
      for (const m of g.members ?? []) expect(ids, `group ${g.id}`).toContain(m)
    }
  })

  it('ships an example that exercises every connector kind', () => {
    const { doc: d } = parseDsl(DSL_EXAMPLE)
    const kinds = new Set(d.edges.map((e) => e.kind))
    /* The example doubles as the syntax reference in the editor's text sheet,
       so an arrow spelling it never uses is a spelling nobody discovers. */
    expect([...kinds].sort()).toContain('sync')
    expect([...kinds].sort()).toContain('async')
    expect([...kinds].sort()).toContain('secure')
  })

  it('maps each arrow to its connector kind', () => {
    const { doc: d, issues } = parseDsl(`
a service
b service
a -> b
a ~> b
a => b
a +> b
a <-> b
`)
    expect(issues).toEqual([])
    expect(d.edges.map((x) => x.kind)).toEqual(['sync', 'async', 'flow', 'secure', 'duplex'])
  })

  it('does not read <-> as ->', () => {
    const { doc: d } = parseDsl('a service\nb service\na <-> b\n')
    expect(d.edges[0].kind).toBe('duplex')
  })

  it('reports unknown types and nodes but keeps going', () => {
    const { doc: d, issues } = parseDsl(`
good service
bad notaparttype
good -> missing
`)
    expect(d.nodes.map((x) => x.id)).toEqual(['good'])
    expect(d.edges).toEqual([])
    expect(issues.map((i) => i.line)).toEqual([3, 4])
    expect(issues[0].message).toContain('notaparttype')
  })

  it('rejects duplicate ids', () => {
    const { doc: d, issues } = parseDsl('a service\na cache\n')
    expect(d.nodes).toHaveLength(1)
    expect(issues[0].message).toContain('duplicate')
  })

  it('strips comments but not inside a quoted label', () => {
    const { doc: d, issues } = parseDsl('a service "Cost # per unit"   # trailing\n')
    expect(issues).toEqual([])
    expect(d.nodes[0].label).toBe('Cost # per unit')
  })

  it('reads a tint, and still strips a comment after one', () => {
    const { doc: d } = parseDsl('a service "X" #ff8800   # the hot path\n')
    expect(d.nodes[0].tint).toBe('#ff8800')
    expect(d.nodes[0].label).toBe('X')
  })

  it('treats a non-hex hash as a comment', () => {
    const { doc: d, issues } = parseDsl('a service "X" #notacolour\n')
    expect(issues).toEqual([])
    expect(d.nodes[0].tint).toBeUndefined()
  })

  it('parses a group and records membership', () => {
    const { doc: d, issues } = parseDsl(`
a service
b service
group "Tier" { a, b }
`)
    expect(issues).toEqual([])
    expect(d.groups).toHaveLength(1)
    expect(d.groups[0].label).toBe('Tier')
    expect(d.groups[0].members).toEqual(['a', 'b'])
  })

  it('flags unknown group members without dropping the group', () => {
    const { doc: d, issues } = parseDsl('a service\ngroup "T" { a, nope }\n')
    expect(d.groups[0].members).toEqual(['a'])
    expect(issues[0].message).toContain('nope')
  })

  it('produces a document that lays out cleanly', () => {
    const { doc: d } = parseDsl(DSL_EXAMPLE)
    const { positions } = layout(d)
    expect(positions.size).toBe(d.nodes.length)
    /* Parsing leaves everything at the origin; layout must move it off. */
    expect(new Set([...positions.values()].map((p) => p.join())).size).toBeGreaterThan(1)
  })
})
