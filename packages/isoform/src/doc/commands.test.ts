import { describe, expect, it } from 'vitest'
import { apply, invert, touchedNodes, type Command } from './commands.js'
import { emptyDoc, type Doc, type DocEdge, type DocNode } from './schema.js'
import { mulberry32 } from '../foundry/rng.js'
import type { PartId } from '../parts/types.js'

const TYPES: PartId[] = ['service', 'database', 'cache', 'gateway', 'queue']

function node(id: string, x = 0, z = 0): DocNode {
  return { id, type: 'service', pos: [x, z], rot: 0 }
}

function edge(id: string, from: string, to: string): DocEdge {
  return { id, from: { node: from }, to: { node: to }, kind: 'sync', route: 'auto' }
}

function seeded(): Doc {
  let d = emptyDoc()
  for (const c of [
    { t: 'addNode', node: node('n1', 0, 0) },
    { t: 'addNode', node: node('n2', 3, 0) },
    { t: 'addNode', node: node('n3', 6, 2) },
    { t: 'addEdge', edge: edge('e1', 'n1', 'n2') },
    { t: 'addEdge', edge: edge('e2', 'n2', 'n3') },
  ] as Command[]) {
    d = apply(d, c)
  }
  return d
}

describe('apply', () => {
  it('does not mutate the input document', () => {
    const before = seeded()
    const snapshot = structuredClone(before)
    apply(before, { t: 'addNode', node: node('nX', 9, 9) })
    expect(before).toEqual(snapshot)
  })

  it('cascades edge removal when a node goes', () => {
    const d = apply(seeded(), { t: 'removeNode', id: 'n2' })
    expect(d.nodes.map((n) => n.id)).toEqual(['n1', 'n3'])
    /* Both edges referenced n2, so both must be gone. */
    expect(d.edges).toEqual([])
  })

  it('treats null in an update as deleting the field', () => {
    let d = apply(seeded(), { t: 'updateNode', id: 'n1', props: { label: 'API' } })
    expect(d.nodes[0].label).toBe('API')
    d = apply(d, { t: 'updateNode', id: 'n1', props: { label: null as never } })
    expect('label' in d.nodes[0]).toBe(false)
  })
})

describe('invert', () => {
  const roundTrips = (start: Doc, cmd: Command): void => {
    const inv = invert(start, cmd)
    const there = apply(start, cmd)
    const back = apply(there, inv)
    expect(back).toEqual(start)
  }

  it('round-trips addNode', () => roundTrips(seeded(), { t: 'addNode', node: node('nX', 1, 1) }))

  it('round-trips removeNode with its cascaded edges', () =>
    roundTrips(seeded(), { t: 'removeNode', id: 'n2' }))

  it('round-trips updateNode', () =>
    roundTrips(seeded(), { t: 'updateNode', id: 'n1', props: { pos: [5, 5], rot: 1.2 } }))

  it('round-trips an update that adds a previously absent field', () =>
    roundTrips(seeded(), { t: 'updateNode', id: 'n1', props: { label: 'new' } }))

  it('round-trips addEdge and removeEdge', () => {
    roundTrips(seeded(), { t: 'addEdge', edge: edge('eX', 'n1', 'n3') })
    roundTrips(seeded(), { t: 'removeEdge', id: 'e1' })
  })

  it('round-trips the trace commands', () => {
    const withTrace = apply(seeded(), {
      t: 'addTrace',
      trace: { id: 't1', label: 'Checkout', path: ['n1', 'n2', 'n3'], timings: [10, 20] },
    })
    roundTrips(seeded(), { t: 'addTrace', trace: { id: 'tX', path: ['n1', 'n2'] } })
    roundTrips(withTrace, { t: 'removeTrace', id: 't1' })
    roundTrips(withTrace, { t: 'updateTrace', id: 't1', props: { path: ['n1', 'n3'] } })
    /* Removing the optional timings has to invert back to restoring them. */
    roundTrips(withTrace, { t: 'updateTrace', id: 't1', props: { timings: null as never } })
  })

  it('leaves traces standing when a node they name is deleted', () => {
    /* An edge to a deleted node is meaningless; a trace through one still says
       what it said. Cascading here would silently rewrite someone's stated path
       — and would then have to be undone exactly, for no gain. */
    const d = apply(seeded(), {
      t: 'addTrace',
      trace: { id: 't1', path: ['n1', 'n2', 'n3'] },
    })
    const after = apply(d, { t: 'removeNode', id: 'n2' })
    expect(after.traces[0].path).toEqual(['n1', 'n2', 'n3'])
  })

  it('round-trips theme set and clear', () => {
    roundTrips(seeded(), { t: 'setTheme', cat: 'compute', hex: '#ff0000' })
    const themed = apply(seeded(), { t: 'setTheme', cat: 'compute', hex: '#ff0000' })
    roundTrips(themed, { t: 'setTheme', cat: 'compute', hex: null })
  })

  it('round-trips a batch', () =>
    roundTrips(seeded(), {
      t: 'batch',
      cmds: [
        { t: 'addNode', node: node('nA', 2, 2) },
        { t: 'removeNode', id: 'n2' },
        { t: 'updateNode', id: 'n1', props: { label: 'x' } },
      ],
    }))

  it('is a no-op when the target is missing', () => {
    const d = seeded()
    roundTrips(d, { t: 'removeNode', id: 'nope' })
    roundTrips(d, { t: 'updateNode', id: 'nope', props: { rot: 1 } })
  })
})

