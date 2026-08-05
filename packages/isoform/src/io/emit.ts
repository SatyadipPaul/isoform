/**
 * Text format — writing.
 *
 * The counterpart to `parseDsl`, and the surface an agent reaches for when it
 * has a document and wants something a human can read, review or paste into a
 * pull request. JSON is the wrong artefact for that: it is four times the size,
 * and the interesting change — a hop added to a trace — is buried in punctuation.
 *
 * ## What it will not do
 *
 * The format cannot carry everything a document holds, and the failure mode that
 * matters is the silent one: a writer that drops a node's tier height and hands
 * back text that parses cleanly has produced a *different diagram* that looks
 * like a successful export.
 *
 * So anything the grammar has no room for is written into the output as a
 * comment, beside the declaration it belongs to:
 *
 *     orders  service  "Orders"    # sublabel "checkout", tier 1
 *
 * Comments are stripped on the way back in, so the text still round-trips; the
 * fact is simply visible rather than gone. `dslGaps` returns the same list
 * separately for a caller that would rather branch on it than read it.
 *
 * Positions are the deliberate exception. Every node has one and none is
 * expressible — that is the format's whole premise, since `layout` derives them
 * — so noting it per node would bury the real losses in noise. It is stated once
 * in the header of the emitted file instead.
 */

import type { Doc, DocEdge, DocGroup, DocNode, DocTrace, EdgeKind } from '../doc/schema.js'

/** Arrow spelling per edge kind. The inverse of the parser's ARROWS table. */
const ARROW: Record<EdgeKind, string> = {
  sync: '->',
  async: '~>',
  duplex: '<->',
  flow: '=>',
  secure: '+>',
}

/**
 * Quote a label.
 *
 * The grammar reads a label as everything between two double quotes, so it has
 * no escape for a quote inside one. Rather than emit text that parses as
 * something else, the quote is folded to a typographic one — visually identical
 * in the rendered nameplate, and unambiguous to the parser.
 */
function quote(s: string): string {
  return `"${s.replace(/"/g, '”')}"`
}

/**
 * An id the grammar can read back.
 *
 * Ids are matched as `\S+`, so any run of non-space works — but a bare `#`
 * starts a comment, and an id containing an arrow would split the line into an
 * edge. Neither can be escaped, so an id that would not survive the trip is
 * reported rather than written.
 */
function idIsSafe(id: string): boolean {
  return /^[^\s#]+$/.test(id) && !/(<->|->|=>|~>|\+>)/.test(id)
}

/** Facts about one node that the text format has nowhere to put. */
function nodeGaps(n: DocNode): string[] {
  const out: string[] = []
  if (n.y) out.push(`tier ${n.y}`)
  if (n.rot) out.push(`rotated ${n.rot.toFixed(3)} rad`)
  if (n.scale !== undefined && n.scale !== 1) out.push(`scale ${n.scale}`)
  return out
}

function edgeGaps(e: DocEdge): string[] {
  const out: string[] = []
  if (e.from.port) out.push(`from port ${e.from.port}`)
  if (e.to.port) out.push(`to port ${e.to.port}`)
  if (e.route === 'manual') {
    out.push(`manual route, ${e.waypoints?.length ?? 0} waypoint(s)`)
  }
  return out
}

function groupGaps(g: DocGroup): string[] {
  /* 'compute' is what the parser assigns, so only a deviation is a loss. */
  return g.cat !== 'compute' ? [`category ${g.cat}`] : []
}

function traceGaps(t: DocTrace): string[] {
  /* Trace ids are assigned by the parser, so a document whose trace is named
     something an edge or a command refers to loses that reference. */
  return /^t\d+$/.test(t.id) ? [] : [`id "${t.id}"`]
}

const comment = (gaps: string[]): string => (gaps.length ? `   # ${gaps.join(', ')}` : '')

/**
 * Everything in `doc` that `toDsl` cannot express, one line per fact.
 *
 * Empty means the document survives a round trip through text intact, positions
 * aside. Worth checking before treating the text as the document rather than as
 * a description of it.
 */
export function dslGaps(doc: Doc): string[] {
  const out: string[] = []
  for (const n of doc.nodes) {
    for (const g of nodeGaps(n)) out.push(`node ${n.id}: ${g}`)
    if (!idIsSafe(n.id)) out.push(`node ${n.id}: id cannot be written in this format`)
  }
  for (const e of doc.edges) for (const g of edgeGaps(e)) out.push(`edge ${e.id}: ${g}`)
  for (const g of doc.groups) for (const x of groupGaps(g)) out.push(`group ${g.id}: ${x}`)
  for (const t of doc.traces) for (const x of traceGaps(t)) out.push(`trace ${t.label ?? t.id}: ${x}`)
  return out
}

export interface DslEmitOptions {
  /**
   * Head the output with a comment naming what the format does not carry.
   *
   * On by default. Turn it off for a diff, where a header that changes with the
   * document adds noise to every comparison.
   */
  header?: boolean
}

/**
 * Render `doc` as text in the format `parseDsl` reads.
 *
 * Declaration order is nodes, edges, groups, traces — chosen over the document's
 * own order because the format is order-independent (cross-references resolve
 * against the whole file) and a stable shape makes two emissions comparable with
 * a line diff.
 */
export function toDsl(doc: Doc, opts: DslEmitOptions = {}): string {
  const lines: string[] = []

  if (opts.header !== false) {
    lines.push('# Written by isoform. Positions are not carried by this format —')
    lines.push('# run the result through `layout` to place it.')
    lines.push('')
  }

  /* Column widths from the content, so the declarations line up as a table
     rather than as ragged text with one long name pushing everything over. */
  const idW = Math.max(0, ...doc.nodes.map((n) => n.id.length))
  const typeW = Math.max(0, ...doc.nodes.map((n) => n.type.length))

  for (const n of doc.nodes) {
    const bits = [n.id.padEnd(idW), n.type.padEnd(typeW)]
    /* A sublabel is the *second* quoted string, so it cannot be written without
       the first — an unlabelled node with a sublabel would read its sublabel as
       its label. Emitting the id as the label keeps the pair positional. */
    if (n.label || n.sublabel) bits.push(quote(n.label ?? n.id))
    if (n.sublabel) bits.push(quote(n.sublabel))
    if (n.tint) bits.push(n.tint)
    if (n.state) bits.push(n.state)
    lines.push(bits.join('  ').trimEnd() + comment(nodeGaps(n)))
  }

  if (doc.edges.length) {
    lines.push('')
    for (const e of doc.edges) {
      const label = e.label ? ` ${quote(e.label)}` : ''
      lines.push(`${e.from.node} ${ARROW[e.kind]} ${e.to.node}${label}` + comment(edgeGaps(e)))
    }
  }

  for (const g of doc.groups) {
    if (!g.members?.length) continue
    lines.push('')
    const label = g.label ? ` ${quote(g.label)}` : ` ${quote(g.id)}`
    lines.push(`group ${g.id}${label} { ${g.members.join(', ')} }` + comment(groupGaps(g)))
  }

  for (const t of doc.traces) {
    lines.push('')
    /* Timed when the document times every hop, which is the only spelling the
       parser accepts — a partly timed path is rejected rather than guessed at. */
    const timed = t.timings?.length === t.path.length - 1
    const body = t.path
      .map((id, i) => (i === 0 ? id : `${timed ? `-${t.timings![i - 1]}->` : '->'} ${id}`))
      .join(' ')
    lines.push(`trace ${quote(t.label ?? t.id)} { ${body} }` + comment(traceGaps(t)))
  }

  return lines.join('\n') + '\n'
}
