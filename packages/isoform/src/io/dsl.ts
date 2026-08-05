/**
 * Text format — reading.
 *
 * Writing lives in `emit.ts` and arrived much later, on purpose. Round-tripping
 * a *hand-authored* file means preserving comments, declaration order and every
 * manual override made by hand in the viewport, and a writer that quietly loses
 * those is worse than no writer at all. `toDsl` does not attempt it: it states
 * plainly which facts the format cannot carry, in the output itself. Reading is
 * the half that makes authoring fast, so it is the half that shipped first.
 *
 *     # comment
 *     web      client   "Browser"
 *     api      gateway  "API"        edge     # trailing comment
 *     orders   service  "Orders"     degraded # what it is doing
 *     cache    cache    "Redis"      #b45309  # a hue of its own
 *     pg       database "Postgres"
 *
 *     web -> api
 *     api -> orders
 *     orders => pg          # flow
 *     api ~> orders         # async
 *     web +> api            # secure
 *     api <-> orders        # duplex
 *
 *     group "Service tier" { orders, pg }
 *
 *     trace "Checkout" { web -> api -> orders -> pg }
 *     trace "Checkout" { web -12-> api -40-> orders -610-> pg }   # ms per hop
 *
 * The timed spelling puts each duration on the hop it belongs to rather than in
 * a list beside the path. A trailing array would have to be paired positionally,
 * and a mispairing animates perfectly while stating something false about which
 * hop is slow — the one error the feature exists to reveal.
 *
 * Positions are not expressed. A parsed document has every node at the origin
 * and is expected to be run through `layout` — which is the point: describing a
 * system should not require placing it.
 */

import {
  NODE_STATES,
  emptyDoc,
  type Doc,
  type DocEdge,
  type DocGroup,
  type DocNode,
  type DocTrace,
  type EdgeKind,
  type NodeState,
} from '../doc/schema.js'
import { CATEGORIES } from '../foundry/materials.js'
import { PART_IDS } from '../parts/manifests.js'
import type { PartId } from '../parts/types.js'

/** Arrow spellings, longest first so `<->` is not read as `<` then `-`. */
const ARROWS: Array<[string, EdgeKind]> = [
  ['<->', 'duplex'],
  ['=>', 'flow'],
  ['~>', 'async'],
  ['+>', 'secure'],
  ['->', 'sync'],
]

export interface DslIssue {
  line: number
  message: string
}

export interface DslResult {
  doc: Doc
  issues: DslIssue[]
}

/* Both derived, never spelled out. A hand-written copy of either list goes
   stale the first time a part or a category is added, and the failure is silent
   — the parser just starts calling a valid token unknown. */
const PARTS = new Set<string>(PART_IDS)
const CATS = new Set<string>(CATEGORIES)
const STATES = new Set<string>(NODE_STATES)

/**
 * Parse `text` into a document.
 *
 * Never throws. Unparseable lines become issues and are skipped, so one typo in
 * a long spec does not cost the whole diagram — the caller can render what was
 * understood and show the rest as warnings.
 */
