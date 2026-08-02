/**
 * Trace syntax in the text format.
 *
 * The parser's contract is that it never throws — a typo costs one line, not the
 * diagram. So every failure here is a *silent* one: a trace that parses into the
 * wrong path, or timings paired with the wrong hops, produce a document that
 * renders beautifully and says something untrue.
 */

import { describe, expect, it } from 'vitest'
import { DSL_EXAMPLE, parseDsl } from './dsl.js'

const NODES = `
web    client   "Browser"
api    gateway  "API"
orders service  "Orders"
pg     database "Postgres"
`

const parse = (extra: string) => parseDsl(NODES + extra)

describe('trace', () => {
  it('reads a plain path', () => {
    const { doc, issues } = parse('trace "Checkout" { web -> api -> orders -> pg }')
    expect(issues).toEqual([])
    expect(doc.traces).toHaveLength(1)
    expect(doc.traces[0].label).toBe('Checkout')
    expect(doc.traces[0].path).toEqual(['web', 'api', 'orders', 'pg'])
    expect(doc.traces[0].timings).toBeUndefined()
  })

  it('reads a timed path, keeping each duration on its own hop', () => {
    const { doc, issues } = parse('trace "Checkout" { web -8-> api -22-> orders -610-> pg }')
    expect(issues).toEqual([])
    expect(doc.traces[0].path).toEqual(['web', 'api', 'orders', 'pg'])
    expect(doc.traces[0].timings).toEqual([8, 22, 610])
  })

  it('does not mistake a trace line for an edge', () => {
    /* The edge rule matches on any line containing `->`. If it ran first it
       would read this whole line as one edge from `trace "Checkout" { web` to
       something, and the trace would vanish with a confusing complaint. */
    const { doc } = parse('trace "Checkout" { web -> api }')
    expect(doc.traces).toHaveLength(1)
    expect(doc.edges).toHaveLength(0)
  })

  it('keeps traces and edges apart on adjacent lines', () => {
    const { doc, issues } = parse(`
web -> api
trace "T" { web -> api }
api => orders
`)
    expect(issues).toEqual([])
    expect(doc.edges.map((e) => e.kind)).toEqual(['sync', 'flow'])
    expect(doc.traces).toHaveLength(1)
  })

  it('accepts decimal durations', () => {
    const { doc } = parse('trace "T" { web -0.5-> api }')
    expect(doc.traces[0].timings).toEqual([0.5])
  })

  it('refuses a partly timed path rather than guessing the rest', () => {
    /* Every guessed number is one the diagram then states as fact. */
    const { doc, issues } = parse('trace "T" { web -8-> api -> orders }')
    expect(doc.traces[0].path).toEqual(['web', 'api', 'orders'])
    expect(doc.traces[0].timings).toBeUndefined()
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/time every hop or none/)
  })

  it('reports unknown nodes but still records the trace', () => {
    const { doc, issues } = parse('trace "T" { web -> ghost -> pg }')
    expect(issues[0].message).toMatch(/unknown node\(s\) in trace: ghost/)
    /* Kept, not dropped: the path is what someone said, and the player draws
       the hops it can and names the gap. */
    expect(doc.traces[0].path).toEqual(['web', 'ghost', 'pg'])
  })

  it('rejects a path with nothing to travel', () => {
    const { doc, issues } = parse('trace "T" { web }')
    expect(doc.traces).toHaveLength(0)
    expect(issues[0].message).toMatch(/at least two nodes/)
  })

  it('survives a trace with no nodes defined at all', () => {
    const { issues } = parseDsl('trace "T" { a -> b }')
    expect(issues).toHaveLength(1)
    expect(() => parseDsl('trace "T" { a -> b }')).not.toThrow()
  })
})

describe('the examples in the README', () => {
  /* Shipped as the documentation someone copies first. An example that warns —
     or silently drops the thing it is demonstrating — teaches the warning. */

  it('parses the trace recipe', () => {
    const { doc, issues } = parseDsl(`
web    client   "Browser"
api    gateway  "API"
orders service  "Orders"
pg     database "Postgres"

web -> api
api -> orders
orders => pg

trace "Checkout" { web -8-> api -14-> orders -310-> pg }
`)
    expect(issues).toEqual([])
    expect(doc.traces[0].timings).toEqual([8, 14, 310])
    expect(doc.traces[0].path).toEqual(['web', 'api', 'orders', 'pg'])
  })

  it('parses the group-connection recipe, with the group declared last', () => {
    /* The ordering the README shows and the one every other example uses:
       edges first, boundaries after. This is exactly what a single-pass parser
       could not resolve. */
    const { doc, issues } = parseDsl(`
api     gateway "API"
orders  service "Orders"
pg      database "Postgres"
metrics monitor "Telemetry"

api     -> backend
backend -> metrics

group backend "Backend tier" { orders, pg }
`)
    expect(issues).toEqual([])
    expect(doc.edges.map((e) => `${e.from.node}>${e.to.node}`)).toEqual([
      'api>backend',
      'backend>metrics',
    ])
    expect(doc.groups[0].id).toBe('backend')
    expect(doc.groups[0].members).toEqual(['orders', 'pg'])
  })
})

describe('DSL_EXAMPLE', () => {
  it('parses without a single issue', () => {
    /* Shipped in the editor as the thing a new user reads first. An example that
       warns teaches the warning. */
    const { doc, issues } = parseDsl(DSL_EXAMPLE)
    expect(issues).toEqual([])
    expect(doc.nodes.length).toBeGreaterThan(10)
    expect(doc.traces).toHaveLength(2)
  })

  it('demonstrates both the timed and untimed spellings', () => {
    const { doc } = parseDsl(DSL_EXAMPLE)
    expect(doc.traces.filter((t) => t.timings).length).toBe(1)
    expect(doc.traces.filter((t) => !t.timings).length).toBe(1)
  })

  it('lays out every trace hop on a real connector', () => {
    /* The example is the one document guaranteed to be looked at. A trace in it
       that cannot be drawn would be the first thing a new user sees fail. */
    const { doc } = parseDsl(DSL_EXAMPLE)
    const pairs = new Set(doc.edges.flatMap((e) => [`${e.from.node}>${e.to.node}`, `${e.to.node}>${e.from.node}`]))
    for (const t of doc.traces) {
      for (let i = 0; i < t.path.length - 1; i++) {
        expect(pairs.has(`${t.path[i]}>${t.path[i + 1]}`), `${t.path[i]} → ${t.path[i + 1]} has no edge`).toBe(true)
      }
    }
  })
})
