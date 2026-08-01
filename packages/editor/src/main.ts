/**
 * Isoform editor.
 *
 * The Doc is truth. Every user action becomes a Command run through History;
 * the Reconciler projects the resulting Doc into the scene. Nothing in this
 * file moves an Object3D to represent a change — it changes the document and
 * lets the reconciler catch up. That is what makes undo, save and load work
 * without any of them being special-cased.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  CATEGORIES,
  DSL_EXAMPLE,
  HERO_FOV,
  History,
  PRESET_POSE,
  R_LINK,
  Reconciler,
  Stage,
  clearLabelCache,
  deserialize,
  downloadDoc,
  downloadPng,
  apply as applyCommand,
  fitGroups,
  frameInset,
  frameOrtho,
  layout,
  manifestFor,
  nearestPort,
  nextId,
  palette,
  parseDsl,
  path as routePath,
  portTransform,
  renderPng,
  seedIds,
  tubeMesh,
  EDGE_KINDS,
  type CameraPreset,
  type Command,
  type Doc,
  type DocGroup,
  type DocNode,
  type EdgeKind,
  type Insets,
  type PartId,
  type PortId,
  type PortTransform,
} from '@isoform/engine'
import { PALETTE_GROUPS, partLabel, renderThumbnails } from './thumbnails.js'
import { ROT_STEP, RotateGizmo, degrees, normalizeAngle, snapAngle } from './gizmo.js'
import { SEED_DOC } from './seed.js'

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('stage') as HTMLCanvasElement
const stage = new Stage({ canvas })
const link = palette('link')

const reconciler = new Reconciler(stage.scene, { anchorIdle: link.lit('lit', 0.9) })
const anchorHot = link.lit('lit', 3.2)
const anchorIdle = link.lit('lit', 0.9)

seedIds(SEED_DOC)
const history = new History(SEED_DOC)

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

const persp = new THREE.PerspectiveCamera(HERO_FOV, 1, 0.1, 500)
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 500)

/* Both cameras start off-target. OrbitControls converts (position − target) to
   spherical coordinates in its constructor, and a zero-length offset makes that
   conversion degenerate — every later update then propagates NaN into the
   camera position, which renders an empty frame with no error anywhere. */
persp.position.set(12, 10, 18)
ortho.position.set(12, 10, 18)

let camera: THREE.Camera = persp
let controls = new OrbitControls(persp, canvas)
let preset: CameraPreset = 'hero'

function makeControls(cam: THREE.Camera): void {
  controls.dispose()
  controls = new OrbitControls(cam as THREE.PerspectiveCamera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  /* Any manual orbit means the view is no longer a named preset. */
  controls.addEventListener('start', () => setPresetButtons('free'))
}
makeControls(persp)

/** Canvas CSS size — the authority for aspect and for pointer mapping. */
function viewportSize(): { w: number; h: number } {
  const r = canvas.getBoundingClientRect()
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) }
}

function aspect(): number {
  const { w, h } = viewportSize()
  return w / h
}

/**
 * Screen area the UI chrome covers, so framing can centre on what's visible.
 * Read from the live layout rather than hardcoded, so editing the CSS cannot
 * silently desynchronise them.
 */
function chromeInsets(): Insets {
  const rail = document.getElementById('rail')!.getBoundingClientRect()
  const insp = document.getElementById('insp')!.getBoundingClientRect()
  const bar = document.querySelector('.bar')!.getBoundingClientRect()
  return { left: rail.width, right: insp.width, top: bar.height, bottom: 0 }
}

function applyPreset(next: CameraPreset, refit = true): void {
  preset = next
  const bounds = reconciler.bounds().expandByScalar(0.6)

  if (next === 'free') {
    setPresetButtons('free')
    return
  }

  const pose = PRESET_POSE[next]
  if (next === 'hero') {
    const { w, h } = viewportSize()
    const f = frameInset(bounds, pose.az, pose.el, HERO_FOV, w, h, chromeInsets())
    if (camera !== persp) {
      camera = persp
      makeControls(persp)
    }
    persp.aspect = aspect()
    persp.position.copy(f.position)
    persp.updateProjectionMatrix()
    controls.target.copy(f.target)
  } else {
    const f = frameOrtho(bounds, pose.az, pose.el, aspect())
    ortho.left = -f.halfHeight * aspect()
    ortho.right = f.halfHeight * aspect()
    ortho.top = f.halfHeight
    ortho.bottom = -f.halfHeight
    ortho.position.copy(f.position)
    ortho.updateProjectionMatrix()
    if (camera !== ortho) {
      camera = ortho
      makeControls(ortho)
    }
    controls.target.copy(f.target)
  }
  controls.update()
  setPresetButtons(next)
  if (refit) stage.fitShadow(bounds)
}

function setPresetButtons(active: CameraPreset): void {
  preset = active
  for (const k of ['hero', 'iso', 'top'] as const) {
    document.getElementById(`view-${k}`)!.setAttribute('aria-pressed', String(active === k))
  }
}

/* ------------------------------------------------------------------ *
 * Document plumbing
 * ------------------------------------------------------------------ */

const readout = document.getElementById('readout')!
const undoBtn = document.getElementById('undo') as HTMLButtonElement
const redoBtn = document.getElementById('redo') as HTMLButtonElement

/**
 * What is selected.
 *
 * A union rather than a node id: connectors are first-class objects that can be
 * selected, restyled and deleted, and treating them as a special case elsewhere
 * only pushed the branch further out.
 */
type Selection =
  | { kind: 'node'; ids: string[] }
  | { kind: 'edge'; id: string }
  | { kind: 'group'; id: string }
  | null

let selection: Selection = null
let hoverEdge: string | null = null

/** The single selected node, or null when zero or several are selected. */
const selectedNode = (): string | null =>
  selection?.kind === 'node' && selection.ids.length === 1 ? selection.ids[0] : null
const selectedNodes = (): string[] => (selection?.kind === 'node' ? selection.ids : [])
const selectedEdge = (): string | null => (selection?.kind === 'edge' ? selection.id : null)
const selectedGroup = (): string | null => (selection?.kind === 'group' ? selection.id : null)

history.subscribe((doc) => {
  reconciler.sync(doc)
  refreshDetail()
  readout.textContent = `${doc.nodes.length} parts · ${doc.edges.length} links`
  undoBtn.disabled = !history.canUndo
  redoBtn.disabled = !history.canRedo
  /* A selection can be invalidated by an undo, a load, or a cascade — a node
     going away takes its connectors with it. */
  const sel = selection
  if (sel?.kind === 'node') {
    const live = sel.ids.filter((id) => doc.nodes.some((n) => n.id === id))
    if (live.length !== sel.ids.length) selection = live.length ? { kind: 'node', ids: live } : null
  } else if (sel?.kind === 'edge' && !doc.edges.some((e) => e.id === sel.id)) {
    selection = null
  } else if (sel?.kind === 'group' && !doc.groups.some((g) => g.id === sel.id)) {
    selection = null
  }
  paintSelection()
  if (hover && !doc.nodes.some((n) => n.id === hover)) {
    hover = null
    hoverBox.fit(null)
  }
  renderInspector()
})

