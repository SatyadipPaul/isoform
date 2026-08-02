/**
 * Trace playback.
 *
 * Everything below runs against a real `Reconciler` and real resolved routes —
 * the player asks it where connectors run, exactly as it does in the editor.
 *
 * The arithmetic is where this feature can be quietly wrong. A packet at the
 * wrong hop still looks like a packet; a hop traversed backwards still moves; a
 * timings array paired with the wrong hop still animates. None of those show up
 * as an error, and all of them make the picture say something untrue about the
 * system — which is worse than not drawing it at all.
 */

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Reconciler } from './reconciler.js'
import { palette } from '../foundry/materials.js'
import { emptyDoc, type Doc, type DocNode, type DocTrace } from '../doc/schema.js'

/** a → b → c in a line, with c → d declared *backwards* as d → c. */
function doc(): Doc {
  const d = emptyDoc()
  const ids = ['a', 'b', 'c', 'e']
  d.nodes = ids.map(
    (id, i): DocNode => ({ id, type: 'service', pos: [i * 5, 0], rot: 0 }),
  )
  d.edges = [
    { id: 'ab', from: { node: 'a' }, to: { node: 'b' }, kind: 'sync', route: 'auto' },
    { id: 'bc', from: { node: 'b' }, to: { node: 'c' }, kind: 'sync', route: 'auto' },
    /* Declared c ← e. A trace going c → e traverses it against its direction,
       which is the common case the moment anything replies to anything. */
    { id: 'ec', from: { node: 'e' }, to: { node: 'c' }, kind: 'sync', route: 'auto' },
  ]
  return d
}

function build(d: Doc = doc()): Reconciler {
  const r = new Reconciler(new THREE.Scene(), { anchorIdle: palette('link').lit('lit', 0.9) })
  r.sync(d)
  return r
}

const trace = (path: string[], timings?: number[]): DocTrace => ({ id: 't', path, timings })

describe('resolve', () => {
  it('turns a node path into hops along real connectors', () => {
    const r = build()
    const res = r.trace.resolve(trace(['a', 'b', 'c']))

    expect(res.playable).toBe(true)
    expect(res.gaps).toEqual([])
    expect(res.hops.map((h) => h.edgeId)).toEqual(['ab', 'bc'])
    expect(res.hops.every((h) => h.forward)).toBe(true)
  })

  it('traverses a connector declared the other way round', () => {
    const r = build()
    const res = r.trace.resolve(trace(['b', 'c', 'e']))

    expect(res.hops.map((h) => h.edgeId)).toEqual(['bc', 'ec'])
    /* c → e runs against `ec`, which is declared e → c. */
    expect(res.hops.map((h) => h.forward)).toEqual([true, false])
  })

  it('reports a hop with no connector instead of throwing', () => {
    const r = build()
    /* a and c are both real nodes with no edge between them — the shape an
       agent-written path takes when it guesses at the topology. */
    const res = r.trace.resolve(trace(['a', 'c', 'e']))

    expect(res.gaps).toEqual([{ from: 'a', to: 'c' }])
    /* The hop that does exist is still drawn. */
    expect(res.hops.map((h) => h.edgeId)).toEqual(['ec'])
    expect(res.playable).toBe(true)
  })

  it('reports a path naming nodes that do not exist, and stays unplayable', () => {
    const r = build()
    const res = r.trace.resolve(trace(['ghost', 'phantom']))
    expect(res.gaps).toEqual([{ from: 'ghost', to: 'phantom' }])
    expect(res.playable).toBe(false)
  })

  it('weights hops by arc length when there are no timings', () => {
    const r = build()
    /* a→b spans 5 units, b→c spans 5. Equal spans, so equal shares. */
    const res = r.trace.resolve(trace(['a', 'b', 'c']))
    expect(res.hops[0].weight).toBeCloseTo(0.5, 2)
    expect(res.hops[1].weight).toBeCloseTo(0.5, 2)
  })

  it('lets timings override distance, so the slow hop takes the time', () => {
    const r = build()
    const res = r.trace.resolve(trace(['a', 'b', 'c'], [100, 900]))

    /* Same physical distance, nine times the duration. This is the whole
       difference between drawing a route and drawing where the time goes. */
    expect(res.hops[0].weight).toBeCloseTo(0.1, 3)
    expect(res.hops[1].weight).toBeCloseTo(0.9, 3)
  })

  it('ignores a timings array that does not match the path', () => {
    const r = build()
    /* Two hops, three timings. Pairing them positionally would silently give
       hop 2 the wrong duration, which animates perfectly and lies. */
    const res = r.trace.resolve(trace(['a', 'b', 'c'], [1, 2, 3]))
    expect(res.hops[0].weight).toBeCloseTo(0.5, 2)
  })

  it('still moves when every timing is zero', () => {
    const r = build()
    const res = r.trace.resolve(trace(['a', 'b', 'c'], [0, 0]))
    expect(res.hops.every((h) => h.weight > 0)).toBe(true)
    expect(res.hops.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 6)
  })

  it('weights sum to one so the packet arrives exactly at the end', () => {
    const r = build()
    for (const t of [trace(['a', 'b', 'c']), trace(['a', 'b', 'c'], [3, 7])]) {
      const res = r.trace.resolve(t)
      expect(res.hops.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 6)
    }
  })
})

