/**
 * Commands — the only way a Doc ever changes.
 *
 * `apply` is pure: it returns a new Doc and never mutates the one passed in.
 * That is what lets the reconciler diff old against new by reference, and what
 * makes undo a matter of applying an inverse rather than restoring a snapshot.
 *
 * `invert` is computed against the PRE-state, because the inverse of "remove
 * node X" is "add node X back, with the properties it had" — information that
 * only exists before the command runs. Every command therefore satisfies
 *
 *     apply(apply(d, c), invert(d, c))  deep-equals  d
 *
 * which is exactly what commands.test.ts asserts over random sequences.
 */

import type { Doc, DocEdge, DocGroup, DocNode, DocTrace } from './schema.js'
import { findEdge, findNode, findTrace } from './schema.js'

/**
 * `at` on the add commands is the insertion index.
 *
 * Undoing a removal has to put the item back where it was, not on the end.
 * Without it a delete-then-undo silently reorders the document, which shows up
 * as noise in saved-file diffs and breaks the round-trip property outright.
 */
export type Command =
  | { t: 'addNode'; node: DocNode; at?: number }
  | { t: 'removeNode'; id: string }
  | { t: 'updateNode'; id: string; props: Partial<Omit<DocNode, 'id'>> }
  | { t: 'addEdge'; edge: DocEdge; at?: number }
  | { t: 'removeEdge'; id: string }
  | { t: 'updateEdge'; id: string; props: Partial<Omit<DocEdge, 'id'>> }
  | { t: 'addGroup'; group: DocGroup; at?: number }
  | { t: 'removeGroup'; id: string }
  | { t: 'updateGroup'; id: string; props: Partial<Omit<DocGroup, 'id'>> }
  | { t: 'addTrace'; trace: DocTrace; at?: number }
  | { t: 'removeTrace'; id: string }
  | { t: 'updateTrace'; id: string; props: Partial<Omit<DocTrace, 'id'>> }
  | { t: 'setTheme'; cat: string; hex: string | null }
  | { t: 'setView'; view: Doc['view'] }
  | { t: 'batch'; cmds: Command[] }

/** Insert at `at`, or append when it is not given. */
function insert<T>(list: readonly T[], item: T, at?: number): T[] {
  if (at === undefined || at < 0 || at >= list.length) return [...list, item]
  return [...list.slice(0, at), item, ...list.slice(at)]
}

/** Apply `props`, treating an explicit null as "delete this optional field". */
function merge<T extends object>(base: T, props: object): T {
  const out = { ...base } as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) delete out[k]
    else out[k] = v
  }
  return out as unknown as T
}

/** The subset of `full` named by the keys of `props` — an update's inverse. */
function pick<T>(full: object, props: object): T {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(props)) {
    const v = (full as Record<string, unknown>)[k]
    /* An absent field inverts to null, which `merge` reads as "delete". */
    out[k] = v === undefined ? null : v
  }
  return out as T
}

export function apply(doc: Doc, cmd: Command): Doc {
  switch (cmd.t) {
    case 'addNode':
      return { ...doc, nodes: insert(doc.nodes, cmd.node, cmd.at) }

    case 'removeNode':
      /* Removing a node removes the edges that reference it, or the document
         would carry dangling endpoints the router cannot resolve.

         Traces are deliberately left alone. An edge to a deleted node is
         meaningless, but a *trace* through one still says what it always said —
         the system used to work this way — and the player draws the hops it can
         and names the gap. Silently rewriting someone's stated path because a
         part was deleted is a worse answer than showing it broken. */
      return {
        ...doc,
        nodes: doc.nodes.filter((n) => n.id !== cmd.id),
        edges: doc.edges.filter((e) => e.from.node !== cmd.id && e.to.node !== cmd.id),
      }

    case 'updateNode':
      return {
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === cmd.id ? merge(n, cmd.props) : n)),
      }

    case 'addEdge':
      return { ...doc, edges: insert(doc.edges, cmd.edge, cmd.at) }

    case 'removeEdge':
      return { ...doc, edges: doc.edges.filter((e) => e.id !== cmd.id) }

    case 'updateEdge':
      return {
        ...doc,
        edges: doc.edges.map((e) => (e.id === cmd.id ? merge(e, cmd.props) : e)),
      }

    case 'addGroup':
      return { ...doc, groups: insert(doc.groups, cmd.group, cmd.at) }

    case 'removeGroup':
      /* Same cascade a node gets, and for the same reason: a boundary can
         terminate a connector, so deleting one would otherwise leave an edge
         pointing at nothing for the router to trip over. */
      return {
        ...doc,
        groups: doc.groups.filter((g) => g.id !== cmd.id),
        edges: doc.edges.filter((e) => e.from.node !== cmd.id && e.to.node !== cmd.id),
      }

    case 'updateGroup':
      return {
        ...doc,
        groups: doc.groups.map((g) => (g.id === cmd.id ? merge(g, cmd.props) : g)),
      }

    case 'addTrace':
      return { ...doc, traces: insert(doc.traces, cmd.trace, cmd.at) }

    case 'removeTrace':
      return { ...doc, traces: doc.traces.filter((t) => t.id !== cmd.id) }

    case 'updateTrace':
      return {
        ...doc,
        traces: doc.traces.map((t) => (t.id === cmd.id ? merge(t, cmd.props) : t)),
      }

    case 'setTheme': {
      const hues = { ...doc.theme.hues } as Record<string, string>
      if (cmd.hex === null) delete hues[cmd.cat]
      else hues[cmd.cat] = cmd.hex
      return { ...doc, theme: { ...doc.theme, hues } }
    }

    case 'setView':
      return { ...doc, view: { ...cmd.view, target: [...cmd.view.target] } }

    case 'batch':
      return cmd.cmds.reduce(apply, doc)
  }
}