function run(cmd: Command, label?: string): void {
  history.run(cmd, label)
}

reconciler.sync(history.doc)
readout.textContent = `${history.doc.nodes.length} parts · ${history.doc.edges.length} links`

/* ------------------------------------------------------------------ *
 * Selection outline
 * ------------------------------------------------------------------ */

/**
 * Hover and selection outlines.
 *
 * Hover feedback is not decoration here — without it there is no way to tell
 * what a click will hit, so a miss is indistinguishable from a broken tool.
 * That was the single biggest reason selection felt unreliable.
 */
/**
 * An outline that can be turned.
 *
 * Box3Helper draws an axis-aligned box, which was fine while nothing could be
 * rotated. Once a part can be, an outline that stays square to the world while
 * the part inside it turns reads as a broken selection rather than a turned
 * part — so this is a unit wireframe placed by matrix instead.
 */
const UNIT_BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))

class OutlineBox {
  readonly line: THREE.LineSegments
  constructor(color: number) {
    this.line = new THREE.LineSegments(UNIT_BOX, new THREE.LineBasicMaterial({ color }))
    this.line.visible = false
  }
  fit(o: Outline | null): void {
    if (!o) {
      this.line.visible = false
      return
    }
    this.line.position.copy(o.centre)
    this.line.scale.copy(o.size)
    this.line.rotation.y = o.yaw
    this.line.visible = true
  }
}

interface Outline {
  centre: THREE.Vector3
  size: THREE.Vector3
  yaw: number
}

const hoverBox = new OutlineBox(0x7d8aa0)
stage.scene.add(hoverBox.line)

/** The volume a highlight should wrap, matching the part's pick volume. */
function outlineOf(id: string): Outline | null {
  const v = reconciler.views.get(id)
  if (!v) return null
  const man = manifestFor(v.last.type)
  const s = v.last.scale ?? 1
  const top = ((v.proxy.userData.pickHeight as number) ?? man.height) * s
  const y = v.last.y ?? 0
  return {
    centre: new THREE.Vector3(v.last.pos[0], y + top / 2, v.last.pos[1]),
    size: new THREE.Vector3(man.footprint.w * s, top, man.footprint.d * s),
    yaw: v.last.rot,
  }
}

function select(next: Selection): void {
  /* Remember the parts that were selected just before a boundary was, so the
     boundary panel can offer to take them in. */
  if (next?.kind === 'group' && selection?.kind === 'node') pendingForGroup = selection.ids
  else if (next?.kind === 'node') pendingForGroup = next.ids
  selection = next
  paintSelection()
  reconciler.setEdgeHighlight(hoverEdge, selectedEdge())
  refreshDetail()
  renderInspector()
}

const selectNode = (id: string | null): void => select(id ? { kind: 'node', ids: [id] } : null)

/** Toggle a node in the current multi-selection. */
function toggleNode(id: string): void {
  const cur = selection?.kind === 'node' ? selection.ids : []
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  select(next.length ? { kind: 'node', ids: next } : null)
}

/**
 * Outline every selected node, plus a group's own box when one is selected.
 *
 * Box3Helper draws a single box, so a multi-selection needs one helper per node.
 * They are pooled rather than rebuilt — a selection changes on every click.
 */
const selBoxes: OutlineBox[] = []
function paintSelection(): void {
  const ids =
    selection?.kind === 'node'
      ? selection.ids
      : selection?.kind === 'group'
        ? [selection.id]
        : []

  while (selBoxes.length < ids.length) {
    const h = new OutlineBox(0xd9ae6b)
    selBoxes.push(h)
    stage.scene.add(h.line)
  }
  ids.forEach((id, i) => {
    selBoxes[i].fit(selection?.kind === 'group' ? groupOutlineOf(id) : outlineOf(id))
  })
  for (let i = ids.length; i < selBoxes.length; i++) selBoxes[i].fit(null)
  /* Drop the hover outline off anything that just became selected. setHover only
     fires when the hovered part changes, so selecting whatever is already under
     the cursor would otherwise leave two outlines stacked on it. */
  if (hover && ids.includes(hover)) hoverBox.fit(null)
  syncGizmo()
}

/** Outline of a group boundary. Boundaries stay square to the world. */
function groupOutlineOf(id: string): Outline | null {
  const g = history.doc.groups.find((x) => x.id === id)
  if (!g) return null
  return {
    centre: new THREE.Vector3(g.pos[0], g.size[1] / 2, g.pos[1]),
    size: new THREE.Vector3(g.size[0], g.size[1], g.size[2]),
    yaw: 0,
  }
}

/* ------------------------------------------------------------------ *
 * Rotation
 * ------------------------------------------------------------------ */

const gizmo = new RotateGizmo()
stage.scene.add(gizmo.object)

/** A rotate gesture in flight. Non-null means the gizmo is being dragged. */
interface RotateDrag {
  ids: string[]
  /** Yaw of each node when the gesture started. */
  base: number[]
  /** Where each node stood when the gesture started. */
  pos: [number, number][]
  /** Point the arrangement turns about. */
  pivot: THREE.Vector3
  /** Pointer angle at grab, so the handle does not jump to the cursor. */
  from: number
  planeY: number
  /** Latest delta, so pointerup can commit what the preview already shows. */
  last: number
}
let rotateDrag: RotateDrag | null = null

/** Where the ring belongs, and how big, for the current selection. */
function gizmoTarget(): { centre: THREE.Vector3; radius: number; rot: number } | null {
  const ids = selectedNodes()
  if (!ids.length) return null

  if (ids.length === 1) {
    const n = nodeById(ids[0])
    if (!n) return null
    const f = manifestFor(n.type).footprint
    const s = n.scale ?? 1
    return {
      centre: new THREE.Vector3(n.pos[0], n.y ?? 0, n.pos[1]),
      /* Half-diagonal, so the ring clears the part at every yaw rather than
         disappearing inside it a quarter turn later. */
      radius: (Math.hypot(f.w, f.d) * s) / 2 + 0.4,
      rot: n.rot,
    }
  }

  const box = new THREE.Box2()
  for (const id of ids) {
    const n = nodeById(id)
    if (!n) continue
    const f = manifestFor(n.type).footprint
    const s = n.scale ?? 1
    box.expandByPoint(new THREE.Vector2(n.pos[0] - (f.w * s) / 2, n.pos[1] - (f.d * s) / 2))
    box.expandByPoint(new THREE.Vector2(n.pos[0] + (f.w * s) / 2, n.pos[1] + (f.d * s) / 2))
  }
  if (box.isEmpty()) return null
  const c = box.getCenter(new THREE.Vector2())
  const size = box.getSize(new THREE.Vector2())
  /* A multi-selection turns as an arrangement, so the handle starts at north
     and reads out the turn applied rather than any one part's absolute yaw. */
  return { centre: new THREE.Vector3(c.x, 0, c.y), radius: Math.hypot(size.x, size.y) / 2 + 0.4, rot: 0 }
}

