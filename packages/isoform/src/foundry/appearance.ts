/**
 * Appearance — how a node deviates from its shipped colours.
 *
 * Three independent things can change what a part looks like without changing
 * what it *is*: a per-node tint, a semantic state, and whether it is currently
 * dimmed for emphasis. They compose, so they cannot each own a separate
 * substitution pass — two passes would each start from the shared material and
 * the second would discard the first. One function resolves all three at once
 * and yields a single clone.
 *
 * ## Why this is not `overrideMaterials`
 *
 * Tinting is role-based and category-scoped on purpose: it moves a part's body,
 * trim and emissive together through `deriveHues`, and it deliberately leaves
 * neutral hardware — steel screws, rubber feet — alone, because a red database
 * still has grey screws.
 *
 * State and dim are the opposite. A part that is *down* has dark screws too, and
 * a dimmed part whose hardware stays bright reads as a rendering fault rather
 * than as de-emphasis. So those two apply to every material in the part,
 * including the untagged ones `overrideMaterials` skips by design.
 *
 * ## Reversibility
 *
 * Focus toggles constantly — every selection change re-partitions the diagram —
 * so substitution has to be undoable. This module never reads a mesh's current
 * material: it maps *from the shipped material*, and the caller keeps that
 * baseline. Restoring is then assignment, not an inverse transform.
 */

import * as THREE from 'three'
import { deriveHues, type Category, type IsoMaterial } from './materials.js'

/**
 * What a node is doing, as opposed to what colour it is.
 *
 * `tint` is decoration and means whatever the author decides. This is a fixed
 * vocabulary rendered the same way everywhere, so `degraded` looks like
 * `degraded` in any diagram anyone makes — which is the only reason a reader can
 * learn it once.
 */
export type NodeState = 'healthy' | 'degraded' | 'down' | 'new' | 'deprecated' | 'planned'

export const NODE_STATES: readonly NodeState[] = [
  'healthy',
  'degraded',
  'down',
  'new',
  'deprecated',
  'planned',
]

export interface Appearance {
  /** Per-node hue override, as accepted by `overrideMaterials`. */
  tint?: string
  state?: NodeState
  /** De-emphasised because focus is elsewhere. Render state, never document state. */
  dim?: boolean
}

/**
 * A hue/saturation/lightness move applied to every material in a part.
 *
 * Deliberately expressed as a colour operation rather than as a set of finished
 * hex values: parts arrive in seven category palettes and a state has to read
 * the same on all of them, which a fixed colour cannot do.
 */
interface Shift {
  /** Absolute hue in turns. Present means the state repaints rather than nudges. */
  hue?: number
  /** Saturation. A factor when `hue` is absent, an absolute value when present. */
  sat: number
  /** Lightness factor. */
  light: number
  /** Emissive factor for `lit` finishes. Zero puts the lights out. */
  glow: number
}

const STATE_SHIFT: Record<NodeState, Shift | null> = {
  /* An explicit clean bill of health is an assertion about the system, not a
     request to look different. If `healthy` were styled, a diagram where
     everything is fine would read as a diagram where everything is flagged, and
     the states that matter would have nothing to stand out against. */
  healthy: null,

  /* Hot yellow-amber, pushed to 45° and near-full saturation.

     The obvious value was 38° — the hue `msg` already uses, reusing a colour the
     palette contains. It was wrong for exactly that reason: a degraded queue
     came out the colour of a healthy queue. A state has to be legible against
     every category, so it cannot borrow any of their hues, and it has to differ
     in more than hue alone. Hence the saturation ceiling and the 1.9× glow. */
  degraded: { hue: 45 / 360, sat: 0.95, light: 1.12, glow: 1.9 },

  /* Drained and dark with the lights out. The one state that should read from
     across the room, and the only one that takes `glow` to zero: a machine that
     is down does not have its indicators on. */
  down: { sat: 0.12, light: 0.4, glow: 0 },

  /* Lime-green at 100°, still the colour an addition is read in everywhere else.

     This kept the part's own category hue at first, on the theory that a reader
     meeting a part for the first time should see what it is. In a render that
     produced a service indistinguishable from a healthy one — the brightening
     meant to carry it was clamped away. A state nobody can see is not a state,
     and the category is still legible from the part's shape.

     Green then wanted to be 145°, which is 23° from `data`'s teal — near enough
     that a new database barely moved. 100° is the widest gap the palette leaves:
     55° clear of `degraded` below it and 68° clear of `data` above. */
  new: { hue: 100 / 360, sat: 0.72, light: 1.12, glow: 1.6 },

  /* Dull brown at 22°, drained and slightly darkened. Still on, still serving,
     visibly on the way out. */
  deprecated: { hue: 22 / 360, sat: 0.2, light: 0.82, glow: 0.35 },

  /* Blueprint — pale cyan-blue at 200°, low saturation, softly lit. Reads as
     drawn rather than built, which is the difference it has to carry. */
  planned: { hue: 200 / 360, sat: 0.3, light: 1.38, glow: 0.5 },
}

