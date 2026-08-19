/**
 * Nameplates.
 *
 * A label is a small machined tag floating above its part, carrying its text as
 * a canvas texture on a plate with real thickness — not an HTML overlay and not
 * a decal lying on the ground. Three reasons, in order of weight:
 *
 *   1. It appears in exports. A PNG or glTF of a diagram whose labels lived in
 *      the DOM comes out unlabelled, which is the one thing a diagram cannot be.
 *   2. It is a solid object in the scene, so it takes the studio lighting and
 *      reads as part of the assembly rather than pasted over it.
 *   3. The catalog's own roadmap named "label plates" as the next thing to ship.
 *
 * The tag stands upright and turns about Y to face the viewer, and a thin stem
 * drops from it to the part it names. The stem is what lets the declutter pass
 * slide a tag sideways without breaking the association — it becomes a leader
 * line rather than a label floating over the wrong object.
 */

import * as THREE from 'three'
import { palette, type Category } from '../foundry/materials.js'
import {
  appearanceMaterials,
  baselineMaterial,
  collectBaselines,
  paint,
} from '../foundry/appearance.js'
import { cylinder, mesh, plane, roundedBox } from '../foundry/geometry.js'

/** Device pixels per grid unit in the label texture. Sets text crispness. */
const PX_PER_UNIT = 220

/**
 * Text height in grid units.
 *
 * Smaller than the ground-plate version this replaces: a floating tag is nearer
 * the eye, unobstructed, and always square to the viewer, so it carries at a
 * size that would have been unreadable lying flat.
 */
const TITLE_U = 0.24
const SUB_U = 0.15
const PAD_X = 0.16
const PAD_Y = 0.11

/** Plate thickness, and how far the tag floats above the part it names. */
const PLATE_D = 0.05
const LIFT = 0.42

/**
 * Tags draw over the model rather than inside it.
 *
 * A tag is an annotation, not a prop: it names a part, and a name that the part
 * in front of it eats is worse than no name at all. Measured across the five
 * reference architectures, eleven plates were more than 5% swallowed by geometry
 * and trace arrows, one of them 80% — a label sliced in half by a connector
 * reads as a rendering fault, not as depth.
 *
 * Lifting the layer means a tag can cover geometry it sits behind. That is the
 * trade, and it is the right way round: the tag is small, carries its leader
 * stem, and is the thing the reader is trying to read.
 */
const LABEL_ORDER = 900

/**
 * Depth-free twin of a shared material.
 *
 * The palette's cache hands the same material to a plate and to any part of the
 * same category — three of them, measured — so setting `depthTest = false` on
 * what it returns turns depth testing off on the parts too, and they render
 * inside out. Cloning once per base material keeps the plates sharing and
 * leaves the original untouched.
 */
const onTopCache = new Map<THREE.Material, THREE.Material>()
function onTop<T extends THREE.Material>(base: T): T {
  let lifted = onTopCache.get(base)
  if (!lifted) {
    lifted = base.clone()
    lifted.depthTest = false
    /* Renamed, because the appearance cache keys derived materials on the source
       name. Sharing a name with the depth-tested original would let a dimmed
       *part* be served this twin out of that cache and render inside out. */
    lifted.name = `${base.name}|ontop`
    onTopCache.set(base, lifted)
  }
  return lifted as T
}

export interface Nameplate {
  /** Plate and text. Positioned and turned by `orientNameplate`. */
  group: THREE.Group
  /** Leader from the part up to the plate. */
  stem: THREE.Mesh
  width: number
  height: number
  /** Whether focus is currently elsewhere. */
  dimmed?: boolean
}

const texCache = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number }>()
const matCache = new Map<THREE.Texture, THREE.MeshBasicMaterial>()

/** One material per distinct label texture, shared across every plate using it. */
function textMaterial(tex: THREE.Texture): THREE.MeshBasicMaterial {
  let m = matCache.get(tex)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    matCache.set(tex, m)
  }
  return m
}

/**
 * Drop cached label textures. Call after a webfont finishes loading, so plates
 * built against the fallback face are remeasured against the real one.
 */
export function clearLabelCache(): void {
  for (const { tex } of texCache.values()) tex.dispose()
  for (const m of matCache.values()) m.dispose()
  for (const m of dimTextCache.values()) m.dispose()
  texCache.clear()
  matCache.clear()
  dimTextCache.clear()
}

