/**
 * Text format.
 *
 * Import only, deliberately. Round-tripping a document back out to text means
 * preserving comments, declaration order and every manual override the user made
 * by hand in the viewport — a project in its own right, and one that silently
 * loses work when it gets it wrong. Reading is the half that makes authoring
 * fast, so it is the half that ships first.
 *
 *     # comment
 *     web      client   "Browser"
 *     api      gateway  "API"        edge     # trailing comment
 *     orders   service  "Orders"
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
 * Positions are not expressed. A parsed document has every node at the origin
 * and is expected to be run through `layout` — which is the point: describing a
 * system should not require placing it.
 */

import { emptyDoc, type Doc, type DocEdge, type DocGroup, type DocNode, type EdgeKind } from '../doc/schema.js'
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
  let seq = 0

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = stripComment(lines[i]).trim()
    if (!raw) continue

    /* group "Title" { a, b, c } */
    const gm = /^group\s+("([^"]*)"|\S+)\s*\{([^}]*)\}\s*$/.exec(raw)
    if (gm) {
      const label = gm[2] ?? gm[1]
      const members = gm[3]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const missing = members.filter((m) => !nodes.has(m))
      if (missing.length) {
        issues.push({ line: lineNo, message: `unknown node(s) in group: ${missing.join(', ')}` })
      }
      groups.push({
        id: `g${++seq}`,
        label,
        pos: [0, 0],
        /* Box is derived by `fitGroups` once members have positions. */
        size: [4, 1.5, 4],
        cat: 'compute',
        members: members.filter((m) => nodes.has(m)),
      })
      continue
    }

    const arrow = ARROWS.find(([tok]) => raw.includes(tok))
    if (arrow) {
      const [tok, kind] = arrow
      const [lhs, rhs] = raw.split(tok)
      const from = lhs.trim()
      const to = rhs.trim()
      if (!from || !to) {
        issues.push({ line: lineNo, message: `edge needs a node on both sides of "${tok}"` })
        continue
      }
      for (const id of [from, to]) {
        if (!nodes.has(id)) issues.push({ line: lineNo, message: `unknown node "${id}"` })
      }
      if (nodes.has(from) && nodes.has(to)) {
        edges.push({
          id: `e${++seq}`,
          from: { node: from },
          to: { node: to },
          kind,
          route: 'auto',
        })
      }
      continue
    }

    /* id type "Label" [tint] */
    const nm = /^(\S+)\s+(\S+)(?:\s+"([^"]*)")?(?:\s+(\S+))?\s*$/.exec(raw)
    if (!nm) {
      issues.push({ line: lineNo, message: `could not parse "${raw}"` })
      continue
    }
    const [, id, type, label, extra] = nm
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
    if (extra) {
      if (/^#[0-9a-f]{6}$/i.test(extra)) node.tint = extra
      else if (!CATS.has(extra)) issues.push({ line: lineNo, message: `ignored token "${extra}"` })
    }
    nodes.set(id, node)
  }

  doc.nodes = [...nodes.values()]
  doc.edges = edges
  doc.groups = groups
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
`
