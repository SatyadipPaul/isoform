/**
 * Focus, as the reconciler applies it.
 *
 * Runs headless. `Reconciler` takes a `THREE.Scene` and never touches the
 * renderer, so everything below is real reconciliation against a real scene
 * graph — the same code path the editor and `renderDocument` both drive.
 *
 * The failures worth guarding are all of one kind: **emphasis that does not come
 * back off, or does not reach far enough**. The tint path this replaced had the
 * first bug — `if (!n.tint) return` meant clearing a tint left the substituted
 * materials in place forever. The first render of focus had the second: nodes
 * dimmed correctly while their connectors and nameplates stayed at full
 * brightness, so the loudest thing left in the frame was a run between two parts
 * the reader had just been told to ignore.
 */

import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { Reconciler } from './reconciler.js'
import { palette } from '../foundry/materials.js'
import { clearAppearanceCache } from '../foundry/appearance.js'
import { emptyDoc, type Doc, type DocNode } from '../doc/schema.js'

beforeEach(() => clearAppearanceCache())

/**
 * Two disjoint pairs: a→b and c→d.
 *
 * Disjoint on purpose. It is the only shape that separates the three cases a
 * connector can be in — both ends focused, neither end focused, and exactly one
 * — which is the whole of the rule being tested.
 */
function chainDoc(): Doc {
  const doc = emptyDoc()
  const ids = ['a', 'b', 'c', 'd']
  doc.nodes = ids.map(
    (id, i): DocNode => ({
      id,
      type: 'service',
      label: id.toUpperCase(),
      pos: [i * 4, 0],
      rot: 0,
    }),
  )
  doc.edges = [
    { id: 'ab', from: { node: 'a' }, to: { node: 'b' }, kind: 'sync', route: 'auto' },
    { id: 'cd', from: { node: 'c' }, to: { node: 'd' }, kind: 'sync', route: 'auto' },
  ]
  return doc
}

function build(doc: Doc): { scene: THREE.Scene; r: Reconciler } {
  const scene = new THREE.Scene()
  const r = new Reconciler(scene, { anchorIdle: palette('link').lit('lit', 0.9) })
  r.sync(doc)
  /* Everything articulated: the merged build's colours come from the instance
     batch, which draws from its own material map. Holding the whole document at
     full detail keeps this test looking at one substitution path. */
  r.updateDetail({ fullBelow: 999 })
  return { scene, r }
}

/**
 * Is this an appearance clone, and is it the dimmed kind?
 *
 * `appearanceMaterials` names a clone `<shipped name>::<appearanceKey>`, and the
 * key ends in `d` when dim is set — so the name is a faithful record of what was
 * applied, and asserting on it needs no colour arithmetic.
 */
const isDim = (m: THREE.Material): boolean => m.name.includes('::') && m.name.endsWith('|d')

function materialsIn(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = []
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (!m) return
    for (const x of ([] as THREE.Material[]).concat(m)) out.push(x)
  })
  return out
}

/** A node's transform carrier, found the way anything walking the scene would. */
function carrierOf(r: Reconciler, id: string): THREE.Object3D {
  const hit = r.nodeLayer.children.find((c) => c.userData.nodeId === id && c.type === 'Group')
  expect(hit, `no carrier for node ${id}`).toBeDefined()
  return hit!
}

const nodeIsDim = (r: Reconciler, id: string): boolean =>
  materialsIn(carrierOf(r, id)).some(isDim)

/** Connectors live in their own layer; each built group carries its edge id. */
function edgeIsDim(r: Reconciler, id: string): boolean {
  const g = r.edgeLayer.children.find((c) => c.userData.edgeId === id)
  expect(g, `no connector for edge ${id}`).toBeDefined()
  return materialsIn(g!).some(isDim)
}

/** How many nameplates are currently pale. Text is the one channel labels dim on. */
function dimLabelCount(r: Reconciler): number {
  let n = 0
  for (const m of materialsIn(r.labelLayer)) {
    const basic = m as THREE.MeshBasicMaterial
    if (basic.isMeshBasicMaterial && basic.map && basic.opacity < 0.9) n++
  }
  return n
}