describe('random command sequences', () => {
  /**
   * The property the whole undo stack rests on: applying any sequence and then
   * its inverses in reverse must land exactly back on the starting document.
   */
  it('undo the whole sequence and land back on the start', () => {
    const rng = mulberry32(0xbeef)
    const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]

    for (let trial = 0; trial < 60; trial++) {
      const start = seeded()
      let cursor = start
      const invs: Command[] = []

      for (let step = 0; step < 12; step++) {
        const ids = cursor.nodes.map((n) => n.id)
        const eids = cursor.edges.map((e) => e.id)
        const tids = cursor.traces.map((t) => t.id)
        const choices: Command[] = [
          { t: 'addNode', node: { ...node(`r${trial}_${step}`), type: pick(TYPES) } },
          { t: 'updateNode', id: ids.length ? pick(ids) : 'n1', props: { rot: rng() * 6 } },
          { t: 'updateNode', id: ids.length ? pick(ids) : 'n1', props: { label: `L${step}` } },
          { t: 'setTheme', cat: pick(['compute', 'data', 'msg']), hex: '#123456' },
        ]
        if (ids.length > 1) choices.push({ t: 'removeNode', id: pick(ids) })
        if (eids.length) choices.push({ t: 'removeEdge', id: pick(eids) })
        if (ids.length > 1) {
          choices.push({ t: 'addEdge', edge: edge(`re${trial}_${step}`, pick(ids), pick(ids)) })
          choices.push({
            t: 'addTrace',
            trace: { id: `rt${trial}_${step}`, path: [pick(ids), pick(ids)] },
          })
        }
        if (tids.length) {
          choices.push({ t: 'removeTrace', id: pick(tids) })
          /* Both directions matter: `timings` is optional, so setting it on a
             trace that lacks it must invert to a deletion rather than to
             `undefined`, and that is the case `pick` exists to handle. */
          choices.push({ t: 'updateTrace', id: pick(tids), props: { timings: [step * 10] } })
          choices.push({ t: 'updateTrace', id: pick(tids), props: { label: `T${step}` } })
        }

        const cmd = pick(choices)
        invs.push(invert(cursor, cmd))
        cursor = apply(cursor, cmd)
      }

      for (const inv of invs.reverse()) cursor = apply(cursor, inv)
      expect(cursor).toEqual(start)
    }
  })
})

describe('touchedNodes', () => {
  it('collects endpoints of an added edge', () => {
    expect([...touchedNodes({ t: 'addEdge', edge: edge('e9', 'a', 'b') })].sort()).toEqual(['a', 'b'])
  })

  it('recurses into batches', () => {
    const got = touchedNodes({
      t: 'batch',
      cmds: [
        { t: 'updateNode', id: 'n1', props: { rot: 1 } },
        { t: 'removeNode', id: 'n2' },
      ],
    })
    expect([...got].sort()).toEqual(['n1', 'n2'])
  })
})