function syncGizmo(): void {
  /* A drag previews the document on every move, which calls back through here.
     Refitting the ring to the previewed state would make it chase its own
     handle — and for a multi-selection, whose bounding box changes as the parts
     orbit, it would visibly crawl. The gesture owns the ring until it ends. */
  if (rotateDrag) return
  const t = gizmoTarget()
  if (!t) {
    gizmo.hide()
    return
  }
  gizmo.show(t.centre, t.radius, t.rot)
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * Turn a selection by `delta`.
 *
 * One part turns in place. Several turn as a rigid arrangement about their
 * shared centre — parts orbit the pivot *and* yaw by the same amount, which is
 * what "rotate these" means when you have a row of things selected. Rotating
 * each in place instead would leave the row pointing the same way it did.
 */
function rotateCmds(d: Pick<RotateDrag, 'ids' | 'base' | 'pos' | 'pivot'>, delta: number): Command[] {
  const c = Math.cos(delta)
  const s = Math.sin(delta)
  return d.ids.map((id, i): Command => {
    const rot = normalizeAngle(d.base[i] + delta)
    if (d.ids.length === 1) return { t: 'updateNode', id, props: { rot } }
    const dx = d.pos[i][0] - d.pivot.x
    const dz = d.pos[i][1] - d.pivot.z
    /* Matches the atan2(x, z) convention the yaw itself uses. */
    return {
      t: 'updateNode',
      id,
      props: { rot, pos: [round2(d.pivot.x + dx * c + dz * s), round2(d.pivot.z - dx * s + dz * c)] },
    }
  })
}

/** Snapshot the current selection, for either a drag or a one-shot nudge. */
function rotateBasis(): Pick<RotateDrag, 'ids' | 'base' | 'pos' | 'pivot'> | null {
  const ids = selectedNodes().filter((id) => nodeById(id))
  const t = gizmoTarget()
  if (!ids.length || !t) return null
  return {
    ids,
    base: ids.map((id) => nodeById(id)!.rot),
    pos: ids.map((id) => [...nodeById(id)!.pos] as [number, number]),
    pivot: t.centre,
  }
}

/** Rotate by a fixed step — the bracket keys and the inspector buttons. */
function rotateSelection(delta: number): void {
  const basis = rotateBasis()
  if (!basis) return
  withGroupFit(rotateCmds(basis, delta), 'rotate')
}

/** Set a single part's yaw outright, from the inspector's degree field. */
function setRotation(id: string, rad: number): void {
  withGroupFit([{ t: 'updateNode', id, props: { rot: normalizeAngle(rad) } }], 'rotate')
}

/**
 * Promote what the user is looking at to full detail.
 *
 * Everything else renders merged, which is what keeps a large diagram cheap. The
 * visible consequence: a merged part's moving pieces hold still — the cache halo
 * stops pulsing, the queue's envelopes stop travelling — and resume the instant
 * it is hovered or selected.
 */
function refreshDetail(): void {
  const focus: string[] = []
  for (const id of selectedNodes()) focus.push(id)
  if (hover) focus.push(hover)
  reconciler.updateDetail({ focus })
}

/* ------------------------------------------------------------------ *
 * Placement helpers
 * ------------------------------------------------------------------ */

const SNAP = 0.5
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/**
 * Normalised device coordinates, measured against the canvas's own box.
 *
 * Deriving these from `window.innerWidth/Height` assumes the canvas exactly
 * covers the viewport. When that assumption broke — a backing store larger than
 * the CSS box — every pick was off by the same factor, so the cursor had to sit
 * well away from a part to hit it. Reading the element's rect cannot drift.
 */
function updatePointer(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect()
  pointer.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
  /* Raycasting reads matrixWorld, which only the render loop refreshes. Testing
     before the first frame — or within a frame after something moves — would
     otherwise hit stale identity matrices. Clean nodes early-out. */
  stage.scene.updateMatrixWorld()
}

function pointerOnGround(y = 0): THREE.Vector3 | null {
  groundPlane.constant = -y
  const p = new THREE.Vector3()
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null
}

function snap(v: number, free: boolean): number {
  return free ? Math.round(v * 100) / 100 : Math.round(v / SNAP) * SNAP
}

/**
 * Footprint overlap, respecting rotation.
 *
 * Uses the separating-axis test between two oriented rectangles rather than
 * comparing axis-aligned extents: a turned part would otherwise reserve its
 * unrotated box and refuse placements that are actually clear.
 */
function collides(type: PartId, x: number, z: number, rot = 0, ignoreId?: string): boolean {
  const a = manifestFor(type).footprint
  const candidate = { cx: x, cz: z, hw: a.w / 2, hd: a.d / 2, yaw: rot }
  for (const n of history.doc.nodes) {
    if (n.id === ignoreId) continue
    const b = manifestFor(n.type).footprint
    const s = n.scale ?? 1
    const other = {
      cx: n.pos[0],
      cz: n.pos[1],
      hw: (b.w * s) / 2,
      hd: (b.d * s) / 2,
      yaw: n.rot,
    }
    if (rectsOverlap(candidate, other)) return true
  }
  return false
}

interface Rect2 {
  cx: number
  cz: number
  hw: number
  hd: number
  yaw: number
}

function rectsOverlap(a: Rect2, b: Rect2): boolean {
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]
  const project = (r: Rect2, ax: number, az: number): { min: number; max: number } => {
    const c = r.cx * ax + r.cz * az
    /* Radius of an oriented rect along an arbitrary axis. */
    const ux = Math.cos(r.yaw)
    const uz = -Math.sin(r.yaw)
    const vx = Math.sin(r.yaw)
    const vz = Math.cos(r.yaw)
    const rad = Math.abs((ux * ax + uz * az) * r.hw) + Math.abs((vx * ax + vz * az) * r.hd)
    return { min: c - rad, max: c + rad }
  }
  for (const t of axes) {
    const ax = Math.cos(t)
    const az = Math.sin(t)
    const pa = project(a, ax, az)
    const pb = project(b, ax, az)
    if (pa.max <= pb.min + 1e-3 || pb.max <= pa.min + 1e-3) return false
  }
  return true
}

/* ------------------------------------------------------------------ *
 * Ghost preview
 * ------------------------------------------------------------------ */

const ghostLayer = new THREE.Group()
stage.scene.add(ghostLayer)

const okMat = new THREE.LineBasicMaterial({ color: 0x5ce0a8 })
const badMat = new THREE.LineBasicMaterial({ color: 0xf0655f })

function footprintOutline(type: PartId, x: number, z: number, ok: boolean): THREE.LineSegments {
  const f = manifestFor(type).footprint
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(f.w, 0.02, f.d))
  const l = new THREE.LineSegments(g, ok ? okMat : badMat)
  l.position.set(x, 0.01, z)
  return l
}

/* ------------------------------------------------------------------ *
 * Interaction state
 * ------------------------------------------------------------------ */