export function parseDsl(text: string): DslResult {
  const doc = emptyDoc()
  const issues: DslIssue[] = []
  const nodes = new Map<string, DocNode>()
  const edges: DocEdge[] = []
  const groups: DocGroup[] = []
  const traces: DocTrace[] = []
  let seq = 0

  /**
   * Anything naming another declaration, held back until the file is read.
   *
   * Declarations used to be resolved where they appeared, which made the format
   * order-dependent in a way nobody would guess: the shipped example puts groups
   * *after* edges, so the moment a boundary became connectable, `api -> backend`
   * could never resolve — the group did not exist yet. Deferring the lookup
   * fixes that and makes forward references work everywhere, which is one less
   * rule to know either way.
   */
  const pending: Array<() => void> = []

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = stripComment(lines[i]).trim()
    if (!raw) continue

    /* group "Title" { a, b, c }  ·  group id "Title" { a, b, c }
       The optional leading id is what makes a boundary connectable: an edge can
       only name a group that has a name to be named by. */
    const gm = /^group\s+(?:([A-Za-z_][\w-]*)\s+)?("([^"]*)"|\S+)\s*\{([^}]*)\}\s*$/.exec(raw)
    if (gm) {
      const explicitId = gm[1]
      const label = gm[3] ?? gm[2]
      const members = gm[4]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const gid = explicitId ?? `g${++seq}`
      if (nodes.has(gid) || groups.some((g) => g.id === gid)) {
        issues.push({ line: lineNo, message: `duplicate id "${gid}"` })
        continue
      }
      const group: DocGroup = {
        id: gid,
        label,
        pos: [0, 0],
        /* Box is derived by `fitGroups` once members have positions. */
        size: [4, 1.5, 4],
        cat: 'compute',
        members: [],
      }
      groups.push(group)
      pending.push(() => {
        const missing = members.filter((m) => !nodes.has(m))
        if (missing.length) {
          issues.push({ line: lineNo, message: `unknown node(s) in group: ${missing.join(', ')}` })
        }
        group.members = members.filter((m) => nodes.has(m))
      })
      continue
    }

    /* trace "Title" { a -> b -> c }, hops optionally timed as `a -12-> b`.
       Must be tried before the edge rule below, which would otherwise see the
       arrows inside the braces and read the whole line as one malformed edge. */
    const tm = /^trace\s+("([^"]*)"|\S+)\s*\{([^}]*)\}\s*$/.exec(raw)
    if (tm) {
      const label = tm[2] ?? tm[1]
      const body = tm[3].trim()
      /* The duration and its leading dash are one optional unit: a plain hop is
         `->`, a timed one is `-12->`. Making only the digits optional would
         require a dash that a plain hop does not have, and every untimed trace
         would parse as a single unsplit node and be rejected as too short.

         Non-capturing, or `split` would interleave the durations with the ids. */
      const path = body
        .split(/\s*(?:-\s*\d+(?:\.\d+)?\s*)?->\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
      const timings = [...body.matchAll(/-\s*(\d+(?:\.\d+)?)\s*->/g)].map((m) => Number(m[1]))

      if (path.length < 2) {
        issues.push({ line: lineNo, message: 'a trace needs at least two nodes' })
        continue
      }
      pending.push(() => {
        const missing = path.filter((p) => !nodes.has(p))
        if (missing.length) {
          issues.push({ line: lineNo, message: `unknown node(s) in trace: ${missing.join(', ')}` })
        }
      })

      const trace: DocTrace = { id: `t${++seq}`, label, path }
      /* All hops timed or none. A partly timed path would have to guess at the
         rest, and every guess is a number the diagram then states as fact. */
      if (timings.length === path.length - 1) trace.timings = timings
      else if (timings.length) {
        issues.push({
          line: lineNo,
          message: `trace has ${timings.length} timings for ${path.length - 1} hops — time every hop or none`,
        })
      }
      traces.push(trace)
      continue
    }

    const arrow = ARROWS.find(([tok]) => raw.includes(tok))
    if (arrow) {
      const [tok, kind] = arrow
      const [lhs, rhs] = raw.split(tok)
      const from = lhs.trim()
      /* web -> api "https"  —  the quoted tail names what travels the line.
         Taken off the right-hand side before the node id is read, so a label
         containing a space cannot be mistaken for a second endpoint. */
      let to = rhs.trim()
      let edgeLabel: string | undefined
      const lm = /^(.*?)\s*"([^"]*)"\s*$/.exec(to)
      if (lm) {
        to = lm[1].trim()
        edgeLabel = lm[2] || undefined
      }
      if (!from || !to) {
        issues.push({ line: lineNo, message: `edge needs a node on both sides of "${tok}"` })
        continue
      }
      const edge: DocEdge = {
        id: `e${++seq}`,
        from: { node: from },
        to: { node: to },
        kind,
        route: 'auto',
      }
      if (edgeLabel) edge.label = edgeLabel
      pending.push(() => {
        /* Either end may name a group. A connector to a boundary wires a whole
           tier as one thing, instead of forcing the line to land on whichever
           member happens to sit nearest the edge of the box. */
        const known = (id: string): boolean => nodes.has(id) || groups.some((g) => g.id === id)
        for (const id of [from, to]) {
          if (!known(id)) issues.push({ line: lineNo, message: `unknown node or group "${id}"` })
        }
        if (known(from) && known(to)) edges.push(edge)
      })
      continue
    }

    /* id type "Label" ["Sublabel"] [tint] [state] — trailing tokens in any order.
       A second quoted string is the sublabel, which the nameplate has always
       drawn and the format had no way to say — so a document using one could not
       be written back out as text at all.
       Trailing bare tokens are taken as a group rather than one at a time,
       because a node can reasonably be both recoloured and marked down, and
       because a line carrying two of them used to fail the match outright and be
       reported as unparseable rather than as the one token not understood. */
    const nm = /^(\S+)\s+(\S+)(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?((?:\s+\S+)*)\s*$/.exec(raw)
    if (!nm) {
      issues.push({ line: lineNo, message: `could not parse "${raw}"` })
      continue
    }
    const [, id, type, label, sublabel, rest] = nm
    if (!PARTS.has(type)) {
      issues.push({ line: lineNo, message: `unknown part type "${type}"` })
      continue
    }
    if (nodes.has(id)) {
      issues.push({ line: lineNo, message: `duplicate node "${id}"` })
      continue
    }
    const node: DocNode = { id, type: type as PartId, pos: [0, 0], rot: 0 }
    if (label) node.label = label
    if (sublabel) node.sublabel = sublabel
    for (const tok of rest.split(/\s+/).filter(Boolean)) {
      if (/^#[0-9a-f]{6}$/i.test(tok)) node.tint = tok
      else if (STATES.has(tok)) node.state = tok as NodeState
      else if (!CATS.has(tok)) issues.push({ line: lineNo, message: `ignored token "${tok}"` })
    }
    nodes.set(id, node)
  }

  /* Every cross-reference resolves here, against the whole file. Issues come out
     in line order because that is the order they were queued in. */
  for (const resolve of pending) resolve()

  doc.nodes = [...nodes.values()]
  doc.edges = edges
  doc.groups = groups
  doc.traces = traces
  return { doc, issues }
}