function labelTexture(
  title: string,
  sub: string | undefined,
): { tex: THREE.CanvasTexture; w: number; h: number } {
  const key = `${title}\0${sub ?? ''}`
  const hit = texCache.get(key)
  if (hit) return hit

  const titlePx = TITLE_U * PX_PER_UNIT
  const subPx = SUB_U * PX_PER_UNIT
  const titleFont = `600 ${titlePx}px Archivo, system-ui, sans-serif`
  const subFont = `500 ${subPx}px "IBM Plex Mono", monospace`

  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = titleFont
  const titleW = probe.measureText(title).width
  probe.font = subFont
  const subW = sub ? probe.measureText(sub).width : 0

  const padX = PAD_X * PX_PER_UNIT
  const padY = PAD_Y * PX_PER_UNIT
  const gap = sub ? subPx * 0.4 : 0
  const w = Math.ceil(Math.max(titleW, subW) + padX * 2)
  const h = Math.ceil(titlePx + (sub ? gap + subPx : 0) + padY * 2)

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')!
  x.clearRect(0, 0, w, h)
  x.textBaseline = 'top'
  x.textAlign = 'center'
  x.fillStyle = '#EEF2F8'
  x.font = titleFont
  x.fillText(title, w / 2, padY)
  if (sub) {
    x.fillStyle = '#8C97A8'
    x.font = subFont
    x.fillText(sub, w / 2, padY + titlePx + gap)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const made = { tex, w, h }
  texCache.set(key, made)
  return made
}

/**
 * Build a tag for `title` (and optional `sub`), sized to its text.
 *
 * `scale` shrinks the whole tag without touching the texture, which stays shared
 * in the cache — the same words on a connector and on a part are one canvas.
 * Connector tags are drawn smaller on purpose: a diagram has more of them than
 * it has parts, and at equal weight they read as the subject rather than as
 * annotation on it.
 */
export function makeNameplate(
  title: string,
  sub: string | undefined,
  cat: Category,
  scale = 1,
): Nameplate {
  const { tex, w, h } = labelTexture(title, sub)
  const uw = (w / PX_PER_UNIT) * scale
  const uh = (h / PX_PER_UNIT) * scale

  const P = palette(cat)
  const g = new THREE.Group()

  /* Upright plate: width on X, height on Y, thickness on Z — so the face the
     text sits on is the one billboarding turns toward the viewer. */
  const plate = mesh(roundedBox(uw, uh, PLATE_D, 0.05), onTop(P.anodised('trim')), [0, 0, 0])
  plate.castShadow = true
  plate.receiveShadow = true
  plate.renderOrder = LABEL_ORDER
  g.add(plate)

  /* Text just proud of the front face, unlit so it stays legible wherever the
     key light happens to fall. PlaneGeometry already faces +Z.
     Ordered after the plate: with depth testing off, what paints last wins, so
     the two would otherwise race and the backing would sometimes cover its own
     text. */
  const face = mesh(plane(uw, uh), onTop(textMaterial(tex)), [0, 0, PLATE_D / 2 + 0.002])
  face.renderOrder = LABEL_ORDER + 1
  g.add(face)

  /* Thin enough to stay out of the way, thick enough to read once the
     declutter pass slides a tag off its part and it becomes a leader. */
  const stem = mesh(cylinder(0.017, 0.017, 1, 8), onTop(P.steel(0x8f98a8)))
  stem.renderOrder = LABEL_ORDER

  return { group: g, stem, width: uw, height: uh }
}

/**
 * How far a de-emphasised label recedes.
 *
 * Text is the loudest thing in a diagram — it is unlit, always square to the
 * viewer, and read before anything else — so a focus pass that leaves labels
 * alone barely reads as focus at all. Not hidden outright: a reader still needs
 * the surrounding names to know where they are looking.
 */
const DIM_TEXT_OPACITY = 0.26

const dimTextCache = new Map<THREE.Material, THREE.MeshBasicMaterial>()

/**
 * The pale twin of a label's text material.
 *
 * Its own cache rather than `appearanceMaterials`, because label text is an
 * unlit `MeshBasicMaterial` carrying a texture. There is no shading on it to
 * darken and no category to retint — the only channel that means anything is
 * opacity, and it is already transparent.
 */
function dimTextMaterial(src: THREE.Material): THREE.MeshBasicMaterial {
  let m = dimTextCache.get(src)
  if (!m) {
    m = (src as THREE.MeshBasicMaterial).clone()
    m.opacity = (src as THREE.MeshBasicMaterial).opacity * DIM_TEXT_OPACITY
    dimTextCache.set(src, m)
  }
  return m
}

/**
 * De-emphasise a nameplate along with the part it names.
 *
 * The plate and stem are foundry materials and go through the same appearance
 * path everything else does; only the text needs the treatment above.
 */
export function setNameplateDimmed(n: Nameplate, dim: boolean): void {
  if (n.dimmed === dim) return
  n.dimmed = dim

  for (const root of [n.group, n.stem]) {
    const bases = collectBaselines(root)
    paint(root, dim ? appearanceMaterials(bases, 'link', { dim: true }) : null)
  }

  n.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.material) return
    const base = baselineMaterial(m) as THREE.Material
    if (!(base as THREE.MeshBasicMaterial).isMeshBasicMaterial) return
    m.material = dim ? dimTextMaterial(base) : base
  })
}