type Mode =
  | { k: 'idle' }
  | { k: 'placing'; type: PartId; ok: boolean; at: [number, number] }
  | {
      k: 'moving'
      id: string
      start: [number, number]
      /** Offset from the node origin to the point actually grabbed. */
      grab: THREE.Vector3
      /** Height of that point. The drag plane sits here, not on the ground. */
      grabY: number
      ok: boolean
    }
  | { k: 'connecting'; from: string; port: PortId }

let mode: Mode = { k: 'idle' }
let hover: string | null = null

function clearGhost(): void {
  ghostLayer.clear()
}

function setHover(id: string | null): void {
  if (id === hover) return
  if (hover) for (const a of reconciler.anchorsOf(hover)) a.visible = false
  hover = id
  if (hover) {
    for (const a of reconciler.anchorsOf(hover)) {
      a.visible = true
      a.material = anchorIdle
    }
  }
  /* Selection already has its own outline; a second box on top reads as a bug. */
  hoverBox.fit(id && !selectedNodes().includes(id) ? outlineOf(id) : null)
  canvas.style.cursor = id ? 'grab' : ''
  refreshDetail()
}

function pickNode(): string | null {
  const hits = raycaster.intersectObjects(reconciler.proxies, false)
  return hits.length ? (hits[0].object.userData.nodeId as string) : null
}

/**
 * Nearest connector under the cursor, but only if nothing solid is in front.
 *
 * Connector pick volumes are fat and run between parts, so without the depth
 * comparison a run passing over a chassis would swallow clicks meant for it.
 */
function pickEdge(): string | null {
  const edgeHits = raycaster.intersectObjects(reconciler.edgeProxies, false)
  if (!edgeHits.length) return null
  const nodeHits = raycaster.intersectObjects(reconciler.proxies, false)
  if (nodeHits.length && nodeHits[0].distance < edgeHits[0].distance) return null
  return edgeHits[0].object.userData.edgeId as string
}

/** Boundary under the cursor, if nothing solid is in front of it. */
function pickGroup(): string | null {
  const hits = raycaster.intersectObjects(reconciler.groupProxies, false)
  return hits.length ? (hits[0].object.userData.groupId as string) : null
}

function setHoverEdge(id: string | null): void {
  if (id === hoverEdge) return
  hoverEdge = id
  reconciler.setEdgeHighlight(hoverEdge, selectedEdge())
}

function pickAnchor(): THREE.Mesh | null {
  const vis = [...reconciler.views.keys()].flatMap((k) => reconciler.anchorsOf(k)).filter((m) => m.visible)
  const hits = raycaster.intersectObjects(vis, false)
  return hits.length ? (hits[0].object as THREE.Mesh) : null
}

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

const rail = document.getElementById('rail')!
const thumbs = renderThumbnails(stage.renderer)

for (const group of PALETTE_GROUPS) {
  const h = document.createElement('h4')
  h.textContent = group.title
  rail.appendChild(h)
  const wrap = document.createElement('div')
  wrap.className = 'parts'
  for (const id of group.ids) {
    const el = document.createElement('div')
    el.className = 'part'
    el.innerHTML = `<img src="${thumbs.get(id) ?? ''}" alt=""><span>${partLabel(id)}</span>`
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      mode = { k: 'placing', type: id, ok: false, at: [0, 0] }
      canvas.style.cursor = 'copy'
    })
    wrap.appendChild(el)
  }
  rail.appendChild(wrap)
}

/* ------------------------------------------------------------------ *
 * Pointer handling
 * ------------------------------------------------------------------ */

window.addEventListener('pointermove', (e) => {
  updatePointer(e)

  if (rotateDrag) {
    const p = pointerOnGround(rotateDrag.planeY)
    if (!p) return
    const raw = gizmo.angleAt(p) - rotateDrag.from
    /* One part snaps its resulting yaw, so it lands on a clean 15° multiple no
       matter what it started at. An arrangement snaps the turn instead — the
       parts inside it keep whatever angles they were given. Alt frees both. */
    rotateDrag.last =
      rotateDrag.ids.length === 1
        ? snapAngle(rotateDrag.base[0] + raw, e.altKey) - rotateDrag.base[0]
        : snapAngle(raw, e.altKey)
    history.preview({ t: 'batch', cmds: rotateCmds(rotateDrag, rotateDrag.last) })
    const shown = (rotateDrag.ids.length === 1 ? rotateDrag.base[0] : 0) + rotateDrag.last
    gizmo.setAngle(shown)
    readout.textContent = `${degrees(shown)}°`
    return
  }

  if (mode.k === 'placing') {
    const p = pointerOnGround()
    if (!p) return
    const x = snap(p.x, e.altKey)
    const z = snap(p.z, e.altKey)
    const ok = !collides(mode.type, x, z)
    mode = { ...mode, ok, at: [x, z] }
    clearGhost()
    ghostLayer.add(footprintOutline(mode.type, x, z, ok))
    return
  }

  if (mode.k === 'moving') {
    /* Drag on the plane through the grabbed point, so the spot under the cursor
       stays under the cursor regardless of how tall the part is. */
    const p = pointerOnGround(mode.grabY)
    if (!p) return
    const x = snap(p.x - mode.grab.x, e.altKey)
    const z = snap(p.z - mode.grab.z, e.altKey)
    const moving = nodeById(mode.id)
    const ok = !collides(nodeType(mode.id), x, z, moving?.rot ?? 0, mode.id)
    mode = { ...mode, ok }
    clearGhost()
    ghostLayer.add(footprintOutline(nodeType(mode.id), x, z, ok))
    /* preview() skips the undo stack — a drag must be one entry, not hundreds. */
    history.preview({ t: 'updateNode', id: mode.id, props: { pos: [x, z] } })
    return
  }

  if (mode.k === 'connecting') {
    const src = anchorXf(mode.from, mode.port)
    if (!src) return
    const overId = pickNode()
    let target: { position: THREE.Vector3; normal: THREE.Vector3 } | null = null

    for (const k of reconciler.views.keys()) {
      for (const a of reconciler.anchorsOf(k)) a.material = k === mode.from ? anchorHot : anchorIdle
    }
    if (overId && overId !== mode.from) {
      const n = nodeById(overId)!
      const at = pointerOnGround(src.position.y) ?? src.position
      const snapped = nearestPort(n.type, new THREE.Vector3(n.pos[0], n.y ?? 0, n.pos[1]), n.rot, at)
      if (snapped) {
        target = snapped
        for (const a of reconciler.anchorsOf(overId)) {
          a.visible = true
          if (a.userData.portId === snapped.id) a.material = anchorHot
        }
      }
    } else {
      const at = pointerOnGround(src.position.y)
      if (at) target = { position: at, normal: src.normal.clone().negate() }
    }

    clearGhost()
    if (target) {
      const pts = routePath(src.position, src.normal, target.position, target.normal, 0.02)
      ghostLayer.add(
        tubeMesh(new THREE.CatmullRomCurve3(pts), R_LINK * 0.5, link.lit('lit', 1.4), 40),
      )
    }
    return
  }

  const overNode = pickNode()
  setHover(overNode)
  const overEdge = overNode ? null : pickEdge()
  setHoverEdge(overEdge)
  if (!overNode && overEdge) canvas.style.cursor = 'pointer'
})

