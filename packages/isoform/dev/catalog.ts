/**
 * M1 acceptance gate.
 *
 * Reproduces the original catalog page with every tile driven by the part
 * registry instead of an inline builder. The comparison against
 * `3d-architecture-components_1.html` is the actual test — if a part renders
 * differently, the foundry port is wrong and Phases 2-7 would inherit it.
 *
 * The scissor-rect-per-tile renderer is kept verbatim from the catalog. It is
 * the right technique for a grid of independent scenes, and it comes back in
 * the editor for palette thumbnails.
 */

import * as THREE from 'three'
import {
  CATEGORIES,
  HUE,
  collectMaterials,
  createRenderer,
  environmentTexture,
  geometryCount,
  hex6,
  makeRig,
  materialCount,
  overrideMaterials,
  resetCategoryHue,
  setCategoryHue,
  stageBackground,
  type Category,
  type IsoMaterial,
} from '../src/index.js'
import { MANIFESTS, PART_IDS, build, measure } from '../src/parts/registry.js'
import type { PartBuild, PartId } from '../src/parts/types.js'
import { LINK_META, LINK_SPECIMENS } from './connectors.js'
import { assembly } from './assembly.js'

/* ------------------------------------------------------------------ *
 * Catalog structure
 * ------------------------------------------------------------------ */

interface Row {
  id: string
  pn: string
  fin: string
  name: string
  cat: Category
  desc: string
  spec: readonly string[]
}

const partRow = (id: PartId): Row => {
  const m = MANIFESTS[id]
  return { id, pn: m.pn, fin: m.finish, name: m.name, cat: m.cat, desc: m.desc, spec: m.spec }
}

const SECTIONS: Array<{ code: string; title: string; note: string; items: Row[] }> = [
  {
    code: 'A',
    title: 'Compute',
    note: 'Anything that runs code — modelled as the hardware or glyph it maps to.',
    items: (['service', 'gateway', 'balancer', 'lambda', 'container'] as PartId[]).map(partRow),
  },
  {
    code: 'B',
    title: 'Data',
    note: 'Lathed profiles with filleted rims. The rim is the whole difference.',
    items: (['database', 'cache', 'blob', 'warehouse'] as PartId[]).map(partRow),
  },
  {
    code: 'C',
    title: 'Messaging',
    note: 'Acrylic shells so the payload stays visible while it moves.',
    items: (['queue', 'stream'] as PartId[]).map(partRow),
  },
  {
    code: 'D',
    title: 'Edge & network',
    note: 'Where traffic is shaped before it ever reaches compute.',
    items: (['cdn', 'firewall'] as PartId[]).map(partRow),
  },
  {
    code: 'E',
    title: 'Client',
    note: 'One part covers browser and handset — aspect ratio does the rest.',
    items: (['client'] as PartId[]).map(partRow),
  },
  {
    code: 'F',
    title: 'Connectors',
    note: 'Specimens only — in the engine these become routing modes crossed with styles.',
    items: LINK_META.map((l) => ({ ...l, cat: 'link' as Category })),
  },
]

/** Every builder the gate can mount, keyed the way the DOM refers to it. */
const BUILDERS: Record<string, () => PartBuild> = {
  ...Object.fromEntries(Object.keys(MANIFESTS).map((id) => [id, () => build(id as PartId)])),
  ...LINK_SPECIMENS,
  assembly,
}

/* ------------------------------------------------------------------ *
 * Markup
 * ------------------------------------------------------------------ */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const sectionsEl = document.getElementById('sections')!