/**
 * How much of a tag's height must survive projection, at worst.
 *
 * An upright plate seen from a camera `el` above the horizon is foreshortened by
 * `cos(el)`. At the hero elevation that is 0.91 — a 9% squash nobody notices —
 * but the viewer lets a reader orbit anywhere, and by 54° it is 0.59 and by 69°
 * it is 0.36. What that looks like is not "a plate seen from above": it looks
 * like the *text* has been stretched sideways, which is how this was reported.
 *
 * So the plate stays exactly upright while the squash is imperceptible, and past
 * that tips back only as far as it must to hold this floor. 0.86 keeps the
 * letterforms honest while leaving the tag reading as a plate standing in the
 * scene rather than a sticker pasted over it — which is why turning about Y
 * alone was right in the first place, and why the fix is a cap and not a
 * full billboard.
 */
const MIN_FACING = 0.86

/** Below this camera elevation the tag does not tip at all. ~30.7°. */
const TILT_FREE = Math.acos(MIN_FACING)

const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_X = new THREE.Vector3(1, 0, 0)
/* Scratch, so per-frame orientation of hundreds of tags allocates nothing. */
const pitchQuat = new THREE.Quaternion()
const localDown = new THREE.Vector3()

/**
 * Float a tag above `top` and turn it to face the viewer.
 *
 * `top` is the part's apex, so the tag clears whatever it names regardless of
 * how tall that is. Called per frame; cheap enough for hundreds of labels.
 */
export function orientNameplate(n: Nameplate, top: THREE.Vector3, camera: THREE.Camera): void {
  n.group.position.set(top.x, top.y + LIFT + n.height / 2, top.z)

  /* Measured from the plate rather than from the part it names: the plate rides
     `LIFT` above the apex, and at a low camera that difference is most of the
     elevation angle. */
  const dx = camera.position.x - n.group.position.x
  const dy = camera.position.y - n.group.position.y
  const dz = camera.position.z - n.group.position.z
  const yaw = Math.atan2(dx, dz)
  const el = Math.atan2(dy, Math.hypot(dx, dz))

  /* Negative rotation about local X tips the face (+Z) upward, toward a camera
     above. Signed, so a camera below the tag tips it the other way. */
  const tip = Math.max(0, Math.abs(el) - TILT_FREE)
  const pitch = el >= 0 ? -tip : tip

  n.group.quaternion
    .setFromAxisAngle(AXIS_Y, yaw)
    .multiply(pitchQuat.setFromAxisAngle(AXIS_X, pitch))
  layStem(n, top)
}

/** Stretch the stem from the part's apex to the underside of the tag. */
function layStem(n: Nameplate, top: THREE.Vector3): void {
  const from = top
  /* The underside travels with the tilt, so it is found through the plate's own
     orientation. Dropping straight down in world Y instead leaves the stem
     visibly unattached once the tag tips. */
  localDown.set(0, -1, 0).applyQuaternion(n.group.quaternion)
  const to = n.group.position.clone().addScaledVector(localDown, n.height / 2)
  const dir = to.clone().sub(from)
  const len = dir.length()
  if (len < 1e-4) {
    n.stem.visible = false
    return
  }
  n.stem.visible = true
  n.stem.position.copy(from).addScaledVector(dir, 0.5)
  n.stem.scale.set(1, len, 1)
  n.stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
}

/** Clear space between two plates, as a fraction of the frame width. */
const LABEL_GAP_NDC = 0.012

