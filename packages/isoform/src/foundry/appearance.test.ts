/**
 * Appearance resolution.
 *
 * Every claim here is about a property the eye checks in half a second and a
 * typecheck never checks at all: that a down node's lights are off, that a
 * dimmed node's neutral hardware dims with it, that two nodes styled alike share
 * one material rather than two that merely match.
 *
 * The one that matters most is composition. Tint, state and dim are three
 * independent channels resolved in a single pass precisely so they cannot
 * overwrite each other, and a regression there looks like "the tint stopped
 * working when I focused something" — plausible enough to be blamed on anything.
 */

import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appearanceKey,
  appearanceMaterials,
  clearAppearanceCache,
  isNeutral,
  NODE_STATES,
  type Appearance,
} from './appearance.js'
import { CATEGORIES, HUE, mat, type IsoMaterial } from './materials.js'

/**
 * Rough perceptual separation between two colours, 0..~1.7.
 *
 * Plain RGB distance, not a CIE metric: the question here is only "would a
 * reader notice", and a threshold calibrated against this crude measure answers
 * it as well as a precise one would while staying readable.
 */
const distance = (a: THREE.Color, b: THREE.Color): number =>
  Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

beforeEach(() => clearAppearanceCache())

/** A part-like set: a tinted body, a tagged emissive, and untagged hardware. */
function sample(): { body: IsoMaterial; lamp: IsoMaterial; screw: IsoMaterial } {
  return {
    body: mat('powder', 0x21c3a6, {}, { cat: 'data', role: 'body' }),
    lamp: mat('lit', 0x74f0da, {}, { cat: 'data', role: 'lit' }),
    /* No category, no role — a steel fastener. `overrideMaterials` skips these
       by design; state and dim must not. */
    screw: mat('steel', 0x9aa3b0),
  }
}

const lightness = (c: THREE.Color): number => {
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return hsl.l
}

const saturation = (c: THREE.Color): number => {
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return hsl.s
}

function resolve(a: Appearance): Map<IsoMaterial, IsoMaterial> {
  const s = sample()
  return appearanceMaterials([s.body, s.lamp, s.screw], 'data', a)
}

describe('appearanceKey', () => {
  it('is empty for shipped colours', () => {
    expect(appearanceKey({})).toBe('')
    expect(isNeutral({})).toBe(true)
  })

  it('folds healthy into unset', () => {
    expect(appearanceKey({ state: 'healthy' })).toBe('')
  })

  it('distinguishes every state from every other', () => {
    const keys = NODE_STATES.map((state) => appearanceKey({ state }))
    /* Every state gets its own key. `healthy` earns one too — the empty string —
       because that is what it shares with an unset state. */
    expect(new Set(keys).size).toBe(NODE_STATES.length)
    expect(keys).toContain('')
  })

  it('keeps the three channels independent', () => {
    expect(appearanceKey({ tint: '#f00' })).not.toBe(appearanceKey({ state: 'down' }))
    expect(appearanceKey({ tint: '#f00', dim: true })).not.toBe(appearanceKey({ tint: '#f00' }))
  })
})