describe('setFocus', () => {
  it('dims what is outside the focus and leaves what is inside alone', () => {
    const { r } = build(chainDoc())
    r.setFocus(['a', 'b'])

    expect(nodeIsDim(r, 'a')).toBe(false)
    expect(nodeIsDim(r, 'b')).toBe(false)
    expect(nodeIsDim(r, 'c')).toBe(true)
    expect(nodeIsDim(r, 'd')).toBe(true)
  })

  it('puts every material back when focus is cleared', () => {
    const { scene, r } = build(chainDoc())
    const before = materialsIn(scene).map((m) => m.name)

    r.setFocus(['a'])
    expect(materialsIn(scene).some(isDim)).toBe(true)

    r.setFocus(null)
    /* The bug this replaces: the old tint path substituted on the way in and had
       no way back, so a cleared tint stayed painted. Emphasis toggles on every
       selection change, so one-way substitution is not survivable here. */
    expect(materialsIn(scene).map((m) => m.name)).toEqual(before)
  })

  it('treats an empty focus as no focus rather than dimming everything', () => {
    const { r } = build(chainDoc())
    r.setFocus([])
    expect(nodeIsDim(r, 'a')).toBe(false)
    expect(nodeIsDim(r, 'd')).toBe(false)
    expect(r.focused).toBeNull()
  })

  it('dims a connector only when both of its endpoints are dimmed', () => {
    const { r } = build(chainDoc())
    /* 'b' is focused, so a→b is part of what the focus is saying — half of what
       a part does is who it talks to. c→d touches nothing focused. */
    r.setFocus(['b'])

    expect(edgeIsDim(r, 'ab')).toBe(false)
    expect(edgeIsDim(r, 'cd')).toBe(true)
  })

  it('dims the nameplates of the parts it dims', () => {
    const { r } = build(chainDoc())
    expect(dimLabelCount(r)).toBe(0)

    r.setFocus(['a', 'b'])
    expect(dimLabelCount(r)).toBe(2)

    r.setFocus(null)
    expect(dimLabelCount(r)).toBe(0)
  })

  it('keeps a relabelled part dimmed', () => {
    /* A fresh nameplate arrives undimmed, and retyping a label neither moves the
       node nor changes its edges — so nothing else in that sync would notice.
       The renamed part came back as the one bright label in a dimmed diagram. */
    const doc = chainDoc()
    const { r } = build(doc)
    r.setFocus(['a'])
    expect(dimLabelCount(r)).toBe(3)

    const next: Doc = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'd' ? { ...n, label: 'renamed' } : n)) }
    r.sync(next)
    expect(dimLabelCount(r)).toBe(3)
  })

  it('composes with a tint, and leaves the tint standing when focus clears', () => {
    const doc = chainDoc()
    doc.nodes[2].tint = '#ff0000'
    const { r } = build(doc)

    const tintedOnly = materialsIn(carrierOf(r, 'c')).filter((m) => m.name.includes('::'))
    expect(tintedOnly.length).toBeGreaterThan(0)
    expect(tintedOnly.some(isDim)).toBe(false)

    r.setFocus(['a'])
    expect(nodeIsDim(r, 'c')).toBe(true)

    r.setFocus(null)
    /* Dim came off; the tint underneath it did not. Substituting from the
       baseline rather than from whatever is currently assigned is what makes the
       two channels independent. */
    expect(nodeIsDim(r, 'c')).toBe(false)
    expect(materialsIn(carrierOf(r, 'c')).some((m) => m.name.includes('::'))).toBe(true)
  })

  it('dims a node added while focus is already active', () => {
    const doc = chainDoc()
    const { r } = build(doc)
    r.setFocus(['a'])

    const next: Doc = {
      ...doc,
      nodes: [...doc.nodes, { id: 'e', type: 'cache', label: 'E', pos: [20, 0], rot: 0 }],
    }
    r.sync(next)
    r.updateDetail({ fullBelow: 999 })
    expect(nodeIsDim(r, 'e')).toBe(true)
  })
})

describe('node state', () => {
  it('paints a state without any focus being involved', () => {
    const doc = chainDoc()
    doc.nodes[1].state = 'down'
    const { r } = build(doc)

    /* `<shipped name>::<appearanceKey>`, and the key is `|down|` — tint empty,
       state in the middle, dim empty. */
    const painted = materialsIn(carrierOf(r, 'b')).filter((m) => m.name.includes('::|down|'))
    expect(painted.length).toBeGreaterThan(0)
    /* `down` is the one state that takes the lights out, and the assertion is
       worth making here rather than only in the unit test: it is the property a
       reader checks first and the one a careless glow multiplier would break. */
    for (const m of painted) {
      const std = m as THREE.MeshStandardMaterial
      if (std.userData.finish === 'lit') expect(std.emissiveIntensity).toBe(0)
    }
  })

  it('leaves healthy looking exactly like unset', () => {
    const plain = build(chainDoc())
    const doc = chainDoc()
    for (const n of doc.nodes) n.state = 'healthy'
    const marked = build(doc)

    expect(materialsIn(marked.scene).map((m) => m.name)).toEqual(
      materialsIn(plain.scene).map((m) => m.name),
    )
  })
})

/**
 * Tags are lifted above the model by turning depth testing off, and the material
 * they turn it off on is shared.
 *
 * The palette hands the same cached material to a nameplate and to any part of
 * the same category, so the lift is applied to a clone. That clone has to differ
 * from its source by *name* as well as by flag, because `appearanceMaterials`
 * caches derived materials under `<source name>::<key>`: with a shared name, the
 * dimmed variant built for a plate is the same cache entry as the dimmed variant
 * for a part, and whichever is built first is handed to both. A part served the
 * plate's twin draws its far faces over its near ones.
 *
 * A plate on its own cannot show this — there is no part to collide with — so it
 * has to be checked here, against a real document with focus applied.
 */
describe('nameplates lifted over the model', () => {
  const walk = (scene: THREE.Scene, r: Reconciler) => {
    const parts: THREE.Material[] = []
    const labels: THREE.Material[] = []
    const inLabels = (o: THREE.Object3D): boolean => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === r.labelLayer) return true
      return false
    }
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.material) return
      const into = inLabels(o) ? labels : parts
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) into.push(mat)
    })
    return { parts, labels }
  }

  it('never leaves a part depth-free, focused or not', () => {
    const { scene, r } = build(chainDoc())
    r.setLabelsVisible(true)

    for (const focus of [null, ['a'], ['a', 'b'], null] as (string[] | null)[]) {
      r.setFocus(focus)
      const { parts, labels } = walk(scene, r)
      expect(parts.length).toBeGreaterThan(0)
      expect(labels.length).toBeGreaterThan(0)
      expect(parts.filter((m) => m.depthTest === false)).toEqual([])
      expect(labels.filter((m) => m.depthTest !== false)).toEqual([])
    }
  })
})