for (const sec of SECTIONS) {
  const s = document.createElement('section')
  let html =
    `<div class="sec-head"><span class="code mono">${sec.code}</span>` +
    `<h2>${esc(sec.title)}</h2><p>${esc(sec.note)}</p></div><div class="grid">`

  for (const it of sec.items) {
    html +=
      `<article class="cell">` +
      `<div class="viewport" data-part="${it.id}" tabindex="0" role="img" aria-label="3D model of ${esc(it.name)}">` +
      `<span class="pn mono">${it.pn}</span>` +
      `<span class="fin mono">${esc(it.fin)}</span>` +
      `<span class="tick tl"></span><span class="tick tr"></span>` +
      `<span class="tick bl"></span><span class="tick br"></span>` +
      `</div>` +
      `<div class="meta"><h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p>` +
      `<div class="spec">` +
      `<label data-for="${it.id}" data-cat="${it.cat}" title="Base hue for ${esc(it.name)}">` +
      `<input type="color" value="${hex6(HUE[it.cat].body)}">` +
      `<span style="border:0;padding:0">${it.cat}</span>` +
      `</label>` +
      it.spec.map((v) => `<span>${esc(v)}</span>`).join('') +
      `<button class="reset" data-reset="${it.id}" data-cat="${it.cat}">Reset</button>` +
      `</div></div></article>`
  }
  s.innerHTML = html + '</div>'
  sectionsEl.appendChild(s)
}

/* ------------------------------------------------------------------ *
 * Renderer + tiles
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = createRenderer({ canvas })
renderer.setScissorTest(true)
const ENV = environmentTexture(renderer)

interface Tile {
  el: HTMLElement
  id: string
  scene: THREE.Scene
  root: THREE.Group
  cam: THREE.PerspectiveCamera
  update?: (t: number) => void
  az: number
  elev: number
  dist: number
  target: THREE.Vector3
  visible: boolean
  drag: { x: number; y: number } | null
  spin: number
}

const TILES: Tile[] = []
/** The catalog's locked camera: 32° lens, azimuth 34°, elevation 24°. */
const DEF_AZ = 0.6
const DEF_EL = 0.42

for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-part]'))) {
  const id = el.dataset.part!
  const make = BUILDERS[id]
  if (!make) continue
  const isAsm = id === 'assembly'

  const scene = new THREE.Scene()
  scene.environment = ENV
  scene.background = stageBackground()
  makeRig(scene, { bounds: isAsm ? 9 : 2.6, shadowMapSize: isAsm ? 1536 : 768 })

  const part = make()
  const pivot = new THREE.Group()
  pivot.add(part.group)
  scene.add(pivot)

  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(isAsm ? 30 : 14, isAsm ? 30 : 14),
    new THREE.ShadowMaterial({ opacity: 0.42 }),
  )
  catcher.rotation.x = -Math.PI / 2
  catcher.receiveShadow = true
  catcher.userData.isShadow = true
  scene.add(catcher)

  part.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mm = m.material as THREE.Material | undefined
    const soft = mm && (mm.transparent || mm.depthWrite === false)
    m.castShadow = !soft
    m.receiveShadow = !soft
  })

  if (!isAsm) {
    const grid = new THREE.GridHelper(9, 36, 0x2c3341, 0x1e242e)
    const gm = grid.material as THREE.Material
    gm.transparent = true
    gm.opacity = 0.5
    grid.position.y = 0.0005
    grid.userData.isGrid = true
    scene.add(grid)
  }

  const tile: Tile = {
    el,
    id,
    scene,
    root: part.group,
    cam: new THREE.PerspectiveCamera(32, 1, 0.1, 120),
    update: part.update,
    az: DEF_AZ,
    elev: DEF_EL,
    dist: part.dist,
    target: part.target,
    visible: false,
    drag: null,
    spin: 0,
  }
  TILES.push(tile)

  el.addEventListener('pointerdown', (e) => {
    tile.drag = { x: e.clientX, y: e.clientY }
    el.setPointerCapture(e.pointerId)
  })
  el.addEventListener('pointermove', (e) => {
    if (!tile.drag) return
    tile.az -= (e.clientX - tile.drag.x) * 0.0075
    tile.elev = Math.max(-0.2, Math.min(1.3, tile.elev + (e.clientY - tile.drag.y) * 0.006))
    tile.drag = { x: e.clientX, y: e.clientY }
  })
  const release = (e: PointerEvent): void => {
    if (!tile.drag) return
    tile.drag = null
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }
  el.addEventListener('pointerup', release)
  el.addEventListener('pointercancel', release)
  el.addEventListener('dblclick', () => {
    tile.az = DEF_AZ
    tile.elev = DEF_EL
    tile.spin = 0
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      tile.az += 0.18
      e.preventDefault()
    }
    if (e.key === 'ArrowRight') {
      tile.az -= 0.18
      e.preventDefault()
    }
    if (e.key === 'ArrowUp') {
      tile.elev = Math.min(1.3, tile.elev + 0.12)
      e.preventDefault()
    }
    if (e.key === 'ArrowDown') {
      tile.elev = Math.max(-0.2, tile.elev - 0.12)
      e.preventDefault()
    }
  })
}

