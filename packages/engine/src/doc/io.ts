/**
 * Document serialisation.
 *
 * Version migration exists from the first release rather than being retrofitted
 * later, because the first file written in an unversioned format is the one
 * that becomes impossible to load.
 */

import { emptyDoc, seedIds, type Doc } from './schema.js'

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
    view: { ...base.view, ...(d.view ?? {}) },
    theme: { hues: { ...(d.theme?.hues ?? {}) } },
  }

  /* Drop edges whose endpoints do not exist rather than letting the router trip
     over them at render time. */
  const ids = new Set(doc.nodes.map((n) => n.id))
  const before = doc.edges.length
  doc.edges = doc.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
  const dropped = before - doc.edges.length
  if (dropped > 0) console.warn(`[isoform] dropped ${dropped} edge(s) with missing endpoints`)

  /* Fill defaults the schema requires but a hand-written file may omit. */
  for (const n of doc.nodes) {
    if (typeof n.rot !== 'number') n.rot = 0
    if (!Array.isArray(n.pos)) n.pos = [0, 0]
  }
  for (const e of doc.edges) {
    if (!e.kind) e.kind = 'sync'
    if (!e.route) e.route = 'auto'
  }

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