/**
 * Slide overlapping tags apart.
 *
 * Every tag wants the air directly above its own part, so parts that sit close
 * together stack their labels — the one thing that makes a labelled diagram less
 * readable than an unlabelled one.
 *
 * ## Resolved where the collision happens: on screen
 *
 * This used to compare *world* positions — two tags conflicted only if they were
 * close in world depth and within half a plate of each other in world height.
 * Neither is where a reader sees the overlap. A boundary's tag rides at the
 * height of its tier and a part's tag rides above the part, so the two are
 * metres apart in world Y, pass the height test, and are then drawn one on top
 * of the other. Measured across five real architectures, twelve pairs collided
 * with up to a third of a plate hidden behind another.
 *
 * Projecting first costs one matrix multiply per tag and tests the thing that
 * actually matters. Resolution stays along the camera's right vector so a
 * displaced tag reads as a callout — its stem follows and becomes a leader —
 * and the push is converted back through each tag's own screen scale, because
 * a tag at the back of the diagram needs more world movement per pixel than one
 * at the front.
 */
/**
 * A tag's half-extents on screen, from its full oriented box.
 *
 * Every corner of (width × height × thickness) carried through the plate's own
 * world matrix and projected. That is what the reader sees and what `critique`
 * counts, and any cheaper probe measures a smaller rectangle than the one drawn.
 */
function plateRect(n: Nameplate, camera: THREE.Camera): { hw: number; hh: number } {
  n.group.updateWorldMatrix(true, false)
  const hx = n.width / 2
  const hy = n.height / 2
  /* The text quad sits just proud of the front face, so the box is a shade
     deeper than the plate itself. */
  const hz = PLATE_D / 2 + 0.004
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const sx of [-hx, hx]) {
    for (const sy of [-hy, hy]) {
      for (const sz of [-hz, hz]) {
        corner.set(sx, sy, sz).applyMatrix4(n.group.matrixWorld).project(camera)
        x0 = Math.min(x0, corner.x)
        x1 = Math.max(x1, corner.x)
        y0 = Math.min(y0, corner.y)
        y1 = Math.max(y1, corner.y)
      }
    }
  }
  return { hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 }
}

const corner = new THREE.Vector3()

/**
 * What a tag is worth keeping, when not all of them fit. Lower wins.
 *
 * A boundary names a whole tier and is the coarsest thing on screen, so it is
 * the last thing to give up; a connector tag is the finest and there are the
 * most of them. Ties break on distance, nearest first.
 */
export const LABEL_RANK = { group: 0, node: 1, edge: 2 } as const

export type LabelRank = (typeof LABEL_RANK)[keyof typeof LABEL_RANK]

export interface PlacedLabel {
  plate: Nameplate
  top: THREE.Vector3
  rank?: LabelRank
}