const io = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      const t = TILES.find((x) => x.el === en.target)
      if (t) t.visible = en.isIntersecting
    }
  },
  { rootMargin: '140px' },
)
for (const t of TILES) io.observe(t.el)

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const state = { spin: !prefersReduced, sync: true, grid: true, shadow: true }

const tileById = new Map(TILES.map((t) => [t.id, t]))
const pickers = Array.from(document.querySelectorAll<HTMLInputElement>('.spec label input[type=color]'))

/** Swap a single tile onto private, retinted copies of its materials. */
function tintTileOnly(tile: Tile, cat: Category, hex: string): void {
  const sub = overrideMaterials(collectMaterials(tile.root), cat, hex)
  if (sub.size === 0) return
  tile.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.material) return
    if (Array.isArray(m.material)) {
      m.material = m.material.map((x) => sub.get(x as IsoMaterial) ?? x)
    } else {
      m.material = sub.get(m.material as IsoMaterial) ?? m.material
    }
  })
}

function applyHue(id: string, cat: Category, hex: string): void {
  if (state.sync) {
    /* The palette is a category token, so one call repaints every part in the
       category across every tile — no scene traversal at all. */
    setCategoryHue(cat, hex)
    for (const inp of pickers) {
      if ((inp.parentNode as HTMLElement).dataset.cat === cat) inp.value = hex
    }
  } else {
    const t = tileById.get(id)
    if (t) tintTileOnly(t, cat, hex)
  }
  refreshStats()
}

for (const inp of pickers) {
  const label = inp.parentNode as HTMLElement
  inp.addEventListener('input', () => {
    applyHue(label.dataset.for!, label.dataset.cat as Category, inp.value)
  })
}

for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.spec button.reset'))) {
  btn.addEventListener('click', () => {
    const cat = btn.dataset.cat as Category
    const hex = hex6(HUE[cat].body)
    if (state.sync) {
      resetCategoryHue(cat)
      for (const inp of pickers) {
        if ((inp.parentNode as HTMLElement).dataset.cat === cat) inp.value = hex
      }
    } else {
      applyHue(btn.dataset.reset!, cat, hex)
    }
    const own = document.querySelector<HTMLInputElement>(
      `.spec label[data-for="${btn.dataset.reset}"] input`,
    )
    if (own) own.value = hex
    refreshStats()
  })
}

function wire(btnId: string, key: keyof typeof state, apply?: () => void): void {
  const b = document.getElementById(btnId)!
  b.setAttribute('aria-pressed', String(state[key]))
  b.addEventListener('click', () => {
    state[key] = !state[key]
    b.setAttribute('aria-pressed', String(state[key]))
    apply?.()
  })
}

wire('btn-spin', 'spin')
wire('btn-sync', 'sync')
wire('btn-grid', 'grid', () => {
  for (const t of TILES) {
    t.scene.traverse((o) => {
      if (o.userData?.isGrid) o.visible = state.grid
    })
  }
})
wire('btn-shadow', 'shadow', () => {
  renderer.shadowMap.enabled = state.shadow
  for (const t of TILES) {
    t.scene.traverse((o) => {
      if (o.userData?.isShadow) o.visible = state.shadow
      const m = o as THREE.Mesh
      if (m.isMesh && m.material) (m.material as THREE.Material).needsUpdate = true
    })
  }
})

