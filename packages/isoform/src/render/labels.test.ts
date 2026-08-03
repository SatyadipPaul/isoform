/**
 * Declutter's failure mode is silence.
 *
 * It has no output to check and no error to throw: if it decides nothing
 * overlaps, it returns having moved nothing, which is also exactly what it does
 * when it is working and the tags are already clear. A screen-space rewrite once
 * aliased two projection probes onto one scratch vector, the measured half-width
 * came out at ~0, every pair passed the separation test, and the pass became a
 * no-op that every other test in the suite still agreed with.
 *
 * So these tests assert the two halves that silence hides: that tags which do
 * overlap get pushed apart, and that the screen measurements the decision rests
 * on are not degenerate.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { palette } from '../foundry/materials.js'
import {
  declutter,
  makeNameplate,
  orientNameplate,
  setNameplateDimmed,
  type Nameplate,
} from './labels.js'

/** A camera looking down the +Z axis at the origin, so `right` is world +X. */
function viewer(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(32, 2, 0.1, 500)
  cam.position.set(0, 2, 12)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

/** Place a tag over a point and hand back what `declutter` expects. */
function tag(title: string, at: THREE.Vector3, cam: THREE.Camera) {
  const plate = makeNameplate(title, undefined, 'compute')
  orientNameplate(plate, at, cam)
  return { plate, top: at }
}

/**
 * Worst overlap between any two plates on screen, as a fraction of the smaller.
 *
 * Measured from the rendered geometry rather than from declutter's own numbers,
 * so a test built on this cannot be fooled by the same mistake twice: if the
 * pass mismeasures its inputs and concludes everything is clear, this still sees
 * two rectangles on top of each other.
 */
function worstOverlap(plates: Nameplate[], cam: THREE.Camera): number {
  const rects = plates.map((p) => {
    const box = new THREE.Box3().setFromObject(p.group)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const v = new THREE.Vector3(x, y, z).project(cam)
          x0 = Math.min(x0, v.x)
          x1 = Math.max(x1, v.x)
          y0 = Math.min(y0, v.y)
          y1 = Math.max(y1, v.y)
        }
    return { x0, y0, x1, y1 }
  })
  const area = (r: (typeof rects)[number]): number => (r.x1 - r.x0) * (r.y1 - r.y0)
  let worst = 0
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const w = Math.min(rects[i].x1, rects[j].x1) - Math.max(rects[i].x0, rects[j].x0)
      const h = Math.min(rects[i].y1, rects[j].y1) - Math.max(rects[i].y0, rects[j].y0)
      if (w > 0 && h > 0)
        worst = Math.max(worst, (w * h) / Math.min(area(rects[i]), area(rects[j])))
    }
  return worst
}

describe('tags draw over the model', () => {
  const depthFlags = (n: Nameplate): boolean[] => {
    const out: boolean[] = []
    for (const root of [n.group, n.stem as THREE.Object3D]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || !m.material) return
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          out.push(mat.depthTest)
        }
      })
    }
    return out
  }

  it('turns depth testing off for the whole tag', () => {
    const n = makeNameplate('orders', 'service', 'compute')
    const flags = depthFlags(n)
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((f) => f === false)).toBe(true)
  })

  it('does not disturb the shared material the parts are using', () => {
    /* The palette cache hands the same material to a plate and to any part of
       the same category. Lifting the plate by mutating what the cache returned
       would turn depth testing off on those parts, and they would render inside
       out — visible as a part whose far faces draw over its near ones. */
    const shared = palette('compute').anodised('trim')
    expect(shared.depthTest).toBe(true)
    makeNameplate('orders', undefined, 'compute')
    expect(shared.depthTest).toBe(true)
  })

  it('keeps the tag lifted after it is dimmed', () => {
    /* Dimming swaps in materials derived from the plate's own, via a cache keyed
       on material *name*. If the lifted twin kept the original's name it would
       collide there, and dimming would hand the plate a depth-tested material —
       or worse, hand a dimmed part the depth-free one. */
    const n = makeNameplate('orders', 'service', 'compute')
    setNameplateDimmed(n, true)
    expect(depthFlags(n).every((f) => f === false)).toBe(true)

    const shared = palette('compute').anodised('trim')
    expect(shared.depthTest).toBe(true)
  })

  it('paints the text after the plate it sits on', () => {
    /* With depth testing off, the last thing drawn wins, so the backing board
       and its text must not share a render order. */
    const n = makeNameplate('orders', undefined, 'compute')
    const meshes = n.group.children.filter((c) => (c as THREE.Mesh).isMesh)
    expect(meshes.length).toBeGreaterThanOrEqual(2)
    const [board, text] = meshes
    expect(text.renderOrder).toBeGreaterThan(board.renderOrder)
  })
})

describe('declutter', () => {
  it('separates tags stacked on the same spot', () => {
    const cam = viewer()
    /* Same world point, so both tags land on top of each other on screen. */
    const a = tag('gateway', new THREE.Vector3(0, 1, 0), cam)
    const b = tag('scheduler', new THREE.Vector3(0, 1, 0), cam)

    const before = Math.abs(a.plate.group.position.x - b.plate.group.position.x)
    declutter([a, b], cam)
    const after = Math.abs(a.plate.group.position.x - b.plate.group.position.x)

    expect(before).toBeLessThan(1e-6)
    expect(after).toBeGreaterThan(0.5)
  })

  it('leaves tags that are already clear where they are', () => {
    const cam = viewer()
    const a = tag('gateway', new THREE.Vector3(-6, 1, 0), cam)
    const b = tag('scheduler', new THREE.Vector3(6, 1, 0), cam)
    const ax = a.plate.group.position.x
    const bx = b.plate.group.position.x

    declutter([a, b], cam)

    expect(a.plate.group.position.x).toBeCloseTo(ax, 6)
    expect(b.plate.group.position.x).toBeCloseTo(bx, 6)
  })

  it('clears a crowd, including pairs that never neighbour each other in x', () => {
    const cam = viewer()
    /* Six tags inside two world units. Resolving any one pair drives a tag into
       another it was not compared against, so this only comes out clean if the
       pass revisits every pair. */
    const ts = [-1, -0.6, -0.2, 0.2, 0.6, 1].map((x, i) =>
      tag(`replication-controller-${i}`, new THREE.Vector3(x, 1, 0), cam),
    )

    expect(worstOverlap(ts.map((t) => t.plate), cam)).toBeGreaterThan(0.2)
    declutter(ts, cam)
    expect(worstOverlap(ts.map((t) => t.plate), cam)).toBeLessThan(0.02)
  })

  it('clears tags spread across depth, where one world unit is not one screen unit', () => {
    /* Near and far tags need different world pushes for the same screen gap. A
       pass that works in world units alone leaves the far ones overlapping. */
    const cam = viewer()
    const ts = [0, 1, 2, 3, 4].map((i) =>
      tag(`ingest-worker-${i}`, new THREE.Vector3(i * 0.3 - 0.6, 1, -i * 2), cam),
    )

    expect(worstOverlap(ts.map((t) => t.plate), cam)).toBeGreaterThan(0.2)
    declutter(ts, cam)
    expect(worstOverlap(ts.map((t) => t.plate), cam)).toBeLessThan(0.02)
  })
})