/**
 * Strip a `#` comment.
 *
 * `#` has to serve two masters: it starts a comment and it prefixes a hex
 * colour. Two exemptions keep both spellings natural rather than forcing an
 * unfamiliar syntax on either — a `#` inside a quoted label, and a `#` that is
 * followed by exactly six hex digits and nothing wordlike after them.
 */
function stripComment(line: string): string {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuote = !inQuote
      continue
    }
    if (c !== '#' || inQuote) continue
    if (/^#[0-9a-f]{6}(?![0-9a-z])/i.test(line.slice(i))) {
      i += 6
      continue
    }
    return line.slice(0, i)
  }
  return line
}

export const DSL_EXAMPLE = `# Nodes:  id  type  "Label"
web      client    "Browser"
phone    mobile    "iOS app"
edge     cdn       "Edge"
api      gateway   "API"
idp      auth      "Identity"
orders   service   "Orders"
jobs     worker    "Fulfilment"
mq       queue     "Order queue"
pg       database  "Postgres"
redis    cache     "Redis"
find     search    "Catalogue"
metrics  monitor   "Telemetry"
psp      external  "Payments"

# Edges:  ->  sync    ~>  async    =>  flow    +>  secure    <->  duplex
web     -> edge
phone   -> edge
edge    -> api
api     +> idp
api     -> orders
orders  => pg
orders  ~> redis
orders  ~> mq
mq      -> jobs
jobs    -> find
jobs    +> psp
orders  -> metrics

# Boundaries:  group "Label" { members }
group "Public edge" { edge, api }
group "Control plane" { idp, metrics }

# Traces:  trace "Label" { a -> b }, or time each hop in ms:  a -12-> b
trace "Checkout"   { web -8-> edge -22-> api -14-> orders -310-> pg }
trace "Fulfilment" { orders -> mq -> jobs -> psp }
`