/**
 * Capture phase, so this runs before OrbitControls' own listener on the same
 * element. When the gesture belongs to a part, propagation stops and the orbit
 * never starts — otherwise a click-drag both selected and swung the camera.
 */
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0) return
    updatePointer(e)
    if (mode.k === 'placing') return

    /* The gizmo is tested first. It only exists around what is already
       selected, and its ring overhangs that part's own pick volume — losing
       that race would make the ring unusable on anything wider than it. */
    if (gizmo.visible && raycaster.intersectObjects(gizmo.handles, false).length) {
      const basis = rotateBasis()
      const p = pointerOnGround(gizmo.planeY)
      if (basis && p) {
        rotateDrag = { ...basis, from: gizmo.angleAt(p), planeY: gizmo.planeY, last: 0 }
        reconciler.interactive = true
        controls.enabled = false
        canvas.style.cursor = 'grabbing'
        e.stopPropagation()
        return
      }
    }

    const anchor = pickAnchor()
    if (anchor) {
      mode = {
        k: 'connecting',
        from: anchor.userData.nodeId as string,
        port: anchor.userData.portId as PortId,
      }
      controls.enabled = false
      e.stopPropagation()
      return
    }

    const hit = raycaster.intersectObjects(reconciler.proxies, false)[0]
    if (hit) {
      const id = hit.object.userData.nodeId as string
      /* Shift extends the selection — the prerequisite for grouping. */
      if (e.shiftKey) {
        toggleNode(id)
        e.stopPropagation()
        return
      }
      if (!selectedNodes().includes(id)) selectNode(id)
      hoverBox.fit(null)
      const n = nodeById(id)!
      /* Grab on the plane through the point actually clicked, not the ground.
         Dragging on y=0 while holding the top of a tall part makes the object
         lag the cursor by the parallax between the two heights — which is what
         made dragging feel disconnected. */
      mode = {
        k: 'moving',
        id,
        start: [n.pos[0], n.pos[1]],
        grab: new THREE.Vector3(hit.point.x - n.pos[0], 0, hit.point.z - n.pos[1]),
        grabY: hit.point.y,
        ok: true,
      }
      /* Routes may be reused loosely for the duration of the drag; the commit
         below runs an exact pass. */
      reconciler.interactive = true
      controls.enabled = false
      canvas.style.cursor = 'grabbing'
      e.stopPropagation()
      return
    }

    /* Nothing solid under the cursor: a connector may still be. */
    const edgeId = pickEdge()
    if (edgeId) {
      select({ kind: 'edge', id: edgeId })
      e.stopPropagation()
      return
    }
    /* Boundaries are picked last, so clicking a part inside one selects the
       part. Only clicking the enclosure itself selects the enclosure. */
    const groupId = pickGroup()
    if (groupId) {
      select({ kind: 'group', id: groupId })
      e.stopPropagation()
      return
    }
    select(null)
  },
  { capture: true },
)

window.addEventListener('pointerup', (e) => {
  updatePointer(e)

  if (rotateDrag) {
    const d = rotateDrag
    rotateDrag = null
    controls.enabled = true
    reconciler.interactive = false
    canvas.style.cursor = hover ? 'grab' : ''
    /* Rewind the un-recorded preview, then record the whole gesture as one
       command — a turn is one undo step, not one per frame. */
    history.preview({
      t: 'batch',
      cmds: d.ids.map((id, i): Command => ({
        t: 'updateNode',
        id,
        props: { rot: d.base[i], pos: d.pos[i] },
      })),
    })
    if (Math.abs(d.last) > 1e-4) withGroupFit(rotateCmds(d, d.last), 'rotate')
    else syncGizmo()
    return
  }

  if (mode.k === 'placing') {
    const overCanvas = (e.target as HTMLElement) === canvas
    if (overCanvas && mode.ok) {
      const node: DocNode = {
        id: nextId('n'),
        type: mode.type,
        pos: [mode.at[0], mode.at[1]],
        rot: 0,
      }
      run({ t: 'addNode', node }, `add ${mode.type}`)
      selectNode(node.id)
    }
    clearGhost()
    mode = { k: 'idle' }
    canvas.style.cursor = ''
    return
  }

  if (mode.k === 'moving') {
    const m = mode
    const cur = nodeById(m.id)
    clearGhost()
    controls.enabled = true
    canvas.style.cursor = hover ? 'grab' : ''
    /* Back to exact routing before the committed state is rendered or saved. */
    reconciler.interactive = false
    if (cur) {
      const end: [number, number] = [cur.pos[0], cur.pos[1]]
      /* Rewind the un-recorded preview, then record the whole gesture as a
         single command, so one drag is one undo step. A rejected drop simply
         stops at the rewind. */
      history.preview({ t: 'updateNode', id: m.id, props: { pos: m.start } })
      if (m.ok && (end[0] !== m.start[0] || end[1] !== m.start[1])) {
        withGroupFit([{ t: 'updateNode', id: m.id, props: { pos: end } }], 'move')
      }
    }
    mode = { k: 'idle' }
    return
  }

  if (mode.k === 'connecting') {
    const overId = pickNode()
    clearGhost()
    controls.enabled = true
    if (overId && overId !== mode.from) {
      run(
        {
          t: 'addEdge',
          edge: {
            id: nextId('e'),
            from: { node: mode.from, port: mode.port },
            to: { node: overId },
            kind: 'sync',
            route: 'auto',
          },
        },
        'connect',
      )
    }
    for (const k of reconciler.views.keys()) {
      for (const a of reconciler.anchorsOf(k)) {
        a.material = anchorIdle
        a.visible = false
      }
    }
    hover = null
    mode = { k: 'idle' }
  }
})

function nodeById(id: string): DocNode | undefined {
  return history.doc.nodes.find((n) => n.id === id)
}

function nodeType(id: string): PartId {
  return nodeById(id)!.type
}

function anchorXf(id: string, port: PortId): PortTransform | null {
  const n = nodeById(id)
  if (!n) return null
  return portTransform(n.type, port, new THREE.Vector3(n.pos[0], n.y ?? 0, n.pos[1]), n.rot)
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
  if (typing) return

  if (e.key === 'Escape') {
    clearGhost()
    controls.enabled = true
    mode = { k: 'idle' }
    canvas.style.cursor = ''
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) history.redo()
    else history.undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    history.redo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    duplicate()
    return
  }
  if (e.key === 'f' || e.key === 'F') {
    applyPreset(preset === 'free' ? 'hero' : preset)
    return
  }
  if (!selection) return

  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelection()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
    e.preventDefault()
    if (e.shiftKey) ungroupSelection()
    else groupSelection()
    return
  }
  if (e.key === '[' || e.key === ']') {
    rotateSelection(ROT_STEP * (e.key === ']' ? 1 : -1))
  }
})

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