describe('seek', () => {
  const at = (r: Reconciler, u: number): THREE.Vector3 => {
    r.trace.seek(u)
    return r.trace.group.children[0].position.clone()
  }

  it('runs from the first node to the last', () => {
    const r = build()
    r.trace.load(trace(['a', 'b', 'c']))

    const start = at(r, 0)
    const end = at(r, 1)
    /* Nodes sit at x = 0, 5, 10. The packet starts near a and finishes near c,
       inside one arrowhead's setback at each end. */
    expect(start.x).toBeLessThan(1.5)
    expect(end.x).toBeGreaterThan(8.5)
  })

  it('advances monotonically along the run', () => {
    const r = build()
    r.trace.load(trace(['a', 'b', 'c']))

    let last = -Infinity
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const x = at(r, Math.min(u, 1)).x
      expect(x).toBeGreaterThanOrEqual(last - 1e-6)
      last = x
    }
  })

  it('runs a backwards hop in the direction the trace asks for', () => {
    const r = build()
    /* c → e. The connector is declared e → c, so without the parameter flip the
       packet would set off toward c and arrive back where it started. */
    r.trace.load(trace(['c', 'e']))

    const start = at(r, 0)
    const end = at(r, 1)
    /* c sits at x = 10, e at x = 15. */
    expect(start.x).toBeLessThan(end.x)
    expect(end.x).toBeGreaterThan(13)
  })

  it('spends its time where the timings say, not where the distance is', () => {
    const r = build()
    r.trace.load(trace(['a', 'b', 'c'], [100, 900]))

    /* A tenth of the way through, the packet should be arriving at b — the
       whole first hop is over. With length weighting it would be halfway along
       the first hop instead. */
    const x = at(r, 0.1).x
    expect(x).toBeGreaterThan(3.5)
    expect(x).toBeLessThan(6.5)
  })
})

describe('playback', () => {
  it('does not move until it is played', () => {
    const r = build()
    r.trace.load(trace(['a', 'b', 'c']))
    const before = r.trace.progress
    r.trace.tick(0.5)
    expect(r.trace.progress).toBe(before)
  })

  it('advances in elapsed seconds and wraps', () => {
    const r = build()
    r.trace.load(trace(['a', 'b', 'c']))
    r.trace.play()

    r.trace.tick(1.6)
    const half = r.trace.progress
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(1)

    /* Well past the end: it loops rather than stopping at 1, so a trace left
       playing keeps making its point. */
    r.trace.tick(10)
    expect(r.trace.progress).toBeGreaterThanOrEqual(0)
    expect(r.trace.progress).toBeLessThan(1)
  })

  it('refuses to play a trace with nothing drawable in it', () => {
    const r = build()
    r.trace.load(trace(['ghost', 'phantom']))
    r.trace.play()
    expect(r.trace.isPlaying).toBe(false)
  })

  it('follows the connector after a part is dragged', () => {
    const d = doc()
    const r = build(d)
    r.trace.load(trace(['a', 'b', 'c']))
    r.trace.seek(0.5)
    const before = r.trace.group.children[0].position.clone()

    /* Move b a long way off the line. The route changes shape, so the curve the
       packet is travelling is stale — it would keep following the old line. */
    const moved: Doc = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === 'b' ? { ...n, pos: [5, 12] as [number, number] } : n)),
    }
    r.sync(moved)
    r.trace.seek(0.5)

    expect(r.trace.group.children[0].position.distanceTo(before)).toBeGreaterThan(1)
  })

  it('parks the marker on the node the packet has reached', () => {
    const r = build()
    r.trace.load(trace(['a', 'b', 'c']))

    r.trace.seek(0.01)
    expect(r.trace.reached).toBeNull()

    /* Just past the first hop's share: b has been reached, c has not. */
    r.trace.seek(0.55)
    expect(r.trace.reached).toBe('b')
  })

  it('sizes the marker to clear the part it rings', () => {
    /* The first version drew a fixed 0.5u ring, which sits *inside* the
       footprint of anything wider than a unit — so it rendered dutifully
       underneath every service in the diagram and was never once visible. A
       marker hidden by the thing it marks fails no assertion and shows nothing. */
    const r = build()
    r.trace.load(trace(['a', 'b', 'c']))
    r.trace.seek(0.55)

    const marker = r.trace.group.children[1]
    expect(marker.visible).toBe(true)
    const anchor = r.anchorOf('b')!
    expect(anchor.radius).toBeGreaterThan(0)
    expect(marker.scale.x).toBeGreaterThan(anchor.radius)
    /* And it follows the part, rather than sitting at the origin. */
    expect(marker.position.x).toBeCloseTo(anchor.position.x, 3)
  })
})