const statMat = document.getElementById('stat-mat')!
const statGeo = document.getElementById('stat-geo')!
function refreshStats(): void {
  statMat.textContent = String(materialCount())
  statGeo.textContent = String(geometryCount())
}
refreshStats()

/* Sanity check the tint index covers every category the page can reach. */
for (const c of CATEGORIES) {
  if (!pickers.some((p) => (p.parentNode as HTMLElement).dataset.cat === c)) {
    console.warn(`[gate] no picker for category "${c}"`)
  }
}

/* ------------------------------------------------------------------ *
 * Capture harness
 * ------------------------------------------------------------------ *
 *
 * Renders parts off-screen at the locked camera so the gate can be compared
 * against the source catalog as an image rather than by eye across two windows.
 * Also the baseline for catching regressions once Phase 7 starts merging and
 * instancing geometry.
 */

function captureTile(tile: Tile, size: number, target: THREE.WebGLRenderTarget): Uint8Array {
  const ce = Math.cos(DEF_EL)
  const se = Math.sin(DEF_EL)
  tile.cam.position.set(
    tile.target.x + tile.dist * ce * Math.sin(DEF_AZ),
    tile.target.y + tile.dist * se,
    tile.target.z + tile.dist * ce * Math.cos(DEF_AZ),
  )
  tile.cam.lookAt(tile.target)
  tile.cam.aspect = 1
  tile.cam.updateProjectionMatrix()

  renderer.setScissorTest(false)
  renderer.setRenderTarget(target)
  renderer.setViewport(0, 0, size, size)
  renderer.clear(true, true, true)
  renderer.render(tile.scene, tile.cam)

  const buf = new Uint8Array(size * size * 4)
  renderer.readRenderTargetPixels(target, 0, 0, size, size, buf)
  renderer.setRenderTarget(null)
  renderer.setScissorTest(true)
  return buf
}

/** Composite every tile into one contact sheet and return it as a data URL. */
function contactSheet(cell = 240, cols = 5): string {
  const ids = TILES.filter((t) => t.id !== 'assembly').map((t) => t.id)
  const rows = Math.ceil(ids.length / cols)
  const sheet = document.createElement('canvas')
  sheet.width = cols * cell
  sheet.height = rows * cell
  const sctx = sheet.getContext('2d')!
  sctx.fillStyle = '#0E1116'
  sctx.fillRect(0, 0, sheet.width, sheet.height)

  const rt = new THREE.WebGLRenderTarget(cell, cell, { samples: 4 })
  rt.texture.colorSpace = THREE.SRGBColorSpace

  const scratch = document.createElement('canvas')
  scratch.width = cell
  scratch.height = cell
  const cctx = scratch.getContext('2d')!

  ids.forEach((id, i) => {
    const tile = tileById.get(id)!
    const buf = captureTile(tile, cell, rt)
    const img = cctx.createImageData(cell, cell)
    /* GL reads bottom-up; flip into image order. */
    for (let y = 0; y < cell; y++) {
      const src = (cell - 1 - y) * cell * 4
      img.data.set(buf.subarray(src, src + cell * 4), y * cell * 4)
    }
    cctx.putImageData(img, 0, 0)
    sctx.drawImage(scratch, (i % cols) * cell, Math.floor(i / cols) * cell)

    sctx.fillStyle = '#5F6A7B'
    sctx.font = '11px monospace'
    sctx.fillText(id, (i % cols) * cell + 8, Math.floor(i / cols) * cell + cell - 8)
  })

  rt.dispose()
  return sheet.toDataURL('image/png')
}

/** Render one tile square, for spot checks. */
function tileImage(id: string, size = 420): string {
  const tile = tileById.get(id)
  if (!tile) throw new Error(`no tile "${id}"`)
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 })
  rt.texture.colorSpace = THREE.SRGBColorSpace
  const buf = captureTile(tile, size, rt)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    const s = (size - 1 - y) * size * 4
    img.data.set(buf.subarray(s, s + size * 4), y * size * 4)
  }
  ctx.putImageData(img, 0, 0)
  rt.dispose()
  return c.toDataURL('image/png')
}

