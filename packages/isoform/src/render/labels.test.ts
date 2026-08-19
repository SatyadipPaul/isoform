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
  LABEL_RANK,
  declutter,
  makeNameplate,
  orientNameplate,
  setNameplateDimmed,
  type LabelRank,
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

/** The plates a pass left on screen. Hidden ones are not part of the picture. */
function shown(ts: Array<{ plate: Nameplate }>): Nameplate[] {
  return ts.filter((t) => t.plate.group.visible).map((t) => t.plate)
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
    /* Among the tags still drawn. Crowding past what a short leader can solve
       is answered by hiding, not by fanning the set across the frame, so a
       hidden tag is a resolved tag and counting it asserts the old rule. */
    expect(worstOverlap(shown(ts), cam)).toBeLessThan(0.02)
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
    /* Among the tags still drawn. Crowding past what a short leader can solve
       is answered by hiding, not by fanning the set across the frame, so a
       hidden tag is a resolved tag and counting it asserts the old rule. */
    expect(worstOverlap(shown(ts), cam)).toBeLessThan(0.02)
  })
})

describe('tags stay readable as the camera climbs', () => {
  /** Camera at `el` above the horizon, looking at the origin from distance 14. */
  function cameraAt(el: number): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(32, 2, 0.1, 500)
    const d = 14
    cam.position.set(Math.sin(0.6) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(0.6) * Math.cos(el) * d)
    cam.lookAt(0, 1, 0)
    cam.updateMatrixWorld(true)
    return cam
  }

  /**
   * How square-on the tag is to the camera, 1 being face-on.
   *
   * This is the quantity the reader experiences as letter shape: an upright
   * plate viewed from `el` above projects to `cos(el)` of its height, and text
   * squashed to 60% of its height does not read as a plate seen from above — it
   * reads as text that has been stretched sideways.
   */
  function facing(el: number): number {
    const cam = cameraAt(el)
    const n = makeNameplate('replication controller', 'sub', 'compute')
    orientNameplate(n, new THREE.Vector3(0, 1, 0), cam)
    n.group.updateWorldMatrix(true, true)
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(n.group.quaternion).normalize()
    const toCam = cam.position.clone().sub(n.group.position).normalize()
    return normal.dot(toCam)
  }

  it('never squashes a tag below the readable floor, however high the camera', () => {
    /* Upright-only billboarding falls to 0.36 at 69° and 0.12 at 83°. */
    for (const el of [0, 0.2, 0.42, 0.6, 0.8, 0.95, 1.2, 1.45]) {
      expect(facing(el), `elevation ${el}`).toBeGreaterThan(0.85)
    }
  })

  it('leaves the tag perfectly upright while the squash is imperceptible', () => {
    /* The tag is a plate standing in the scene, not a sticker pasted over it.
       Tilting it when nothing is wrong would throw that away for nothing. */
    for (const el of [0, 0.1, 0.2, 0.3, 0.42]) {
      const cam = cameraAt(el)
      const n = makeNameplate('orders', undefined, 'compute')
      orientNameplate(n, new THREE.Vector3(0, 1, 0), cam)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(n.group.quaternion)
      expect(up.y, `elevation ${el} should not tip`).toBeCloseTo(1, 6)
    }
  })

  it('keeps the stem attached to the underside once the tag tips', () => {
    /* The underside travels with the tilt. Dropping straight down in world Y
       leaves a visible gap between the leader and the plate it points to. */
    const cam = cameraAt(1.2)
    const n = makeNameplate('orders', undefined, 'compute')
    const anchor = new THREE.Vector3(0, 1, 0)
    orientNameplate(n, anchor, cam)

    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(n.group.quaternion)
    const underside = n.group.position.clone().addScaledVector(down, n.height / 2)
    /* The stem spans anchor → underside, so its far end must land there. */
    const farEnd = n.stem.position.clone().addScaledVector(
      new THREE.Vector3(0, 1, 0).applyQuaternion(n.stem.quaternion),
      n.stem.scale.y / 2,
    )
    expect(farEnd.distanceTo(underside)).toBeLessThan(1e-6)
  })
})