/**
 * Group commands with the boundary refits they imply.
 *
 * A boundary's box is derived from its members, so anything that moves, adds or
 * removes a member has to resize it in the same breath. Emitting it as one batch
 * keeps the document consistent at every point in the undo stack — a half-applied
 * state where a part has moved but its tier has not would be visible.
 */
function withGroupFit(cmds: Command[], label: string): void {
  if (!cmds.length) return
  const after = cmds.reduce((d, c) => applyCommand(d, c), history.doc)
  const fits: Command[] = []
  for (const g of fitGroups(after)) {
    const was = after.groups.find((x) => x.id === g.id)
    if (!was) continue
    if (was.pos.join() !== g.pos.join() || was.size.join() !== g.size.join()) {
      fits.push({ t: 'updateGroup', id: g.id, props: { pos: g.pos, size: g.size } })
    }
  }
  run({ t: 'batch', cmds: [...cmds, ...fits] }, label)
}

/**
 * Wrap the selected parts in a boundary.
 *
 * A group already selected becomes a member instead, which is how a tier gets
 * nested inside a larger one.
 */
function groupSelection(): void {
  const ids = selectedNodes()
  const inner = selectedGroup()
  const members = inner ? [inner] : ids
  if (members.length < 1) return

  const cat = ids.length ? manifestFor(nodeById(ids[0])!.type).cat : 'compute'
  const group: DocGroup = {
    id: nextId('g'),
    label: 'Group',
    pos: [0, 0],
    size: [4, 1.5, 4],
    cat,
    members,
  }
  withGroupFit([{ t: 'addGroup', group }], 'group')
  select({ kind: 'group', id: group.id })
}

/** Remove the selected boundary, leaving what it contained in place. */
function ungroupSelection(): void {
  const id = selectedGroup()
  if (!id) return
  const g = history.doc.groups.find((x) => x.id === id)
  run({ t: 'removeGroup', id }, 'ungroup')
  /* Put the selection on what came out, so the next action has a target. */
  const nodes = (g?.members ?? []).filter((m) => history.doc.nodes.some((n) => n.id === m))
  select(nodes.length ? { kind: 'node', ids: nodes } : null)
}

/** Add or remove the selected parts from a boundary. */
function setGroupMembers(id: string, members: string[]): void {
  withGroupFit([{ t: 'updateGroup', id, props: { members } }], 'membership')
}

function deleteSelection(): void {
  const sel = selection
  if (!sel) return
  if (sel.kind === 'edge') {
    run({ t: 'removeEdge', id: sel.id }, 'delete link')
  } else if (sel.kind === 'group') {
    run({ t: 'removeGroup', id: sel.id }, 'delete group')
  } else {
    /* Deleting members shrinks whatever contained them. */
    withGroupFit(
      sel.ids.map((id): Command => ({ t: 'removeNode', id })),
      sel.ids.length > 1 ? `delete ${sel.ids.length}` : 'delete',
    )
  }
  select(null)
}

function duplicate(): void {
  const id = selectedNode()
  if (!id) return
  const n = nodeById(id)
  if (!n) return
  let x = n.pos[0] + 1
  const z = n.pos[1] + 1
  while (collides(n.type, x, z, n.rot)) x += 1
  const copy: DocNode = { ...n, id: nextId('n'), pos: [x, z] }
  run({ t: 'addNode', node: copy }, 'duplicate')
  selectNode(copy.id)
}

/* ------------------------------------------------------------------ *
 * Inspector
 * ------------------------------------------------------------------ */

const inspTitle = document.getElementById('insp-title')!
const inspBody = document.getElementById('insp-body')!

/**
 * Colours a boundary may take.
 *
 * Derived from the engine's category list rather than spelled out, so a new
 * category shows up here on its own. `link` is the connector palette, not a
 * thing a group can be, so it is the one exclusion.
 */
const GROUP_CATS = CATEGORIES.filter((c) => c !== 'link')

const KIND_LABEL: Record<EdgeKind, string> = {
  sync: 'Synchronous call',
  async: 'Async message',
  duplex: 'Bidirectional',
  flow: 'Data flow',
  secure: 'Encrypted channel',
}

/** Connector panel: what it joins, how it is drawn, and how to remove it. */
function renderEdgeInspector(id: string): void {
  const e = history.doc.edges.find((x) => x.id === id)
  if (!e) {
    select(null)
    return
  }
  const nameOf = (nid: string): string => {
    const n = nodeById(nid)
    return n ? (n.label ?? manifestFor(n.type).name) : nid
  }
  inspTitle.textContent = 'Connector'
  inspBody.innerHTML = `
    <div class="row"><label>From</label><span>${escapeHtml(nameOf(e.from.node))}</span></div>
    <div class="row"><label>To</label><span>${escapeHtml(nameOf(e.to.node))}</span></div>
    <div class="row"><label>Style</label>
      <select id="i-kind">
        ${EDGE_KINDS.map(
          (k) => `<option value="${k}"${k === e.kind ? ' selected' : ''}>${KIND_LABEL[k]}</option>`,
        ).join('')}
      </select></div>
    <div class="row"><label>Route</label><span class="mono">${e.route}</span></div>
    <div class="row"><button class="t" id="i-del">Delete link</button></div>`

  const kindEl = document.getElementById('i-kind') as HTMLSelectElement
  kindEl.addEventListener('change', () => {
    run({ t: 'updateEdge', id, props: { kind: kindEl.value as EdgeKind } }, 'link style')
  })
  document.getElementById('i-del')!.addEventListener('click', () => {
    run({ t: 'removeEdge', id }, 'delete link')
    select(null)
  })
}

/**
 * Boundary panel: what it holds, and how to change that.
 *
 * Membership is edited from here rather than by dragging parts in and out of the
 * volume, because "inside the box" is a consequence of the box being fitted to
 * its members, not the definition of membership. Inferring one from the other
 * would make a part join a tier just by being moved near it.
 */