/**
 * Footprints in the manifests are hand-declared design values, so they need
 * checking against the geometry they claim to describe.
 *
 * A footprint may legitimately be SMALLER than the measured extent — several
 * parts have decorative connector stubs that must not act as route obstacles.
 * It must never be LARGER, which would mean snapping reserves ground the part
 * does not occupy. `overhang` names the stub allowance so it stays deliberate.
 */
function footprintAudit(): Array<Record<string, unknown>> {
  return PART_IDS.map((id) => {
    const m = MANIFESTS[id]
    const b = measure(id)
    const size = b.getSize(new THREE.Vector3())
    /* Manifest values are declared to 2dp, so allow a hundredth of a unit —
       two orders below the 0.25u grid and well under the 0.06u fillet. */
    const TOL = 0.01
    const oversizedW = m.footprint.w > size.x + TOL
    const oversizedD = m.footprint.d > size.z + TOL
    /* Height means "how far above the ground plane", not total Y extent —
       several parts have plinths modelled straddling y=0 (the balancer's base
       reaches y=-0.43), which is invisible but would inflate the extent. */
    return {
      id,
      declared: [m.footprint.w, m.footprint.d, m.height],
      measured: [+size.x.toFixed(3), +size.z.toFixed(3), +b.max.y.toFixed(3)],
      minY: +b.min.y.toFixed(3),
      overhangW: +(size.x - m.footprint.w).toFixed(3),
      overhangD: +(size.z - m.footprint.d).toFixed(3),
      heightErr: +(b.max.y - m.height).toFixed(3),
      FAIL: oversizedW || oversizedD,
    }
  })
}

interface GateHandle {
  renderer: THREE.WebGLRenderer
  tiles: Tile[]
  build: typeof build
  stats(): { materials: number; geometries: number; tiles: number; calls: number }
  contactSheet(cell?: number, cols?: number): string
  tileImage(id: string, size?: number): string
  footprintAudit(): Array<Record<string, unknown>>
}

declare global {
  // eslint-disable-next-line no-var
  var __gate: GateHandle | undefined
}

globalThis.__gate = {
  renderer,
  tiles: TILES,
  build,
  stats: () => ({
    materials: materialCount(),
    geometries: geometryCount(),
    tiles: TILES.length,
    calls: renderer.info.render.calls,
  }),
  contactSheet,
  tileImage,
  footprintAudit,
}

for (const row of footprintAudit()) {
  if (row.FAIL) console.error('[gate] footprint exceeds geometry:', row)
}

/* ------------------------------------------------------------------ *
 * Loop
 * ------------------------------------------------------------------ */

let H = 0
function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  H = window.innerHeight
}
window.addEventListener('resize', resize)
resize()

const timer = new THREE.Timer()
function frame(): void {
  requestAnimationFrame(frame)
  timer.update()
  const t = timer.getElapsed()

  /* Wipe everything outside the tile rects, otherwise scrolling smears. */
  renderer.setScissorTest(false)
  renderer.clear(true, true, true)
  renderer.setScissorTest(true)

  for (const tile of TILES) {
    if (!tile.visible) continue
    const r = tile.el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > H || r.width === 0) continue

    if (state.spin && !tile.drag) tile.spin += 0.0021
    tile.update?.(t)

    const az = tile.az + tile.spin
    const ce = Math.cos(tile.elev)
    const se = Math.sin(tile.elev)
    tile.cam.position.set(
      tile.target.x + tile.dist * ce * Math.sin(az),
      tile.target.y + tile.dist * se,
      tile.target.z + tile.dist * ce * Math.cos(az),
    )
    tile.cam.lookAt(tile.target)
    tile.cam.aspect = r.width / r.height
    tile.cam.updateProjectionMatrix()

    const left = Math.floor(r.left)
    const bottom = Math.floor(H - r.bottom)
    const w = Math.floor(r.width)
    const h = Math.floor(r.height)
    renderer.setViewport(left, bottom, w, h)
    renderer.setScissor(left, bottom, w, h)
    renderer.render(tile.scene, tile.cam)
  }
}
frame()
