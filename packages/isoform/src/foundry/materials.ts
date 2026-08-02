/**
 * Material physics presets and the shared material registry.
 *
 * Two changes from catalog section 2, both load-bearing:
 *
 * 1. MATERIALS ARE CACHED. The catalog mints a fresh MeshPhysicalMaterial on
 *    every `FINISH.polymer(...)` call. Across 14 catalog tiles that is fine;
 *    across 150 diagram nodes it is hundreds of redundant materials, each its
 *    own shader program and uniform block. Everything here is keyed and reused.
 *
 * 2. ROLES ARE TAGGED, NOT INFERRED. The catalog recovers a material's role by
 *    comparing its hex against the HUE table (`classifyMaterial`). That is
 *    clever and it silently breaks the moment two categories share a colour or
 *    a part uses an off-token hue. Here a material records its own category and
 *    role in `userData` at construction, so retinting is a lookup, not a guess.
 *
 * Because materials are shared, mutating one retints every part using it. That
 * is exactly right for a category-wide theme change and exactly wrong for a
 * single-node override, so the two paths are separated: `setCategoryHue` mutates
 * in place for the theme, and per-node changes are copy-on-write.
 *
 * `overrideMaterials` here is the copy-on-write path for a *tint* alone. The
 * renderer no longer calls it — a node's colour is now one of three composable
 * channels (tint, semantic state, focus dimming) resolved together by
 * `foundry/appearance.ts`, because applying them in separate passes means the
 * second discards the first. It stays exported: it is public API, and it is
 * still the right answer for a caller who wants only a retint.
 */

import * as THREE from 'three'
import { textures } from './textures.js'

export type Category = 'compute' | 'data' | 'msg' | 'edge' | 'ops' | 'client' | 'link'
export type Finish = 'polymer' | 'powder' | 'anodised' | 'steel' | 'rubber' | 'acrylic' | 'lit'

/** The three colour slots every category defines. */
export type Token = 'body' | 'trim' | 'lit'

export interface HueSet {
  body: number
  trim: number
  lit: number
  css: string
}

/** Category colour tokens. `css` is for palette chips and legends. */
export const HUE: Record<Category, HueSet> = {
  compute: { body: 0x6e76f1, trim: 0x3a3f8f, lit: 0x9fa8ff, css: '#8B92FF' },
  data: { body: 0x21c3a6, trim: 0x11685c, lit: 0x74f0da, css: '#3ED8BC' },
  msg: { body: 0xe9a247, trim: 0x7e5320, lit: 0xffd08a, css: '#F0AE5C' },
  edge: { body: 0xe96a85, trim: 0x7e2a3d, lit: 0xffa8bb, css: '#F27B94' },
  /* The control plane — what observes and governs, rather than what serves.
     Violet at ~272°, deliberately placed between compute's indigo (236°) and
     edge's rose (345°) so a monitoring stack reads as its own layer instead of
     disappearing into the services it watches. */
  ops: { body: 0x9b6fd4, trim: 0x4d3273, lit: 0xc9a5ef, css: '#A87FE0' },
  client: { body: 0xa9b3c4, trim: 0x4b5464, lit: 0xe4ebf5, css: '#B6C0D0' },
  link: { body: 0xc9d2e0, trim: 0x596374, lit: 0xd9ae6b, css: '#D9AE6B' },
}

export const CATEGORIES = Object.keys(HUE) as Category[]

export function hex6(n: number): string {
  return '#' + ('000000' + n.toString(16)).slice(-6)
}

/**
 * Derive trim and emissive from one base hue using the same relationships the
 * original tokens were built on, so a retinted part keeps its material
 * hierarchy instead of going flat.
 */
export function deriveHues(hex: string | number): { body: number; trim: number; lit: number } {
  const c = new THREE.Color(hex as THREE.ColorRepresentation)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  return {
    body: c.getHex(),
    trim: new THREE.Color()
      .setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.max(0.09, hsl.l * 0.54))
      .getHex(),
    lit: new THREE.Color()
      .setHSL(hsl.h, Math.min(1, hsl.s * 1.12), Math.min(0.87, Math.max(0.62, hsl.l * 1.5)))
      .getHex(),
  }
}

