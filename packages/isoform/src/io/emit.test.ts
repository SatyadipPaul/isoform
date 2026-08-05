/**
 * A writer is only correct if what it writes reads back as the same document.
 *
 * Checking the output against an expected string tests the formatter's taste,
 * not its correctness — the text can be beautiful and still describe a different
 * system. Every test here parses the emission and compares documents.
 */

import { describe, expect, it } from 'vitest'
import { parseDsl } from './dsl.js'
import { dslGaps, toDsl } from './emit.js'
import { emptyDoc, type Doc } from '../doc/schema.js'

/** The part of a document the text format is responsible for carrying. */
function semantics(doc: Doc) {
  return {
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      sublabel: n.sublabel,
      tint: n.tint,
      state: n.state,
    })),
    /* Ids are assigned by the parser and will differ; the wiring must not. */
    edges: doc.edges.map((e) => ({
      from: e.from.node,
      to: e.to.node,
      kind: e.kind,
      label: e.label,
    })),
    groups: doc.groups.map((g) => ({ id: g.id, label: g.label, members: g.members })),
    traces: doc.traces.map((t) => ({ label: t.label, path: t.path, timings: t.timings })),
  }
}

/** Parse, emit, parse again — and insist nothing changed in between. */
function roundTrip(src: string) {
  const first = parseDsl(src)
  expect(first.issues).toEqual([])
  const text = toDsl(first.doc)
  const second = parseDsl(text)
  expect(second.issues).toEqual([])
  return { first: first.doc, second: second.doc, text }
}

const RICH = `
web    client   "Browser"
api    gateway  "API"       "edge tier"
orders service  "Orders"    degraded
cache  cache    "Redis"     #b45309
pg     database "Postgres"  down

web -> api "https"
api ~> orders
orders => pg "write path"
api <-> cache
web +> api

group core "Service tier" { api, orders }
group data "Data tier" { cache, pg }

trace "Checkout" { web -> api -> orders -> pg }
trace "Cached read" { web -12-> api -3.5-> cache }
`

describe('toDsl', () => {
  it('round-trips a document that uses every part of the grammar', () => {
    const { first, second } = roundTrip(RICH)
    expect(semantics(second)).toEqual(semantics(first))
  })

  it('carries each edge kind through its own arrow', () => {
    const { second } = roundTrip(RICH)
    expect(second.edges.map((e) => e.kind)).toEqual(['sync', 'async', 'flow', 'duplex', 'secure'])
  })

  it('keeps per-hop timings on the hops they belong to', () => {
    const { second } = roundTrip(RICH)
    const cached = second.traces.find((t) => t.label === 'Cached read')
    expect(cached?.timings).toEqual([12, 3.5])
    /* An untimed trace must not acquire invented durations. */
    expect(second.traces.find((t) => t.label === 'Checkout')?.timings).toBeUndefined()
  })

  it('emits text that parses without issues', () => {
    const { text } = roundTrip(RICH)
    expect(parseDsl(text).issues).toEqual([])
  })

  it('survives a label containing a double quote', () => {
    /* The grammar reads a label as everything between two quotes and has no
       escape, so a raw quote would terminate the label early and turn the rest
       of the line into stray tokens. */
    const doc = emptyDoc()
    doc.nodes.push({ id: 'n1', type: 'service', label: 'the "fast" path', pos: [0, 0], rot: 0 })
    const { doc: back, issues } = parseDsl(toDsl(doc))
    expect(issues).toEqual([])
    expect(back.nodes).toHaveLength(1)
    expect(back.nodes[0].label).toBe('the ”fast” path')
  })

  it('writes a group that has no members as nothing at all', () => {
    /* `group x "X" { }` is not a thing the parser accepts, so emitting one would
       produce text that fails to read back. */
    const doc = emptyDoc()
    doc.nodes.push({ id: 'n1', type: 'service', pos: [0, 0], rot: 0 })
    doc.groups.push({ id: 'g1', label: 'Empty', pos: [0, 0], size: [4, 1.5, 4], cat: 'compute', members: [] })
    const { issues, doc: back } = parseDsl(toDsl(doc))
    expect(issues).toEqual([])
    expect(back.groups).toEqual([])
  })
})