describe('a leader stays a leader', () => {
  /**
   * Camera close to the horizon, which is where this goes wrong.
   *
   * Tags share a chain only if they share a band of screen height, and a low
   * camera flattens the whole diagram into one band — so every tag joins one
   * chain, the required gaps accumulate across the entire set, and the solve
   * spreads them over a screen distance far wider than the frame.
   */
  function grazing(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(32, 3.3, 0.1, 500)
    cam.position.set(2, 1.4, 26)
    cam.lookAt(0, 1, 0)
    cam.updateMatrixWorld(true)
    return cam
  }

  it('never slides a tag further than a couple of its own widths', () => {
    /* Unbounded, a 26-part diagram 39.6 units across measured a median slide of
       26.7 units and a worst of 49.5 — further than the whole system is wide.
       What that draws is not a displaced label but a hairline stem stretched
       across the picture. */
    const cam = grazing()
    const ts = Array.from({ length: 40 }, (_, i) =>
      tag(`detection log, mirrored past what the device keeps ${i}`, new THREE.Vector3(i * 0.7 - 14, 1, 0), cam),
    )
    const home = ts.map((t) => t.plate.group.position.clone())

    declutter(ts, cam)

    ts.forEach((t, i) => {
      const slid = home[i].distanceTo(t.plate.group.position)
      /* 3 widths each way, plus slack for the plate's own thickness. */
      expect(slid, `tag ${i}`).toBeLessThan(t.plate.width * 3.5)
    })
  })

  it('still separates a crowd that fits within reach', () => {
    /* The bound must not turn the pass off for the diagrams it was working on. */
    const cam = viewer()
    const ts = [-0.5, -0.2, 0.1, 0.4].map((x, i) =>
      tag(`svc-${i}`, new THREE.Vector3(x, 1, 0), cam),
    )
    expect(worstOverlap(ts.map((t) => t.plate), cam)).toBeGreaterThan(0.2)
    declutter(ts, cam)
    /* Among the tags still drawn. Crowding past what a short leader can solve
       is answered by hiding, not by fanning the set across the frame, so a
       hidden tag is a resolved tag and counting it asserts the old rule. */
    expect(worstOverlap(shown(ts), cam)).toBeLessThan(0.02)
  })
})

describe('tags thin out instead of piling up', () => {
  function rankedTag(title: string, at: THREE.Vector3, cam: THREE.Camera, rank: LabelRank) {
    const plate = makeNameplate(title, undefined, 'compute')
    orientNameplate(plate, at, cam)
    return { plate, top: at, rank }
  }

  it('keeps every tag when there is room for every tag', () => {
    /* The pass must cost nothing on the diagrams it was already solving. */
    const cam = viewer()
    const ts = [-6, -2, 2, 6].map((x, i) => tag(`svc-${i}`, new THREE.Vector3(x, 1, 0), cam))
    declutter(ts, cam)
    expect(ts.every((t) => t.plate.group.visible)).toBe(true)
  })

  it('drops what will not fit rather than stacking it', () => {
    /* Sliding can only do so much. Once a tag is at the end of its leash and
       still buried, the choice is to overlap or to disappear — and a mat of
       stacked plates is not readable at any of them. */
    const cam = viewer()
    const ts = Array.from({ length: 24 }, (_, i) =>
      tag(`replication-controller-${i}`, new THREE.Vector3(i * 0.12 - 1.4, 1, 0), cam),
    )
    declutter(ts, cam)

    const shown = ts.filter((t) => t.plate.group.visible)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(ts.length)
    /* Whatever survived has to be legible. */
    expect(worstOverlap(shown.map((t) => t.plate), cam)).toBeLessThan(0.25)
  })

  it('hides a tag’s stem along with the tag', () => {
    const cam = viewer()
    const ts = Array.from({ length: 24 }, (_, i) =>
      tag(`replication-controller-${i}`, new THREE.Vector3(i * 0.12 - 1.4, 1, 0), cam),
    )
    declutter(ts, cam)
    for (const t of ts) {
      if (!t.plate.group.visible) expect(t.plate.stem.visible).toBe(false)
    }
  })

  it('spends connector tags before boundary tags', () => {
    /* A boundary names a whole tier; a connector tag names one hop. Priority
       only arbitrates when sliding cannot resolve the crowd — two tags alone
       simply move apart, so the contest needs a genuine crush. */
    const cam = viewer()
    const crowd = Array.from({ length: 14 }, (_, i) =>
      rankedTag(`loopback HTTP ${i}`, new THREE.Vector3(i * 0.1 - 0.7, 1, 0), cam, LABEL_RANK.edge),
    )
    const tier = rankedTag('Service tier', new THREE.Vector3(0, 1, 0), cam, LABEL_RANK.group)

    declutter([...crowd, tier], cam)

    expect(tier.plate.group.visible, 'the tier tag must survive').toBe(true)
    expect(crowd.some((t) => !t.plate.group.visible), 'some hop tags must go').toBe(true)
  })

  it('shows a hidden tag again once the camera gives it room', () => {
    /* Nothing is deleted. The decision is remade every frame, so a tag dropped
       at one angle comes back at another. */
    const tight = viewer()
    const ts = Array.from({ length: 24 }, (_, i) =>
      tag(`replication-controller-${i}`, new THREE.Vector3(i * 0.12 - 1.4, 1, 0), tight),
    )
    declutter(ts, tight)
    expect(ts.some((t) => !t.plate.group.visible)).toBe(true)

    /* Same tags, given room — but still inside the frame. Spread far enough
       to leave it they would be dropped for being off-screen, a different
       rule, and this would pass or fail for the wrong reason. */
    const roomy = new THREE.PerspectiveCamera(32, 2, 0.1, 500)
    roomy.position.set(0, 6, 120)
    roomy.lookAt(0, 1, 0)
    roomy.updateMatrixWorld(true)
    ts.forEach((t, i) => {
      t.top.set(i * 3 - 34, 1, 0)
      orientNameplate(t.plate, t.top, roomy)
    })
    declutter(ts, roomy)
    expect(ts.every((t) => t.plate.group.visible)).toBe(true)
  })
})