/* ------------------------------------------------------------------ *
 * Surface overrides
 * ------------------------------------------------------------------ */

/**
 * The four places the catalog swaps a material's normal/roughness maps after
 * construction. Under a shared cache that mutation would leak into every other
 * user of the material, so the surface becomes part of the cache key instead.
 */
export type Surface = 'vent' | 'corr' | 'shutter' | 'brick'

function applySurface(m: THREE.MeshStandardMaterial, s: Surface): void {
  const T = textures()
  switch (s) {
    case 'vent':
      m.normalMap = T.ventNormal
      m.roughnessMap = T.ventRough
      m.normalScale = new THREE.Vector2(0.9, 0.9)
      break
    case 'corr':
      m.normalMap = T.corrNormal
      m.normalScale = new THREE.Vector2(0.75, 0.75)
      break
    case 'shutter':
      m.normalMap = T.shutterNormal
      m.normalScale = new THREE.Vector2(0.7, 0.7)
      break
    case 'brick':
      m.normalMap = T.brickNormal
      m.roughnessMap = T.brickRough
      m.normalScale = new THREE.Vector2(1.15, 1.15)
      break
  }
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export interface MatOpts {
  /** Surface preset (vent perforation, corrugation, shutter ribs, brick bond). */
  surface?: Surface
  /** Acrylic only. */
  opacity?: number
  /** Emissive strength, `lit` only. */
  intensity?: number
  /** The gateway aperture is a plane seen from both sides. */
  side?: THREE.Side
  /**
   * Bypass the cache and return a private instance.
   *
   * Required for any material an `update()` callback mutates — the pulsing
   * cache halo and the firewall slit both drive `emissiveIntensity` per frame.
   * Sharing those would make every cache node in a diagram pulse in lockstep
   * off whichever node happened to tick last.
   */
  unique?: boolean
}

export interface MatTag {
  finish: Finish
  cat?: Category
  role?: Token
  /**
   * Built outside the cache because something mutates it per frame.
   *
   * Recorded rather than left implicit because anything that clones a material
   * has to know: uniques all share a cache key, so a clone cache keyed on the
   * name would hand every pulsing halo in the diagram the same instance and they
   * would animate in lockstep off whichever node ticked last.
   */
  unique?: boolean
}

/** Every material carries its provenance. This is what makes retinting exact. */
export type IsoMaterial = THREE.MeshStandardMaterial & { userData: MatTag & Record<string, unknown> }

/**
 * Anything the theme can repaint. Broader than IsoMaterial because a few parts
 * tint non-mesh materials — the edge node's meridian lines and the boundary
 * box's outline are both LineBasicMaterial, and the catalog retints them too.
 */
export type Tintable = THREE.Material & {
  color: THREE.Color
  emissive?: THREE.Color
  userData: Partial<MatTag> & Record<string, unknown>
}

function baseOpts(): THREE.MeshPhysicalMaterialParameters {
  const T = textures()
  return {
    roughnessMap: T.micro,
    normalMap: T.microNormal,
    normalScale: new THREE.Vector2(0.045, 0.045),
    envMapIntensity: 1.0,
  }
}

function construct(finish: Finish, color: number, o: MatOpts): THREE.MeshStandardMaterial {
  switch (finish) {
    case 'polymer':
      return new THREE.MeshPhysicalMaterial({
        ...baseOpts(),
        color,
        metalness: 0.05,
        roughness: 0.42,
        clearcoat: 0.55,
        clearcoatRoughness: 0.3,
      })
    case 'powder':
      return new THREE.MeshPhysicalMaterial({
        ...baseOpts(),
        color,
        metalness: 0.15,
        roughness: 0.66,
        clearcoat: 0.08,
      })
    case 'anodised':
      return new THREE.MeshPhysicalMaterial({
        ...baseOpts(),
        color,
        metalness: 0.9,
        roughness: 0.34,
        clearcoat: 0.15,
        roughnessMap: textures().brushed,
        envMapIntensity: 1.3,
      })
    case 'steel':
      return new THREE.MeshPhysicalMaterial({
        ...baseOpts(),
        color,
        metalness: 1.0,
        roughness: 0.26,
        roughnessMap: textures().brushed,
        envMapIntensity: 1.45,
      })
    case 'rubber':
      return new THREE.MeshPhysicalMaterial({
        ...baseOpts(),
        color,
        metalness: 0.0,
        roughness: 0.92,
        clearcoat: 0.0,
        normalScale: new THREE.Vector2(0.16, 0.16),
      })
    case 'acrylic':
      return new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        transparent: true,
        opacity: o.opacity ?? 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 1.6,
      })
    case 'lit':
      /* A near-black base so the emissive does all the work. Deliberately
         MeshStandardMaterial, not Physical — no clearcoat on a light source. */
      return new THREE.MeshStandardMaterial({
        color: 0x05070a,
        emissive: new THREE.Color(color),
        emissiveIntensity: o.intensity ?? 1.6,
        roughness: 0.5,
        metalness: 0,
      })
  }
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