/**
 * Dimming mixes toward the backdrop rather than dropping opacity.
 *
 * Transparency would be the obvious move and is the wrong one: the merge pass
 * splits geometry into opaque and transparent buffers, so turning an opaque part
 * translucent puts it in the wrong pass, and it would sort against every decal
 * in the diagram. Mixing the colour costs nothing and cannot reorder anything.
 *
 * The target sits just above the darkest stop of the stage gradient (#0E1116).
 * Mixing to the background itself would punch holes in the diagram; landing a
 * little above it keeps the light rig reading form, so a dimmed part is still a
 * part and not a silhouette.
 */
const DIM_TARGET = new THREE.Color(0x232a34)
const DIM_MIX = 0.74
const DIM_GLOW = 0.1

/**
 * Stable identity for an appearance. Empty means "shipped colours".
 *
 * Doubles as the appearance component of the instancing batch key, so a batch is
 * shared by exactly the nodes that resolve to the same materials.
 */
export function appearanceKey(a: Appearance): string {
  const state = a.state && a.state !== 'healthy' ? a.state : ''
  if (!a.tint && !state && !a.dim) return ''
  return `${a.tint ?? ''}|${state}|${a.dim ? 'd' : ''}`
}

export function isNeutral(a: Appearance): boolean {
  return appearanceKey(a) === ''
}

function applyShift(c: THREE.Color, s: Shift): void {
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  /* A shift that names a hue is repainting, not nudging, so its saturation is
     the value to use rather than a factor. Multiplying there would leave neutral
     hardware grey — a degraded part would go amber on its body and nowhere
     else, which looks like a partial failure of the renderer. */
  const sat = s.hue === undefined ? hsl.s * s.sat : s.sat
  c.setHSL(
    s.hue ?? hsl.h,
    THREE.MathUtils.clamp(sat, 0, 1),
    /* Floored above black and capped below white: either extreme discards the
       hue entirely, and a state that collapses two categories to the same
       colour has stopped carrying information. */
    THREE.MathUtils.clamp(hsl.l * s.light, 0.03, 0.94),
  )
}

/** Where a material ends up, or null when this appearance leaves it alone. */
function shade(src: IsoMaterial, cat: Category, a: Appearance): { color: number; glow: number } | null {
  const lit = src.userData.finish === 'lit'
  const out = new THREE.Color()
  let touched = false

  /* Tint first, and only where tint applies — it is the one channel that knows
     about material roles, and it establishes the base the other two modify. */
  const role = src.userData.role
  if (a.tint && role && src.userData.cat === cat) {
    const cols = deriveHues(a.tint)
    out.setHex(lit ? cols.lit : cols[role])
    touched = true
  } else {
    out.copy(lit ? src.emissive : src.color)
  }

  let glow = 1

  const shift = a.state ? STATE_SHIFT[a.state] : null
  if (shift) {
    applyShift(out, shift)
    glow *= shift.glow
    touched = true
  }

  if (a.dim) {
    out.lerp(DIM_TARGET, DIM_MIX)
    glow *= DIM_GLOW
    touched = true
  }

  return touched ? { color: out.getHex(), glow } : null
}