export function declutter(plates: PlacedLabel[], camera: THREE.Camera): void {
  /* Everything is shown until this pass decides otherwise, and the decision is
     remade every frame — the camera moves, so what fits changes. */
  for (const p of plates) {
    p.plate.group.visible = true
    p.plate.stem.visible = true
  }
  if (plates.length < 2) return

  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  right.y = 0
  if (right.lengthSq() < 1e-9) return
  right.normalize()

  /* One scratch vector per probe, and each reading taken before the next probe
     runs. Sharing a single scratch across the four projections here silently
     aliases them — `edge` and `top` become the same object, the half-width is
     read off the vertical probe, and it comes out at ~zero. Declutter then finds
     no overlaps anywhere and quietly does nothing, which measures exactly like a
     diagram whose labels were never decluttered at all. */
  const at = new THREE.Vector3()
  const up = new THREE.Vector3()
  /** Project a point offset from `c` by `dx` along `right` and `dy` along `axis`. */
  const project = (
    c: THREE.Vector3,
    dx: number,
    dy: number,
    axis: THREE.Vector3,
  ): THREE.Vector3 => at.copy(c).addScaledVector(right, dx).addScaledVector(axis, dy).project(camera)

  const items = plates.map((p) => {
    const c = p.plate.group.position
    /* The tag's own up, not the world's. Past ~31° of camera elevation a tag
       tips back to stay readable, and measuring its height straight up in world
       Y then reports a box that is not the one on screen — which is exactly the
       elevation range where tags crowd together and the pass matters most. */
    up.set(0, 1, 0).applyQuaternion(p.plate.group.quaternion)
    const centre = project(c, 0, 0, up)
    const x = centre.x
    const y = centre.y
    /* Screen scale of this tag, measured rather than derived: one world unit
       along `right` is this many NDC units at this tag's depth. */
    const perUnit = project(c, 1, 0, up).x - x
    /* Half-extents from the plate's whole projected box, corners and all — the
       same rectangle `critique` measures, so the two agree about what overlaps.
       Probing only the width and height axes ignores the plate's thickness, and
       the resulting box is small enough that pairs pass this pass and are then
       counted as collisions by the metric: 11 of them, one at 55%, on a diagram
       this had just declared clear. */
    const box = plateRect(p.plate, camera)
    const hw = box.hw
    const hh = box.hh
    /* `x0` is home — where the tag sits over the part that owns it. Travel is
       measured from there, never from wherever the solver has drifted to. */
    return { ...p, x, y, x0: x, hw, hh, perUnit }
  })
  /* Tags only fight if they share a band of screen height, so solve each band on
     its own and leave the rest alone. Bands are grown by overlap rather than by
     rounding to fixed rows, because a row height that suits one diagram splits
     tags that visibly collide in another. */
  const byTop = [...items].sort((a, b) => a.y - a.hh - (b.y - b.hh))
  const bands: (typeof items)[] = []
  let end = -Infinity
  for (const it of byTop) {
    if (it.y - it.hh >= end) bands.push([])
    bands[bands.length - 1].push(it)
    end = Math.max(end, it.y + it.hh)
  }

  for (const band of bands) separate(band)

  /**
   * Slide a band's tags apart with the least total movement.
   *
   * Keeping the tags in their left-to-right order turns this from a pairwise
   * problem into a chain: separate each neighbouring pair and every pair is
   * separated, because the gaps accumulate. Subtracting the required gaps then
   * leaves "put these in non-decreasing order, moving as little as possible" —
   * isotonic regression, which pool-adjacent-violators solves exactly in one
   * pass.
   *
   * The tempting alternative is to push overlapping pairs apart and repeat until
   * it settles. It does not reliably settle: six tags inside two world units
   * were still overlapping after six passes, because each fix disturbs a
   * neighbour. This arrives at the answer instead of approaching it, and it
   * cannot reorder tags — a tag that overtakes its neighbour swaps two labels on
   * screen, which is worse than the overlap it was fixing.
   */
  function separate(band: typeof items): void {
    if (band.length < 2) return
    band.sort((a, b) => a.x - b.x)

    /* Required left edge-to-edge spacing between each neighbouring pair. */
    let run = 0
    const shifted = band.map((it, i) => {
      if (i > 0) run += band[i - 1].hw + it.hw + LABEL_GAP_NDC
      return it.x - run
    })

    /* Pool adjacent violators: merge any block whose mean falls below the block
       to its left, since the two cannot both keep their means in order. */
    const sum: number[] = []
    const n: number[] = []
    for (const v of shifted) {
      sum.push(v)
      n.push(1)
      while (sum.length > 1 && sum[sum.length - 1] / n[n.length - 1] <= sum[sum.length - 2] / n[n.length - 2]) {
        const s = sum.pop() as number
        const c = n.pop() as number
        sum[sum.length - 1] += s
        n[n.length - 1] += c
      }
    }

    let k = 0
    run = 0
    for (let b = 0; b < sum.length; b++) {
      const mean = sum[b] / n[b]
      for (let c = 0; c < n[b]; c++, k++) {
        if (k > 0) run += band[k - 1].hw + band[k].hw + LABEL_GAP_NDC
        band[k].x = mean + run
      }
    }
  }

  /**
   * As far as a tag may be slid from the part it names, as a fraction of the
   * frame's width.
   *
   * Measured in *screen* terms, not in multiples of the tag's own width. The
   * width-relative version is the intuitive one and it is backwards: the widest
   * tags get the longest leashes, and the widest tags are precisely the ones
   * that need moving, so the labels that stray furthest are the ones carrying
   * the most text. Measured on a 26-part diagram at the hero angle, the median
   * tag sat **14.3% of the frame** from its part and forty of forty-five were
   * past 5% — which on screen is a caption floating in open space with a hairline
   * reaching back toward something it might belong to.
   *
   * What a reader can follow is a leader of a few percent of the frame. Past
   * that the association is gone whatever the arithmetic says, so the tag stops
   * and takes its chances with the cull below. Sliding is the small adjustment;
   * hiding is the answer to real crowding.
   */
  const MAX_TRAVEL_FRAME = 0.035

  /** A tag's solved position, held within a leader's reach of its own part. */
  const clamped = (it: (typeof items)[number]): number => {
    const reach = MAX_TRAVEL_FRAME * 2
    return Math.max(it.x0 - reach, Math.min(it.x0 + reach, it.x))
  }

  for (const it of items) {
    /* Commit the bound into `x` before anything reads it. The cull below decides
       what fits from these coordinates, and the solver's unclamped answer is not
       where the tag ends up — reading that instead compares tags at positions
       spread far wider than the ones drawn, finds no overlaps, and quietly keeps
       everything. */
    it.x = clamped(it)
    /* Back to world along `right`, through this tag's own scale. A degenerate
       scale means the tag is edge-on to the camera and cannot be resolved by
       sliding sideways; leaving it is better than dividing by ~zero and
       flinging it out of the frame. */
    if (Math.abs(it.perUnit) < 1e-6) continue
    const nowX = project(it.plate.group.position, 0, 0, AXIS_Y).x
    it.plate.group.position.addScaledVector(right, (it.x - nowX) / it.perUnit)
    layStem(it.plate, it.top)
  }

  cull(items, camera)
}