const cache = new Map<string, IsoMaterial>()
const byCategory = new Map<Category, Set<Tintable>>()

function keyOf(finish: Finish, color: number, o: MatOpts, tag: Partial<MatTag>): string {
  return [
    finish,
    color,
    o.surface ?? '-',
    o.opacity ?? '-',
    o.intensity ?? '-',
    o.side ?? '-',
    tag.cat ?? '-',
    tag.role ?? '-',
  ].join('|')
}

function index(m: Tintable): void {
  const cat = m.userData.cat
  if (!cat) return
  let set = byCategory.get(cat)
  if (!set) {
    set = new Set()
    byCategory.set(cat, set)
  }
  set.add(m)
}

/**
 * Tag and index a material the finish presets don't produce.
 *
 * Needed for the handful of LineBasicMaterials in the catalog that carry a
 * category colour. Without this they would be the only parts of a diagram that
 * ignore a theme change, which reads as a bug.
 */
export function registerTintable(
  m: THREE.Material & { color: THREE.Color },
  cat: Category,
  role: Token,
  finish: Finish = 'polymer',
): void {
  const t = m as Tintable
  t.userData.finish = finish
  t.userData.cat = cat
  t.userData.role = role
  index(t)
}

/**
 * Get (or build) a shared material. Identical arguments always return the same
 * instance — callers must treat the result as immutable.
 */
export function mat(
  finish: Finish,
  color: number,
  o: MatOpts = {},
  tag: Partial<MatTag> = {},
): IsoMaterial {
  const key = keyOf(finish, color, o, tag)
  if (!o.unique) {
    const hit = cache.get(key)
    if (hit) return hit
  }

  const m = construct(finish, color, o) as IsoMaterial
  if (o.surface) applySurface(m, o.surface)
  if (o.side !== undefined) m.side = o.side
  m.userData.finish = finish
  if (tag.cat) m.userData.cat = tag.cat
  if (tag.role) m.userData.role = tag.role
  if (o.unique) m.userData.unique = true
  m.name = key

  /* Unique materials stay out of the cache but still join the category index,
     so a theme change reaches them like anything else. The reconciler is
     responsible for calling `releaseMaterial` when their node goes away. */
  if (!o.unique) cache.set(key, m)
  index(m)
  return m
}

/** Drop a unique material from the category index and free its GPU resources. */
export function releaseMaterial(m: IsoMaterial): void {
  const cat = m.userData.cat
  if (cat) byCategory.get(cat)?.delete(m as unknown as Tintable)
  m.dispose()
}

/* ------------------------------------------------------------------ *
 * Palette — the builder-facing API
 * ------------------------------------------------------------------ */

type ColorArg = Token | number

export interface Palette {
  polymer(c: ColorArg, o?: MatOpts): IsoMaterial
  powder(c: ColorArg, o?: MatOpts): IsoMaterial
  anodised(c: ColorArg, o?: MatOpts): IsoMaterial
  steel(c: ColorArg, o?: MatOpts): IsoMaterial
  rubber(c: ColorArg, o?: MatOpts): IsoMaterial
  acrylic(c: ColorArg, opacity?: number, o?: MatOpts): IsoMaterial
  lit(c: ColorArg, intensity?: number, o?: MatOpts): IsoMaterial
  /** Raw token values, for the rare builder that needs the number itself. */
  hue: HueSet
}