const cloneCache = new Map<string, IsoMaterial>()

/**
 * Substitution map from shipped material to its appearance-adjusted clone.
 *
 * Copy-on-write and shared: two nodes with the same appearance resolve to the
 * same clone, so a diagram where every node is individually styled costs one
 * material per distinct appearance rather than one per node.
 *
 * Materials built `unique` are the exception. They exist because something
 * mutates them per frame — the cache halo's pulse, the firewall slit — and they
 * all carry the same cache key, so sharing a clone would make every one of them
 * animate off whichever node ticked last. Those get a private clone, flagged so
 * the caller knows to release it.
 */
export function appearanceMaterials(
  materials: Iterable<IsoMaterial>,
  cat: Category,
  a: Appearance,
): Map<IsoMaterial, IsoMaterial> {
  const out = new Map<IsoMaterial, IsoMaterial>()
  const suffix = appearanceKey(a)
  if (!suffix) return out

  for (const src of materials) {
    const target = shade(src, cat, a)
    if (!target) continue

    const isUnique = src.userData.unique === true
    const key = `${src.name}::${suffix}`
    let clone = isUnique ? undefined : cloneCache.get(key)

    if (!clone) {
      clone = src.clone() as IsoMaterial
      clone.userData = { ...src.userData }
      clone.name = key
      if (src.userData.finish === 'lit') {
        clone.emissive.setHex(target.color)
        clone.emissiveIntensity = src.emissiveIntensity * target.glow
      } else {
        clone.color.setHex(target.color)
        /* Non-lit materials can still carry emissive — a few parts glow through
           a powder-coated face — so the factor has to reach them too. */
        if (clone.emissiveIntensity) clone.emissiveIntensity *= target.glow
      }
      if (!isUnique) cloneCache.set(key, clone)
    }
    out.set(src, clone)
  }
  return out
}

/** Test seam: clones survive between documents, which a cache assertion must not. */
export function clearAppearanceCache(): void {
  for (const m of cloneCache.values()) m.dispose()
  cloneCache.clear()
}

/* ------------------------------------------------------------------ *
 * Applying an appearance to a subtree
 * ------------------------------------------------------------------ */

/**
 * A mesh's shipped material, recorded the first time anything repaints it.
 *
 * Appearance has to be reversible: clearing a tint or moving focus elsewhere
 * must put a part back exactly as the foundry built it. Mapping from the current
 * material cannot do that — after one substitution the original is gone — so
 * every substitution maps from this baseline instead, and restoring is an
 * assignment rather than an inverse transform.
 */
export function baselineMaterial(m: THREE.Mesh): THREE.Material | THREE.Material[] {
  const held = m.userData.baseMaterial as THREE.Material | THREE.Material[] | undefined
  if (held) return held
  m.userData.baseMaterial = m.material
  return m.material
}

/** Distinct shipped materials in a subtree — what to hand `appearanceMaterials`. */
export function collectBaselines(root: THREE.Object3D): IsoMaterial[] {
  const out: IsoMaterial[] = []
  const seen = new Set<THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.material) return
    for (const x of ([] as THREE.Material[]).concat(baselineMaterial(m))) {
      if (seen.has(x)) continue
      seen.add(x)
      out.push(x as IsoMaterial)
    }
  })
  return out
}

/**
 * Assign a substitution across a subtree. `null` restores shipped materials.
 *
 * Always reads the baseline rather than what is currently assigned, so calling
 * this twice with different appearances replaces rather than stacks.
 */
export function paint(root: THREE.Object3D, sub: Map<IsoMaterial, IsoMaterial> | null): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.material) return
    const base = baselineMaterial(m)
    if (!sub) {
      m.material = base
      return
    }
    m.material = Array.isArray(base)
      ? base.map((x) => sub.get(x as IsoMaterial) ?? x)
      : (sub.get(base as IsoMaterial) ?? base)
  })
}
