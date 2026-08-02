/**
 * Document serialisation.
 *
 * Version migration exists from the first release rather than being retrofitted
 * later, because the first file written in an unversioned format is the one
 * that becomes impossible to load.
 */

import { emptyDoc, NODE_STATES, seedIds, type Doc } from './schema.js'

export const FILE_EXT = '.isoform'

export function serialize(doc: Doc): string {
  return JSON.stringify(doc, null, 2)
}

export class DocParseError extends Error {}

/** Parse and validate, filling in anything a older or hand-written file omits. */
export function deserialize(text: string): Doc {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new DocParseError(`Not valid JSON: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object') throw new DocParseError('Document must be an object')

  const d = raw as Partial<Doc>
  if (typeof d.version !== 'number') throw new DocParseError('Missing "version"')
  if (d.version > 1) {
    throw new DocParseError(`Document version ${d.version} is newer than this build supports`)
  }

  const base = emptyDoc()
  const doc: Doc = {
    version: 1,
    units: { ...base.units, ...(d.units ?? {}) },
    nodes: Array.isArray(d.nodes) ? d.nodes : [],
    edges: Array.isArray(d.edges) ? d.edges : [],
    groups: Array.isArray(d.groups) ? d.groups : [],
    /* Rebuilt key by key, so a top-level field that is not named here is dropped
       on load without a word — the document round-trips and the data is simply
       gone. Adding one to the schema means adding it here in the same change. */
    traces: Array.isArray(d.traces) ? d.traces : [],
    view: { ...base.view, ...(d.view ?? {}) },
    theme: { hues: { ...(d.theme?.hues ?? {}) } },
  }

  /* Drop edges whose endpoints do not exist rather than letting the router trip
     over them at render time.

     Groups count as endpoints. A connector may terminate on a boundary — wiring
     a tier as one thing rather than picking some arbitrary member inside it — so
     an edge naming a group is valid and must survive the round trip. */
  const ids = new Set([...doc.nodes.map((n) => n.id), ...doc.groups.map((g) => g.id)])
  const before = doc.edges.length
  doc.edges = doc.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
  const dropped = before - doc.edges.length
  if (dropped > 0) console.warn(`[isoform] dropped ${dropped} edge(s) with missing endpoints`)

  /* Fill defaults the schema requires but a hand-written file may omit. */
  for (const n of doc.nodes) {
    if (typeof n.rot !== 'number') n.rot = 0
    if (!Array.isArray(n.pos)) n.pos = [0, 0]
    /* An unrecognised state renders as nothing, which is harmless, but it would
       still reach the batch key and open a batch that draws exactly like the
       default one. Dropping it here keeps that out of the render path — and
       files written by hand or by an agent are where it will come from. */
    if (n.state !== undefined && !NODE_STATES.includes(n.state)) {
      console.warn(`[isoform] node "${n.id}" has unknown state "${n.state}" — ignoring`)
      delete n.state
    }
  }
  for (const e of doc.edges) {
    if (!e.kind) e.kind = 'sync'
    if (!e.route) e.route = 'auto'
  }

  /* Traces are left pointing wherever they point, including at nodes that no
     longer exist. A path is an assertion about the system, and a hop the diagram
     cannot draw is worth reporting rather than quietly deleting — the player
     renders what it can and names the gaps. What is dropped is a trace too short
     to mean anything, and a timings array that does not match its path, since
     both would otherwise fail far from here. */
  doc.traces = doc.traces.filter((t) => {
    if (!Array.isArray(t.path) || t.path.length < 2) {
      console.warn(`[isoform] trace "${t.id}" has fewer than two hops — dropping`)
      return false
    }
    if (t.timings && t.timings.length !== t.path.length - 1) {
      console.warn(
        `[isoform] trace "${t.id}" has ${t.timings.length} timings for ${t.path.length - 1} hops — ignoring them`,
      )
      delete t.timings
    }
    return true
  })

  seedIds(doc)
  return doc
}

/** Trigger a download of the document. Browser only. */
export function downloadDoc(doc: Doc, filename = `diagram${FILE_EXT}`): void {
  const blob = new Blob([serialize(doc)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