/**
 * How much of a tag may disappear under another before it is dropped instead.
 *
 * Not zero: tags touching at the corner are still both readable, and a zero
 * tolerance makes the set flicker as the camera drifts.
 */
const CULL_OVERLAP = 0.18

/**
 * Hide the tags that did not fit, instead of letting them pile up.
 *
 * Sliding can only do so much. Once a tag is at the end of its leash and still
 * covered, there are three things a renderer can do with it, and only one of
 * them is a design:
 *
 *  - **Slide it further.** What this used to do. Past a few of its own widths
 *    the leader stops associating anything and the picture fills with hairlines
 *    running across it.
 *  - **Let it overlap.** What the previous fix did. Honest about the crowding
 *    and useless to read: at a low camera the whole diagram flattens into one
 *    band and dozens of tags stack into an illegible mat.
 *  - **Drop it.** What every map renderer does, and the only one that leaves
 *    every tag still on screen readable.
 *
 * So the set thins as the view gets harder, exactly the way street-level labels
 * thin when a map is tilted toward the horizon. Priority decides who survives:
 * boundaries name whole tiers and outlive parts, parts outlive connectors, and
 * ties go to whatever is nearest the camera. Nothing is deleted — a tag hidden
 * at this angle is shown again the moment the camera moves somewhere it fits.
 */
function cull(
  items: Array<PlacedLabel & { x: number; y: number; hw: number; hh: number }>,
  camera: THREE.Camera,
): void {
  const eye = camera.getWorldPosition(new THREE.Vector3())
  const order = [...items].sort(
    (a, b) =>
      (a.rank ?? LABEL_RANK.node) - (b.rank ?? LABEL_RANK.node) ||
      a.plate.group.position.distanceToSquared(eye) -
        b.plate.group.position.distanceToSquared(eye),
  )

  const kept: typeof order = []
  for (const it of order) {
    /* A tag hanging off the edge of the picture is a name nobody can finish
       reading, and it is the first thing the eye finds because it sits alone
       against the backdrop. Dropped rather than shown truncated. */
    if (Math.abs(it.x) + it.hw > 1 || Math.abs(it.y) + it.hh > 1) {
      it.plate.group.visible = false
      it.plate.stem.visible = false
      continue
    }
    const area = 4 * it.hw * it.hh
    let worst = 0
    for (const k of kept) {
      const w = Math.min(it.x + it.hw, k.x + k.hw) - Math.max(it.x - it.hw, k.x - k.hw)
      const h = Math.min(it.y + it.hh, k.y + k.hh) - Math.max(it.y - it.hh, k.y - k.hh)
      if (w <= 0 || h <= 0) continue
      /* Judged against the *smaller* of the pair, which is the one that loses
         legibility first and is exactly what `critique` counts. Measuring only
         against the newcomer's own area lets a small tag sit almost entirely on
         top of a large one and still pass, because the damage is nearly all to
         the tag it covers. */
      const smaller = Math.min(area, 4 * k.hw * k.hh)
      if (smaller > 0) worst = Math.max(worst, (w * h) / smaller)
    }
    if (worst > CULL_OVERLAP) {
      it.plate.group.visible = false
      it.plate.stem.visible = false
      continue
    }
    kept.push(it)
  }
}

/**
 * Detach a tag.
 *
 * Nothing is disposed on purpose: the plate body comes from `roundedBox`, the
 * text quad from `plane`, the stem from `cylinder`, and all are memoised in the
 * foundry, while the texture and its material are cached here by text.
 */
export function disposeNameplate(n: Nameplate): void {
  n.group.removeFromParent()
  n.stem.removeFromParent()
}
