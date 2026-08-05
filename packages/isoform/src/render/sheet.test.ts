/**
 * The diff is the part of this module with logic in it, so it is the part tested
 * here. Composing tiles needs a canvas and a GPU; deciding what changed does not.
 */

import { describe, expect, it } from 'vitest'
import { diffDocs } from './sheet.js'
import { parseDsl } from '../io/dsl.js'
import type { Doc } from '../doc/schema.js'

const BASE = `
web    client   "Browser"
api    gateway  "API"
orders service  "Orders"
pg     database "Postgres"

web -> api
api -> orders
orders -> pg
`

const parse = (s: string): Doc => parseDsl(s).doc

describe('diffDocs', () => {
  it('finds nothing between a document and itself', () => {
    const d = diffDocs(parse(BASE), parse(BASE))
    expect(d.summary).toBe('no changes')
    expect([d.added, d.removed, d.changed, d.moved, d.edgesAdded, d.edgesRemoved]).toEqual([
      [], [], [], [], [], [],
    ])
  })

  it('reports an added node and the edge that reaches it', () => {
    const after = parse(BASE + '\ncache cache "Redis"\napi -> cache\n')
    const d = diffDocs(parse(BASE), after)
    expect(d.added).toEqual(['cache'])
    expect(d.removed).toEqual([])
    expect(d.edgesAdded).toEqual(['api sync cache'])
    expect(d.summary).toBe('+1 node, +1 edge')
  })

  it('reports a removed node', () => {
    const before = parse(BASE + '\ncache cache "Redis"\n')
    const d = diffDocs(before, parse(BASE))
    expect(d.removed).toEqual(['cache'])
    expect(d.summary).toBe('−1 node')
  })

  it('separates a node that changed from one that only moved', () => {
    /* A layout run moves every node. If moving counted as changing, every diff
       taken after a re-layout would report the entire diagram as modified and
       the emphasis would point at everything, which points at nothing. */
    const before = parse(BASE)
    const after = parse(BASE)
    after.nodes[0].pos = [9, 9]
    after.nodes[1].label = 'Gateway'

    const d = diffDocs(before, after)
    expect(d.moved).toEqual(['web'])
    expect(d.changed).toEqual(['api'])
    expect(d.summary).toBe('1 changed, 1 moved')
  })

  it('notices a state change, which is a claim about the system', () => {
    const after = parse(BASE.replace('pg     database "Postgres"', 'pg database "Postgres" down'))
    const d = diffDocs(parse(BASE), after)
    expect(d.changed).toEqual(['pg'])
  })

  it('compares edges by their ends and kind, not by their ids', () => {
    /* Edge ids are assigned per parse, so two identical documents parsed twice
       have different ids throughout. Comparing those would report every edge as
       both added and removed. */
    const before = parse(BASE)
    const after = parse(BASE)
    expect(before.edges[0].id).toBe(after.edges[0].id)
    after.edges.forEach((e, i) => (e.id = `renamed-${i}`))

    const d = diffDocs(before, after)
    expect(d.edgesAdded).toEqual([])
    expect(d.edgesRemoved).toEqual([])
  })

  it('treats a re-kinded edge as one removed and one added', () => {
    const after = parse(BASE.replace('api -> orders', 'api ~> orders'))
    const d = diffDocs(parse(BASE), after)
    expect(d.edgesAdded).toEqual(['api async orders'])
    expect(d.edgesRemoved).toEqual(['api sync orders'])
  })
})