describe('appearanceMaterials', () => {
  it('substitutes nothing when the appearance is neutral', () => {
    expect(resolve({}).size).toBe(0)
    expect(resolve({ state: 'healthy' }).size).toBe(0)
  })

  it('never mutates the shipped material', () => {
    const s = sample()
    const before = s.body.color.getHex()
    appearanceMaterials([s.body], 'data', { state: 'down', dim: true })
    /* The whole cache discipline rests on this: shared materials are immutable,
       and a single in-place write would repaint every part in the diagram. */
    expect(s.body.color.getHex()).toBe(before)
  })

  it('puts the lights out on a node that is down', () => {
    const s = sample()
    const sub = appearanceMaterials([s.lamp], 'data', { state: 'down' })
    expect(sub.get(s.lamp)!.emissiveIntensity).toBe(0)
  })

  it('darkens and drains a node that is down', () => {
    const s = sample()
    const out = appearanceMaterials([s.body], 'data', { state: 'down' }).get(s.body)!
    expect(lightness(out.color)).toBeLessThan(lightness(s.body.color))
    expect(saturation(out.color)).toBeLessThan(saturation(s.body.color) * 0.5)
  })

  it('repaints untagged hardware for state and dim, which a tint leaves alone', () => {
    const s = sample()
    /* A tint is scoped to the part's category and roles — a red database still
       has grey screws. */
    expect(appearanceMaterials([s.screw], 'data', { tint: '#ff0000' }).size).toBe(0)
    /* Being down or dimmed is not decoration; it reaches the whole part. */
    expect(appearanceMaterials([s.screw], 'data', { state: 'down' }).size).toBe(1)
    expect(appearanceMaterials([s.screw], 'data', { dim: true }).size).toBe(1)
  })

  it('drives a degraded part to amber whatever category it came from', () => {
    const hues = new Set<number>()
    for (const cat of ['compute', 'data', 'edge'] as const) {
      const m = mat('powder', cat === 'data' ? 0x21c3a6 : 0x6e76f1, {}, { cat, role: 'body' })
      const out = appearanceMaterials([m], cat, { state: 'degraded' }).get(m)!
      const hsl = { h: 0, s: 0, l: 0 }
      out.color.getHSL(hsl)
      hues.add(Math.round(hsl.h * 360))
    }
    /* One hue across every category. A state that varied with the part it landed
       on would not be a state, it would be a filter. */
    expect(hues.size).toBe(1)
    expect([...hues][0]).toBe(45)
  })

  it('composes tint under state rather than letting either win', () => {
    const s = sample()
    const tinted = appearanceMaterials([s.body], 'data', { tint: '#ff0000' }).get(s.body)!
    const both = appearanceMaterials([s.body], 'data', { tint: '#ff0000', state: 'down' }).get(
      s.body,
    )!
    /* `down` drains whatever it is handed, so the pair must differ — if state
       ran first and tint overwrote it, these would be equal. */
    expect(both.color.getHex()).not.toBe(tinted.color.getHex())
    expect(lightness(both.color)).toBeLessThan(lightness(tinted.color))
  })

  it('dims toward the backdrop rather than by going transparent', () => {
    const s = sample()
    const out = appearanceMaterials([s.body], 'data', { dim: true }).get(s.body)!
    /* Transparency would move the part into the wrong render pass and sort it
       against every decal in the diagram. */
    expect(out.transparent).toBe(s.body.transparent)
    expect(out.opacity).toBe(s.body.opacity)
    expect(saturation(out.color)).toBeLessThan(saturation(s.body.color))
  })

  it('shares one clone between nodes that look alike', () => {
    const s = sample()
    const a = appearanceMaterials([s.body], 'data', { state: 'degraded' }).get(s.body)
    const b = appearanceMaterials([s.body], 'data', { state: 'degraded' }).get(s.body)
    expect(a).toBe(b)
  })

  it('gives unique materials a private clone', () => {
    /* Uniques exist because an update callback mutates them per frame, and they
       all carry the same cache key. Sharing a clone would make every pulsing
       halo in a diagram animate off whichever node ticked last. */
    const u1 = mat('lit', 0x74f0da, { unique: true }, { cat: 'data', role: 'lit' })
    const u2 = mat('lit', 0x74f0da, { unique: true }, { cat: 'data', role: 'lit' })
    expect(u1).not.toBe(u2)

    const c1 = appearanceMaterials([u1], 'data', { dim: true }).get(u1)!
    const c2 = appearanceMaterials([u2], 'data', { dim: true }).get(u2)!
    expect(c1).not.toBe(c2)
    expect(c1.userData.unique).toBe(true)
  })

  it('stays legible against every category, not just the ones I happened to try', () => {
    /* The bug this exists for: `degraded` was authored at 38°, which is exactly
       the hue `msg` ships. A degraded queue rendered the colour of a healthy
       queue, and the sheet I checked it against happened to contain compute,
       data and ops parts and no msg part at all. Sampling the category a state
       collides with is not something to leave to whichever parts a test picked. */
    const MIN = 0.16
    for (const cat of CATEGORIES) {
      const body = mat('powder', HUE[cat].body, {}, { cat, role: 'body' })
      for (const state of NODE_STATES) {
        if (state === 'healthy') continue
        const out = appearanceMaterials([body], cat, { state }).get(body)
        expect(out, `${state} left ${cat} untouched`).toBeDefined()
        const d = distance(body.color, out!.color)
        expect(d, `${state} on ${cat} is only ${d.toFixed(3)} from its shipped colour`)
          .toBeGreaterThan(MIN)
      }
    }
  })

  it('keeps every state distinct from every other, in every category', () => {
    for (const cat of CATEGORIES) {
      const body = mat('powder', HUE[cat].body, {}, { cat, role: 'body' })
      const painted = NODE_STATES.filter((s) => s !== 'healthy').map((state) => ({
        state,
        color: appearanceMaterials([body], cat, { state }).get(body)!.color,
      }))
      for (let i = 0; i < painted.length; i++) {
        for (let j = i + 1; j < painted.length; j++) {
          const d = distance(painted[i].color, painted[j].color)
          expect(d, `${painted[i].state} and ${painted[j].state} collide on ${cat}`)
            .toBeGreaterThan(0.12)
        }
      }
    }
  })

  it('keeps every state visually distinct on the same part', () => {
    const s = sample()
    const seen = new Map<string, string>()
    for (const state of NODE_STATES) {
      const out = appearanceMaterials([s.body], 'data', { state }).get(s.body)
      const hex = (out ?? s.body).color.getHexString()
      /* Two states that render identically are one state with two names, and a
         reader who learns the vocabulary would be misled by the pair. */
      expect(seen.has(hex), `${state} renders the same as ${seen.get(hex)}`).toBe(false)
      seen.set(hex, state)
    }
  })
})