function renderGroupInspector(id: string): void {
  const g = history.doc.groups.find((x) => x.id === id)
  if (!g) {
    select(null)
    return
  }
  const members = g.members ?? []
  const nameOf = (mid: string): string => {
    const n = nodeById(mid)
    if (n) return n.label ?? manifestFor(n.type).name
    const inner = history.doc.groups.find((x) => x.id === mid)
    return inner ? `▣ ${inner.label ?? 'Group'}` : mid
  }

  inspTitle.textContent = 'Group'
  inspBody.innerHTML = `
    <div class="row"><label>Label</label><input type="text" id="i-glabel" value="${escapeHtml(g.label ?? '')}"></div>
    <div class="row"><label>Colour</label>
      <select id="i-gcat">
        ${GROUP_CATS.map(
          (c) => `<option value="${c}"${c === g.cat ? ' selected' : ''}>${c}</option>`,
        ).join('')}
      </select></div>
    <div class="row"><label>Holds</label><span>${members.length} item${members.length === 1 ? '' : 's'}</span></div>
    <p class="hint">${members.map((m) => escapeHtml(nameOf(m))).join(', ') || 'Nothing yet'}</p>
    <div class="row"><button class="t" id="i-gadd">Add selection</button></div>
    <div class="row"><button class="t" id="i-gungroup">Ungroup</button>
      <button class="t" id="i-gdel">Delete</button></div>
    <p class="hint">Select parts, then reopen this panel to add them.
      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> ungroups.</p>`

  const labelEl = document.getElementById('i-glabel') as HTMLInputElement
  labelEl.addEventListener('change', () => {
    run({ t: 'updateGroup', id, props: { label: labelEl.value || (null as never) } }, 'group label')
  })
  const catEl = document.getElementById('i-gcat') as HTMLSelectElement
  catEl.addEventListener('change', () => {
    run({ t: 'updateGroup', id, props: { cat: catEl.value as DocGroup['cat'] } }, 'group colour')
  })
  document.getElementById('i-gadd')!.addEventListener('click', () => {
    if (!pendingForGroup.length) return
    const next = [...new Set([...members, ...pendingForGroup])]
    setGroupMembers(id, next)
  })
  document.getElementById('i-gungroup')!.addEventListener('click', ungroupSelection)
  document.getElementById('i-gdel')!.addEventListener('click', () => {
    run({ t: 'removeGroup', id }, 'delete group')
    select(null)
  })
}

/**
 * Nodes selected immediately before a boundary was selected.
 *
 * Selecting the boundary necessarily clears the part selection, so "add these to
 * that" needs the previous selection remembered rather than requiring a modifier
 * the user has to know about.
 */
let pendingForGroup: string[] = []

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderInspector(): void {
  const edgeId = selectedEdge()
  if (edgeId) {
    renderEdgeInspector(edgeId)
    return
  }
  const groupId = selectedGroup()
  if (groupId) {
    renderGroupInspector(groupId)
    return
  }
  const many = selectedNodes()
  if (many.length > 1) {
    inspTitle.textContent = `${many.length} parts selected`
    inspBody.innerHTML =
      `<p class="hint">${many
        .map((id) => escapeHtml(nodeById(id)?.label ?? manifestFor(nodeById(id)!.type).name))
        .join(', ')}</p>` +
      `<div class="row"><label>Turn</label>
        <button class="t sq" id="i-rot-l" title="Rotate 15° left">↺</button>
        <button class="t sq" id="i-rot-r" title="Rotate 15° right">↻</button></div>` +
      `<div class="row"><button class="t" id="i-group">Group these</button></div>` +
      `<p class="hint">Or press <kbd>Ctrl</kbd>+<kbd>G</kbd>. Turning several parts
        swings them around their shared centre.</p>`
    document.getElementById('i-rot-l')!.addEventListener('click', () => rotateSelection(-ROT_STEP))
    document.getElementById('i-rot-r')!.addEventListener('click', () => rotateSelection(ROT_STEP))
    document.getElementById('i-group')!.addEventListener('click', groupSelection)
    return
  }
  const n = selectedNode() ? nodeById(selectedNode()!) : null
  if (!n) {
    inspTitle.textContent = 'Nothing selected'
    inspBody.innerHTML =
      '<p class="hint">Drag a part from the left onto the grid.<br><br>' +
      'Hover a placed part to reveal its four connector anchors, then drag from one onto another part.' +
      '<br><br>Click a connector to select it — <kbd>Del</kbd> removes it.</p>'
    return
  }
  const man = manifestFor(n.type)
  inspTitle.textContent = `${man.pn} · ${man.name}`
  inspBody.innerHTML = `
    <div class="row"><label>Label</label><input type="text" id="i-label" value="${n.label ?? ''}"></div>
    <div class="row"><label>Tint</label>
      <input type="color" id="i-tint" value="${n.tint ?? '#8b92ff'}">
      <button class="t" id="i-tint-reset">Reset</button></div>
    <div class="row"><label>Rot</label>
      <button class="t sq" id="i-rot-l" title="Rotate 15° left">↺</button>
      <input type="text" class="num mono" id="i-rot" value="${degrees(n.rot)}">
      <button class="t sq" id="i-rot-r" title="Rotate 15° right">↻</button></div>
    <div class="row"><label>Pos</label><span class="mono">${n.pos[0]}, ${n.pos[1]}</span></div>
    <p class="hint">Or drag the ring around the part. <kbd>Alt</kbd> turns freely,
      otherwise it snaps to 15°.</p>`

  const labelEl = document.getElementById('i-label') as HTMLInputElement
  labelEl.addEventListener('change', () => {
    run({ t: 'updateNode', id: n.id, props: { label: labelEl.value || (null as never) } }, 'label')
  })
  const tintEl = document.getElementById('i-tint') as HTMLInputElement
  tintEl.addEventListener('change', () => {
    run({ t: 'updateNode', id: n.id, props: { tint: tintEl.value } }, 'tint')
  })
  document.getElementById('i-tint-reset')!.addEventListener('click', () => {
    run({ t: 'updateNode', id: n.id, props: { tint: null as never } }, 'tint')
  })
  document.getElementById('i-rot-l')!.addEventListener('click', () => rotateSelection(-ROT_STEP))
  document.getElementById('i-rot-r')!.addEventListener('click', () => rotateSelection(ROT_STEP))
  const rotEl = document.getElementById('i-rot') as HTMLInputElement
  rotEl.addEventListener('change', () => {
    const deg = Number.parseFloat(rotEl.value.replace(/[^-\d.]/g, ''))
    /* An unreadable entry redraws the panel, which puts the real angle back —
       quieter than an alert, and it cannot leave the field lying. */
    if (!Number.isFinite(deg)) renderInspector()
    else setRotation(n.id, (deg * Math.PI) / 180)
  })
}
renderInspector()

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

undoBtn.addEventListener('click', () => history.undo())
redoBtn.addEventListener('click', () => history.redo())
document.getElementById('fit')!.addEventListener('click', () => applyPreset(preset === 'free' ? 'hero' : preset))
for (const k of ['hero', 'iso', 'top'] as const) {
  document.getElementById(`view-${k}`)!.addEventListener('click', () => applyPreset(k))
}
const gridBtn = document.getElementById('grid')!
gridBtn.addEventListener('click', () => {
  const on = gridBtn.getAttribute('aria-pressed') !== 'true'
  gridBtn.setAttribute('aria-pressed', String(on))
  stage.setGridVisible(on)
})
const labelsBtn = document.getElementById('labels')!
labelsBtn.addEventListener('click', () => {
  const on = labelsBtn.getAttribute('aria-pressed') !== 'true'
  labelsBtn.setAttribute('aria-pressed', String(on))
  reconciler.setLabelsVisible(on)
})

/**
 * Tidy — lay the whole diagram out, as one undo step.
 *
 * A batch rather than a command per node, so a mis-aimed Tidy on a hand-placed
 * diagram costs a single Ctrl+Z rather than sixty.
 */
