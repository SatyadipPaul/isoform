/**
 * Batcher slot management.
 *
 * The instance buffer is the one place in the renderer where a bookkeeping slip
 * is invisible in code and glaring on screen: a stale slot draws a part at the
 * position of one that was deleted, and a wrong `count` either drops the last
 * node or draws a ghost at the origin. Both survive a typecheck and neither
 * shows up in a scene small enough to eyeball.
 */

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { NodeBatcher, batchKey } from './batch.js'
import type { Appearance } from '../foundry/appearance.js'

/** Shipped colours: no tint, no state, not dimmed. */
const PLAIN: Appearance = {}

const at = (x: number, z: number): THREE.Matrix4 =>
  new THREE.Matrix4().makeTranslation(x, 0, z)

/** Every instance transform a batch layer currently holds, per mesh. */
function slots(layer: THREE.Object3D): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  for (const child of layer.children) {
    const m = child as THREE.InstancedMesh
    if (!m.isInstancedMesh) continue
    const row: Array<[number, number]> = []
    const tmp = new THREE.Matrix4()
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, tmp)
      const p = new THREE.Vector3().setFromMatrixPosition(tmp)
      row.push([+p.x.toFixed(3), +p.z.toFixed(3)])
    }
    out.push(row)
  }
  return out
}

function counts(layer: THREE.Object3D): number[] {
  return layer.children
    .filter((c) => (c as THREE.InstancedMesh).isInstancedMesh)
    .map((c) => (c as THREE.InstancedMesh).count)
}

describe('batchKey', () => {
  it('separates anything that changes geometry or materials', () => {
    expect(batchKey('service', PLAIN, true)).not.toBe(batchKey('service', PLAIN, false))
    expect(batchKey('service', { tint: '#ff0000' }, true)).not.toBe(batchKey('service', PLAIN, true))
    expect(batchKey('service', PLAIN, true)).not.toBe(batchKey('database', PLAIN, true))
  })

  it('is stable for the same appearance', () => {
    expect(batchKey('service', { tint: '#abc123' }, true)).toBe(batchKey('service', { tint: '#abc123' }, true))
  })

  it('separates state and dim, which change materials as surely as a tint does', () => {
    expect(batchKey('service', { state: 'down' }, true)).not.toBe(batchKey('service', PLAIN, true))
    expect(batchKey('service', { dim: true }, true)).not.toBe(batchKey('service', PLAIN, true))
    expect(batchKey('service', { state: 'down' }, true)).not.toBe(
      batchKey('service', { state: 'degraded' }, true),
    )
    /* The three axes compose, so a dimmed-and-degraded node cannot share a batch
       with one that is merely degraded. */
    expect(batchKey('service', { state: 'degraded', dim: true }, true)).not.toBe(
      batchKey('service', { state: 'degraded' }, true),
    )
  })

  it('treats healthy and unset as the same appearance', () => {
    /* They differ as a claim about the system and not at all as a picture. A
       document that marks every node healthy must not double the batch count. */
    expect(batchKey('service', { state: 'healthy' }, true)).toBe(batchKey('service', PLAIN, true))
  })
})

describe('NodeBatcher', () => {
  it('draws nothing before anything is added', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    expect(b.drawCalls).toBe(0)
    expect(b.batchCount).toBe(0)
  })

  it('collapses many nodes of one type into one set of instanced meshes', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    for (let i = 0; i < 40; i++) b.set('n' + i, 'service', PLAIN, true, at(i, 0))

    expect(b.batchCount).toBe(1)
    /* The whole point: draw calls are per *piece*, not per node. */
    expect(b.drawCalls).toBeLessThan(20)
    for (const c of counts(layer)) expect(c).toBe(40)
  })

  it('grows past its initial capacity without losing or duplicating instances', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    /* 70 crosses the 16-instance initial capacity three times over. */
    for (let i = 0; i < 70; i++) b.set('n' + i, 'service', PLAIN, true, at(i, 0))

    for (const row of slots(layer)) {
      expect(row).toHaveLength(70)
      const xs = row.map(([x]) => x).sort((p, q) => p - q)
      expect(new Set(xs).size).toBe(70)
      expect(xs[0]).toBe(0)
      expect(xs[69]).toBe(69)
    }
  })

  it('keeps instances dense when one is removed from the middle', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    for (let i = 0; i < 5; i++) b.set('n' + i, 'service', PLAIN, true, at(i, 0))
    b.remove('n1')

    for (const c of counts(layer)) expect(c).toBe(4)
    for (const row of slots(layer)) {
      const xs = row.map(([x]) => x).sort((p, q) => p - q)
      /* n1 gone, everything else present exactly once — the swap-with-last must
         not drop the member it moved or leave the vacated slot readable. */
      expect(xs).toEqual([0, 2, 3, 4])
    }
    expect(b.has('n1')).toBe(false)
    expect(b.has('n4')).toBe(true)
  })

  it('empties cleanly and can refill', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    for (let i = 0; i < 6; i++) b.set('n' + i, 'service', PLAIN, true, at(i, 0))
    for (let i = 0; i < 6; i++) b.remove('n' + i)
    for (const c of counts(layer)) expect(c).toBe(0)
    expect(b.drawCalls).toBe(0)

    b.set('again', 'service', PLAIN, true, at(9, 9))
    for (const c of counts(layer)) expect(c).toBe(1)
    expect(b.drawCalls).toBeGreaterThan(0)
  })

  it('moves a node between batches when its appearance changes', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    b.set('a', 'service', PLAIN, true, at(0, 0))
    b.set('b', 'service', PLAIN, true, at(1, 0))
    expect(b.batchCount).toBe(1)

    /* Retint: 'a' must leave the untinted batch, not appear in both. */
    b.set('a', 'service', { tint: '#ff8800' }, true, at(0, 0))
    expect(b.batchCount).toBe(2)

    const live = counts(layer).filter((c) => c > 0)
    expect(live.every((c) => c === 1)).toBe(true)
  })

  it('rewrites only the moved instance', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    for (let i = 0; i < 4; i++) b.set('n' + i, 'service', PLAIN, true, at(i, 0))
    b.move('n2', at(99, 7))

    for (const row of slots(layer)) {
      const moved = row.filter(([x]) => x === 99)
      expect(moved).toHaveLength(1)
      expect(moved[0][1]).toBe(7)
      /* The other three keep their original places. */
      expect(row.filter(([x]) => x !== 99).map(([x]) => x).sort((p, q) => p - q)).toEqual([0, 1, 3])
    }
  })

  it('ignores moves and removals for nodes it never held', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    expect(() => b.move('ghost', at(1, 1))).not.toThrow()
    expect(() => b.remove('ghost')).not.toThrow()
    expect(b.drawCalls).toBe(0)
  })

  it('separates part types into their own batches', () => {
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    b.set('a', 'service', PLAIN, true, at(0, 0))
    b.set('b', 'database', PLAIN, true, at(2, 0))
    b.set('c', 'monitor', PLAIN, true, at(4, 0))
    expect(b.batchCount).toBe(3)
  })

  it('offsets loose pieces by their placement inside the part', () => {
    /* A transparent decal sits somewhere on the part, not at its origin. If the
       batcher wrote the node matrix straight into that slice, every decal in the
       diagram would collapse onto its part's base. */
    const layer = new THREE.Group()
    const b = new NodeBatcher(layer)
    b.set('a', 'cache', PLAIN, true, at(10, 0))

    const positions = slots(layer).map((row) => row[0])
    expect(positions.length).toBeGreaterThan(0)
    for (const [x] of positions) expect(x).toBeCloseTo(10, 3)
  })
})