describe('dslGaps', () => {
  it('is empty for a document the format can hold', () => {
    expect(dslGaps(parseDsl(RICH).doc)).toEqual([])
  })

  it('names every fact the format drops rather than losing it quietly', () => {
    const doc = parseDsl(RICH).doc
    doc.nodes[1].y = 1
    doc.nodes[2].scale = 1.5
    doc.edges[1].route = 'manual'
    doc.edges[1].waypoints = [
      [1, 1],
      [2, 2],
    ]
    doc.groups[0].cat = 'data'

    const gaps = dslGaps(doc)
    expect(gaps).toEqual([
      'node api: tier 1',
      'node orders: scale 1.5',
      `edge ${doc.edges[1].id}: manual route, 2 waypoint(s)`,
      'group core: category data',
    ])
  })

  it('writes those same facts into the text as comments', () => {
    const doc = parseDsl(RICH).doc
    doc.nodes[1].y = 2
    doc.nodes[2].scale = 1.5
    const text = toDsl(doc)
    expect(text).toContain('# tier 2')
    expect(text).toContain('# scale 1.5')
    /* And the comments must not change what the text means. */
    expect(parseDsl(text).issues).toEqual([])
  })
})

describe('the things the format learned to carry', () => {
  it('round-trips a node sublabel, which the nameplate has always drawn', () => {
    /* Renderable but unwritable was the worst combination: a document using a
       sublabel could be drawn and could not be exported as text, so an agent
       that reached for one left the text format for good. */
    const { doc, issues } = parseDsl('api gateway "API" "edge tier"')
    expect(issues).toEqual([])
    expect(doc.nodes[0]).toMatchObject({ label: 'API', sublabel: 'edge tier' })
    expect(parseDsl(toDsl(doc)).doc.nodes[0].sublabel).toBe('edge tier')
  })

  it('round-trips an edge label', () => {
    const { doc, issues } = parseDsl('a service "A"\nb service "B"\na -> b "https"')
    expect(issues).toEqual([])
    expect(doc.edges[0].label).toBe('https')
    expect(parseDsl(toDsl(doc)).doc.edges[0].label).toBe('https')
  })

  it('reads an edge label on every arrow spelling', () => {
    const src = ['->', '~>', '=>', '+>', '<->']
      .map((a, i) => `a${i} service "A"\nb${i} service "B"\na${i} ${a} b${i} "hop ${i}"`)
      .join('\n')
    const { doc, issues } = parseDsl(src)
    expect(issues).toEqual([])
    expect(doc.edges.map((e) => e.label)).toEqual(['hop 0', 'hop 1', 'hop 2', 'hop 3', 'hop 4'])
  })

  it('does not mistake a labelled edge for an endpoint with a space in it', () => {
    const { doc, issues } = parseDsl('a service "A"\nb service "B"\na -> b "dynamic port mapping"')
    expect(issues).toEqual([])
    expect(doc.edges).toHaveLength(1)
    expect(doc.edges[0].to.node).toBe('b')
    expect(doc.edges[0].label).toBe('dynamic port mapping')
  })

  it('leaves an unlabelled edge unlabelled', () => {
    const { doc } = parseDsl('a service "A"\nb service "B"\na -> b')
    expect(doc.edges[0].label).toBeUndefined()
    expect(toDsl(doc)).toContain('a -> b\n')
  })

  it('keeps a sublabel positional by writing the id when there is no label', () => {
    /* The sublabel is the second quoted string, so it cannot be emitted without
       a first one — the reader would take it as the label. */
    const doc = emptyDoc()
    doc.nodes.push({ id: 'n1', type: 'service', sublabel: 'only a sub', pos: [0, 0], rot: 0 })
    const back = parseDsl(toDsl(doc)).doc
    expect(back.nodes[0].sublabel).toBe('only a sub')
  })
})

describe('the node line carries state', () => {
  it('reads a state token, so a marked-up document round-trips', () => {
    const { doc, issues } = parseDsl('a service "A" down\nb service "B" #ff0000 new')
    expect(issues).toEqual([])
    expect(doc.nodes[0].state).toBe('down')
    expect(doc.nodes[1].state).toBe('new')
    expect(doc.nodes[1].tint).toBe('#ff0000')
  })

  it('still reports a token it does not understand', () => {
    const { issues } = parseDsl('a service "A" wobbly')
    expect(issues).toEqual([{ line: 1, message: 'ignored token "wobbly"' }])
  })
})
