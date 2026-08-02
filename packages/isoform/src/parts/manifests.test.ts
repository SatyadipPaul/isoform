/**
 * Manifest invariants.
 *
 * `manifests.ts` documents a contract between the declared metadata and the
 * geometry a builder actually produces, and until now nothing checked it. The
 * header even claims this file exists. It did not, which is survivable at
 * fourteen hand-tuned parts and stops being survivable the moment the catalog
 * grows — a footprint that quietly under-declares makes parts overlap on
 * placement and makes the router drive connectors through solid bodies, and
 * neither failure points back at the manifest.
 *
 * These run against every part in the registry, so a new one is covered the
 * moment it is registered.
 */

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MANIFESTS, PART_IDS } from './manifests.js'
import { build, measure, measureBounds } from './registry.js'
import { PORT_IDS, type PartId } from './types.js'
import { stripStubs } from '../foundry/geometry.js'
import { CATEGORIES } from '../foundry/materials.js'

/**
 * How far a measurement may fall short of its nominal size.
 *
 * Every box in the catalog is an ExtrudeGeometry with a bevel, so a part
 * authored as 1.84 wide measures 1.8397. The manifest records the design
 * intent; the geometry rounds a hair off it. Two centimetres of slack absorbs
 * that and nothing else — a footprint that is actually wrong is wrong by a
 * tenth of a unit or more.
 */
const FILLET_SLACK = 0.02

/**
 * Extent of a part's *body*, with decorative pipework removed.
 *
 * This is what `footprint` means. The gateway's three input tubes reach out to
 * x = −1.9 and its exit arrow past x = 1.85, so its full extent is 4.08u for a
 * part whose body is 2u — measuring against that would make every stub-carrying
 * part look like it wildly under-declares. `stripStubs` already encodes exactly
 * which geometry is decorative, so the test reuses that judgement rather than
 * inventing a second one.
 */
function bodyBounds(id: PartId): THREE.Box3 {
  const part = build(id)
  stripStubs(part.group)
  return measureBounds(part.group)
}

describe('part manifests', () => {
  it('has an entry for every registered part, keyed by its own id', () => {
    for (const id of PART_IDS) {
      expect(MANIFESTS[id]).toBeDefined()
      expect(MANIFESTS[id].id).toBe(id)
    }
  })

  it('gives every part a unique part number', () => {
    const pns = PART_IDS.map((id) => MANIFESTS[id].pn)
    expect(new Set(pns).size).toBe(pns.length)
  })

  it('names a real category', () => {
    for (const id of PART_IDS) {
      expect(CATEGORIES).toContain(MANIFESTS[id].cat)
    }
  })

  it('declares exactly the four compass anchors, all at portY', () => {
    for (const id of PART_IDS) {
      const m = MANIFESTS[id]
      expect(m.ports.map((p) => p.id).sort()).toEqual([...PORT_IDS].sort())
      for (const p of m.ports) expect(p.y).toBe(m.portY)
    }
  })

  it('puts every connector anchor within the part it belongs to', () => {
    for (const id of PART_IDS) {
      const m = MANIFESTS[id]
      /* A port below the floor or above the roofline produces connectors that
         visibly miss the part they claim to attach to. */
      expect(m.portY, id).toBeGreaterThan(0)
      expect(m.portY, id).toBeLessThanOrEqual(m.height)
    }
  })

  /**
   * FOOTPRINT MUST NOT EXCEED THE GEOMETRY.
   *
   * The reverse — declaring less than the part measures — is legal and
   * deliberate: several parts carry decorative stubs that reach well past the
   * body, and snapping wants the body. Over-declaring is the error, because it
   * reserves ground the part does not occupy and pushes neighbours away for no
   * reason.
   */
  it('never declares a footprint wider than the part body', () => {
    for (const id of PART_IDS) {
      if (id === 'boundary') continue // sized by its members, not by geometry
      const m = MANIFESTS[id]
      const b = bodyBounds(id)
      expect(m.footprint.w, `${id} width`).toBeLessThanOrEqual(b.max.x - b.min.x + FILLET_SLACK)
      expect(m.footprint.d, `${id} depth`).toBeLessThanOrEqual(b.max.z - b.min.z + FILLET_SLACK)
    }
  })

  it('never declares a height taller than the part body', () => {
    for (const id of PART_IDS) {
      if (id === 'boundary') continue
      expect(MANIFESTS[id].height, id).toBeLessThanOrEqual(bodyBounds(id).max.y + FILLET_SLACK)
    }
  })

  it('declares a footprint close to the body it is meant to describe', () => {
    /* Under-declaring the body is not a design choice the way stub exclusion
       is — it is how a part ends up overlapping its neighbours on placement.
       Three-quarters of the body is the line. */
    for (const id of PART_IDS) {
      if (id === 'boundary') continue
      const m = MANIFESTS[id]
      const b = bodyBounds(id)
      expect(m.footprint.w, `${id} width`).toBeGreaterThan((b.max.x - b.min.x) * 0.75)
      expect(m.footprint.d, `${id} depth`).toBeGreaterThan((b.max.z - b.min.z) * 0.75)
    }
  })

  it('sits every part on the ground plane', () => {
    for (const id of PART_IDS) {
      if (id === 'boundary') continue
      /* Parts are authored to stand on y=0. One floating a unit above its own
         shadow reads as a modelling mistake and breaks the contact shadow. */
      expect(measure(id).min.y, id).toBeLessThan(0.2)
    }
  })
})