/**
 * A category-scoped material factory.
 *
 * Part builders say `P.powder('body')` rather than `FINISH.powder(c.body)`.
 * Passing the token name instead of the resolved hex is what lets the material
 * record its own role, which is what makes retinting reliable. A raw hex is
 * still accepted for neutral hardware (steel screws, rubber feet) — those carry
 * no category tag and are therefore never retinted, which is correct.
 */
export function palette(cat: Category): Palette {
  const hue = HUE[cat]

  const bind =
    (finish: Finish) =>
    (c: ColorArg, o: MatOpts = {}): IsoMaterial => {
      const isToken = typeof c === 'string'
      const color = isToken ? hue[c] : c
      return mat(finish, color, o, isToken ? { cat, role: c } : {})
    }

  return {
    polymer: bind('polymer'),
    powder: bind('powder'),
    anodised: bind('anodised'),
    steel: bind('steel'),
    rubber: bind('rubber'),
    acrylic: (c, opacity, o = {}) => bind('acrylic')(c, { ...o, opacity }),
    lit: (c, intensity, o = {}) => bind('lit')(c, { ...o, intensity }),
    hue,
  }
}

/* ------------------------------------------------------------------ *
 * Retinting
 * ------------------------------------------------------------------ */

/**
 * Theme-level retint: every material in `cat`, everywhere, moves to the new
 * hue. Mutating the shared instances is the point — one pass repaints the
 * whole document with no scene traversal.
 */
export function setCategoryHue(cat: Category, hex: string | number): void {
  const cols = deriveHues(hex)
  const set = byCategory.get(cat)
  if (!set) return
  for (const m of set) {
    const role = m.userData.role
    if (!role) continue
    if (m.userData.finish === 'lit' && m.emissive) m.emissive.setHex(cols.lit)
    else m.color.setHex(cols[role])
  }
}

/** Restore a category to its shipped tokens. */
export function resetCategoryHue(cat: Category): void {
  setCategoryHue(cat, HUE[cat].body)
}

const overrideCache = new Map<string, IsoMaterial>()

/**
 * Per-node retint, copy-on-write.
 *
 * Returns a substitution map from shared material to overridden clone. Two
 * nodes given the same override still share a single clone, so a diagram where
 * every node is individually coloured costs one material per distinct colour,
 * not one per node.
 */
export function overrideMaterials(
  materials: Iterable<IsoMaterial>,
  cat: Category,
  hex: string | number,
): Map<IsoMaterial, IsoMaterial> {
  const cols = deriveHues(hex)
  const out = new Map<IsoMaterial, IsoMaterial>()
  const hexKey = new THREE.Color(hex as THREE.ColorRepresentation).getHexString()

  for (const src of materials) {
    if (src.userData.cat !== cat) continue
    const role = src.userData.role
    if (!role) continue

    const key = src.name + '::' + hexKey
    let clone = overrideCache.get(key)
    if (!clone) {
      clone = src.clone() as IsoMaterial
      clone.userData = { ...src.userData }
      clone.name = key
      if (clone.userData.finish === 'lit') clone.emissive.setHex(cols.lit)
      else clone.color.setHex(cols[role])
      overrideCache.set(key, clone)
    }
    out.set(src, clone)
  }
  return out
}

/** Distinct materials reachable from a subtree, in traversal order. */
export function collectMaterials(root: THREE.Object3D): IsoMaterial[] {
  const out: IsoMaterial[] = []
  const seen = new Set<THREE.Material>()
  root.traverse((o) => {
    const om = (o as THREE.Mesh).material
    if (!om) return
    const list = Array.isArray(om) ? om : [om]
    for (const m of list) {
      if (seen.has(m)) continue
      seen.add(m)
      out.push(m as IsoMaterial)
    }
  })
  return out
}

/** Diagnostics — how many distinct materials the registry is holding. */
export function materialCount(): number {
  return cache.size + overrideCache.size
}

/** Test seam. Drops every cached material; callers must rebuild their scenes. */
export function clearMaterialCache(): void {
  for (const m of cache.values()) m.dispose()
  for (const m of overrideCache.values()) m.dispose()
  cache.clear()
  overrideCache.clear()
  byCategory.clear()
}