document.getElementById('tidy')!.addEventListener('click', () => {
  const doc = history.doc
  if (!doc.nodes.length) return
  const { positions } = layout(doc)
  const cmds: Command[] = []
  for (const n of doc.nodes) {
    const p = positions.get(n.id)
    if (p && (p[0] !== n.pos[0] || p[1] !== n.pos[1])) {
      cmds.push({ t: 'updateNode', id: n.id, props: { pos: p } })
    }
  }
  /* Groups are derived from where their members ended up. */
  const placed = { ...doc, nodes: doc.nodes.map((n) => ({ ...n, pos: positions.get(n.id) ?? n.pos })) }
  for (const g of fitGroups(placed)) {
    const was = doc.groups.find((x) => x.id === g.id)
    if (was && (was.pos.join() !== g.pos.join() || was.size.join() !== g.size.join())) {
      cmds.push({ t: 'updateGroup', id: g.id, props: { pos: g.pos, size: g.size } })
    }
  }
  if (!cmds.length) return
  run({ t: 'batch', cmds }, 'tidy')
  applyPreset(preset === 'free' ? 'hero' : preset)
})

/* ---- text sheet ---- */
const sheet = document.getElementById('dsl-sheet')!
const dslText = document.getElementById('dsl-text') as HTMLTextAreaElement
const dslStatus = document.getElementById('dsl-status')!
dslText.value = DSL_EXAMPLE

document.getElementById('dsl')!.addEventListener('click', () => sheet.classList.toggle('hidden'))
document.getElementById('dsl-close')!.addEventListener('click', () => sheet.classList.add('hidden'))
document.getElementById('dsl-apply')!.addEventListener('click', () => {
  const { doc: parsed, issues } = parseDsl(dslText.value)
  if (issues.length) {
    dslStatus.textContent = `${issues.length} issue(s): ` + issues.map((i) => `line ${i.line} ${i.message}`).join(' · ')
    dslStatus.classList.add('bad')
  } else {
    dslStatus.textContent = `${parsed.nodes.length} parts · ${parsed.edges.length} links`
    dslStatus.classList.remove('bad')
  }
  if (!parsed.nodes.length) return

  /* Text carries no positions, so a parsed document is laid out before it is
     ever shown — the whole point is describing a system without placing it. */
  const { positions } = layout(parsed)
  const placed: Doc = {
    ...parsed,
    nodes: parsed.nodes.map((n) => ({ ...n, pos: positions.get(n.id) ?? n.pos })),
  }
  placed.groups = fitGroups(placed)
  seedIds(placed)
  history.reset(placed)
  select(null)
  applyPreset('hero')
  sheet.classList.add('hidden')
})

document.getElementById('png')!.addEventListener('click', () => {
  /* Hide the editor's own scaffolding; a published diagram wants the parts. */
  const url = renderPng(stage.renderer, stage.scene, camera, {
    width: 3840,
    aspect: aspect(),
    /* ...selBoxes too: a selection outline is scaffolding, and leaving it in a
       published image was a real defect, just a quiet one. */
    hide: [
      stage.grid,
      reconciler.anchorLayer,
      ghostLayer,
      gizmo.object,
      hoverBox.line,
      ...selBoxes.map((b) => b.line),
    ],
  })
  downloadPng(url, 'diagram.png')
})

document.getElementById('save')!.addEventListener('click', () => downloadDoc(history.doc))
const fileEl = document.getElementById('file') as HTMLInputElement
document.getElementById('load')!.addEventListener('click', () => fileEl.click())
fileEl.addEventListener('change', async () => {
  const f = fileEl.files?.[0]
  if (!f) return
  try {
    const doc: Doc = deserialize(await f.text())
    history.reset(doc)
    select(null)
    applyPreset('hero')
  } catch (err) {
    console.error(err)
    alert(`Could not load: ${(err as Error).message}`)
  }
  fileEl.value = ''
})

/* ------------------------------------------------------------------ *
 * Loop
 * ------------------------------------------------------------------ */

function resize(): void {
  /* Measure the canvas rather than the window: CSS owns the element's size, and
     these two only agree while the layout is settled. */
  const { w, h } = viewportSize()
  stage.resize(w, h)
  persp.aspect = w / h
  persp.updateProjectionMatrix()
  if (camera === ortho) applyPreset(preset === 'free' ? 'iso' : preset, false)
}

/**
 * Drive sizing from the element, not the window `resize` event.
 *
 * The pane can report a zero-sized viewport on first paint and then lay out
 * without ever firing `resize`, which left the canvas stuck at its initial
 * dimensions. Observing the canvas self-corrects whenever layout settles.
 */
let framedOnce = false
function frameWhenReady(): void {
  const { w, h } = viewportSize()
  if (w < 2 || h < 2 || framedOnce) return
  framedOnce = true
  applyPreset('hero')
}

const ro = new ResizeObserver(() => {
  const { w, h } = viewportSize()
  if (w < 2 || h < 2) return
  resize()
  frameWhenReady()
})
ro.observe(canvas)
window.addEventListener('resize', resize)

resize()
/* Frame straight away when layout is already settled. The observer alone is not
   enough — it only delivers at paint time, so a background or hidden tab would
   open on an unframed camera and stay there. */
frameWhenReady()

/**
 * Nameplates are measured with canvas text, so a plate built before its webfont
 * arrives is sized for the fallback face and stays that way. Drop the label
 * cache once fonts settle and re-sync to rebuild them at the right size.
 */
void document.fonts?.ready.then(() => {
  clearLabelCache()
  reconciler.rebuildLabels()
})

const timer = new THREE.Timer()
stage.renderer.setAnimationLoop(() => {
  timer.update()
  reconciler.tick(timer.getElapsed())
  controls.update()
  /* Labels track the view, not the document, so they update per frame. */
  reconciler.orientLabels(camera)
  stage.renderer.render(stage.scene, camera)
})

if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    __iso: {
      stage,
      reconciler,
      history,
      get camera() {
        return camera
      },
      controls,
      applyPreset,
      select,
      run,
      get doc() {
        return history.doc
      },
      stats: () => ({ ...stage.renderer.info.render, memory: { ...stage.renderer.info.memory } }),
      render: () => stage.renderer.render(stage.scene, camera),
      /* Off-screen capture. The pane does not composite when it is hidden, so a
         real screenshot comes back blank; rendering to a target and reading the
         pixels back is the only way to see what the scene actually looks like. */
      shot: (width = 1400, keepGizmo = true) =>
        renderPng(stage.renderer, stage.scene, camera, {
          width,
          aspect: aspect(),
          hide: [reconciler.anchorLayer, ghostLayer, ...(keepGizmo ? [] : [gizmo.object])],
        }),
      refreshDetail,
      perf: () => ({
        nodes: history.doc.nodes.length,
        edges: history.doc.edges.length,
        nodeDrawCalls: reconciler.nodeDrawCalls(),
        renderCalls: stage.renderer.info.render.calls,
        triangles: stage.renderer.info.render.triangles,
        geometries: stage.renderer.info.memory.geometries,
        routesRecomputed: reconciler.lastRoutesRecomputed,
        edgesRetubed: reconciler.lastRebuildCount,
      }),
    },
  })
}