describe('part builders', () => {
  it('builds every registered part without throwing', () => {
    for (const id of PART_IDS) {
      expect(() => build(id), id).not.toThrow()
    }
  })

  /**
   * BUILDING A PART MUST NOT CHANGE THE NEXT ONE.
   *
   * The foundry memoises geometry, so what a builder receives is shared with
   * every other user of that size. `monitor` translated a needle's geometry in
   * place to move its pivot — which mutated the cache, twice per part, so the
   * pivot drifted 0.13 further out with every monitor built and eventually stuck
   * the needles through the bezel. Nothing about that is visible at the call
   * site, and a single part in isolation looks perfectly fine.
   */
  it('builds identically however many times it is built', () => {
    for (const id of PART_IDS) {
      const first = signature(build(id).group)
      build(id)
      build(id)
      const fourth = signature(build(id).group)
      expect(fourth, `${id} changed after being built three times`).toBe(first)
    }
  })

  it('declares every object its update function moves', () => {
    /* The merge pass folds anything not listed in `animated` into static
       geometry, which freezes it. A part that animates an undeclared mesh looks
       right in the palette and dies the moment it is not the selected node —
       the exact defect this catches. */
    for (const id of PART_IDS) {
      const part = build(id)
      if (!part.update) continue
      expect(part.animated, `${id} has update() but no animated list`).toBeDefined()
      expect(part.animated!.length, `${id} animated list is empty`).toBeGreaterThan(0)
      for (const o of part.animated!) {
        expect(isDescendant(part.group, o), `${id}: animated object is not in the part`).toBe(true)
      }
    }
  })

  it('frames each part from outside it', () => {
    for (const id of PART_IDS) {
      if (id === 'boundary') continue
      const m = MANIFESTS[id]
      const b = measure(id)
      /* A camera closer than the part is wide renders the inside of it. */
      expect(m.camera.dist, id).toBeGreaterThan(Math.max(b.max.x - b.min.x, b.max.y) * 0.5)
    }
  })
})

/**
 * Positional fingerprint of a built part.
 *
 * World positions of every mesh, quantised. Catches a builder that has mutated
 * shared geometry or shared material state, which shows up as the *next* build
 * coming out different — never as a failure in the build that caused it.
 */
function signature(root: THREE.Object3D): string {
  root.updateMatrixWorld(true)
  const parts: string[] = []
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!g) return
    if (!g.boundingBox) g.computeBoundingBox()
    const b = g.boundingBox
    if (!b) return
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
    parts.push(
      [p.x, p.y, p.z, b.min.x, b.max.x, b.min.y, b.max.y]
        .map((n) => n.toFixed(4))
        .join(','),
    )
  })
  /* Sorted: traversal order is not part of the contract, geometry is. */
  return parts.sort().join('|')
}

function isDescendant(root: { children: unknown[] }, target: unknown): boolean {
  if (root === target) return true
  for (const c of root.children as Array<{ children: unknown[] }>) {
    if (isDescendant(c, target)) return true
  }
  return false
}