/**
 * The command that undoes `cmd`, given the document as it was *before* `cmd`.
 */
export function invert(doc: Doc, cmd: Command): Command {
  switch (cmd.t) {
    case 'addNode':
      return { t: 'removeNode', id: cmd.node.id }

    case 'removeNode': {
      const at = doc.nodes.findIndex((n) => n.id === cmd.id)
      if (at < 0) return { t: 'batch', cmds: [] }
      /* Cascaded edge deletions have to come back too, and after the node —
         re-adding an edge whose endpoint is missing would be invalid. Each edge
         carries the index it held, and they are restored in ascending order so
         earlier insertions do not shift the ones that follow. */
      const dropped = doc.edges
        .map((edge, i) => ({ edge, i }))
        .filter(({ edge }) => edge.from.node === cmd.id || edge.to.node === cmd.id)
      return {
        t: 'batch',
        cmds: [
          { t: 'addNode', node: doc.nodes[at], at },
          ...dropped.map(({ edge, i }): Command => ({ t: 'addEdge', edge, at: i })),
        ],
      }
    }

    case 'updateNode': {
      const node = findNode(doc, cmd.id)
      if (!node) return { t: 'batch', cmds: [] }
      return { t: 'updateNode', id: cmd.id, props: pick(node, cmd.props) }
    }

    case 'addEdge':
      return { t: 'removeEdge', id: cmd.edge.id }

    case 'removeEdge': {
      const at = doc.edges.findIndex((e) => e.id === cmd.id)
      return at < 0 ? { t: 'batch', cmds: [] } : { t: 'addEdge', edge: doc.edges[at], at }
    }

    case 'updateEdge': {
      const edge = findEdge(doc, cmd.id)
      if (!edge) return { t: 'batch', cmds: [] }
      return { t: 'updateEdge', id: cmd.id, props: pick(edge, cmd.props) }
    }

    case 'addGroup':
      return { t: 'removeGroup', id: cmd.group.id }

    case 'removeGroup': {
      const at = doc.groups.findIndex((g) => g.id === cmd.id)
      if (at < 0) return { t: 'batch', cmds: [] }
      /* Cascaded edges come back too, after the group and in ascending index
         order so earlier insertions do not shift the ones that follow. */
      const dropped = doc.edges
        .map((edge, i) => ({ edge, i }))
        .filter(({ edge }) => edge.from.node === cmd.id || edge.to.node === cmd.id)
      return {
        t: 'batch',
        cmds: [
          { t: 'addGroup', group: doc.groups[at], at },
          ...dropped.map(({ edge, i }): Command => ({ t: 'addEdge', edge, at: i })),
        ],
      }
    }

    case 'updateGroup': {
      const group = doc.groups.find((g) => g.id === cmd.id)
      if (!group) return { t: 'batch', cmds: [] }
      return { t: 'updateGroup', id: cmd.id, props: pick(group, cmd.props) }
    }

    case 'addTrace':
      return { t: 'removeTrace', id: cmd.trace.id }

    case 'removeTrace': {
      const at = doc.traces.findIndex((t) => t.id === cmd.id)
      return at < 0 ? { t: 'batch', cmds: [] } : { t: 'addTrace', trace: doc.traces[at], at }
    }

    case 'updateTrace': {
      const trace = findTrace(doc, cmd.id)
      if (!trace) return { t: 'batch', cmds: [] }
      return { t: 'updateTrace', id: cmd.id, props: pick(trace, cmd.props) }
    }

    case 'setTheme':
      return { t: 'setTheme', cat: cmd.cat, hex: doc.theme.hues[cmd.cat as never] ?? null }

    case 'setView':
      return { t: 'setView', view: doc.view }

    case 'batch': {
      /* Invert each step against the state it will actually see, then reverse. */
      const invs: Command[] = []
      let cursor = doc
      for (const c of cmd.cmds) {
        invs.push(invert(cursor, c))
        cursor = apply(cursor, c)
      }
      return { t: 'batch', cmds: invs.reverse() }
    }
  }
}

/** Node ids a command touches, for deciding which edges need re-routing. */
export function touchedNodes(cmd: Command, out = new Set<string>()): Set<string> {
  switch (cmd.t) {
    case 'addNode':
      out.add(cmd.node.id)
      break
    case 'removeNode':
    case 'updateNode':
      out.add(cmd.id)
      break
    case 'addEdge':
      out.add(cmd.edge.from.node)
      out.add(cmd.edge.to.node)
      break
    case 'batch':
      for (const c of cmd.cmds) touchedNodes(c, out)
      break
    default:
      break
  }
  return out
}
