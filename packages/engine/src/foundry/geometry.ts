/**
 * Geometry toolkit — ported from catalog section 3, deliberately unchanged.
 *
 * These functions ARE the design spec. The catalog's "locked before any new
 * part ships" list is expressed here in code:
 *
 *   · FILLET 0.06u on every hard edge — zero perfectly sharp edges
 *   · tube radius 0.05u, arrowhead 2.5× radius
 *   · 0.28u corner rounding on orthogonal routes (see elbowCurve callers)
 *
 * The router in route/ calls `elbowCurve`, `tubeMesh` and `arrowHead` directly,
 * so any "improvement" here silently redefines the visual language. Don't.
 */

import * as THREE from 'three'
import { shadowTexture } from './textures.js'

export type Triple = [number, number, number]

/* ------------------------------------------------------------------ *
 * Geometry cache
 * ------------------------------------------------------------------ *
 *
 * Every parametric primitive below is memoised on its arguments, so building
 * the same part fifty times produces fifty lightweight Mesh objects over one
 * shared set of BufferGeometry.
 *
 * This is what replaces a build-once/clone-the-prototype scheme. Cloning would
 * share geometry too, but a part's `update` closure captures the prototype's
 * own meshes and materials, so every clone would animate the prototype rather
 * than itself — every cache node in a diagram pulsing in lockstep. Memoising at
 * this level keeps the builders as plain, readable constructors while still
 * paying for each distinct geometry exactly once.
 *
 * CACHED GEOMETRY IS SHARED AND MUST NOT BE MUTATED OR DISPOSED by a caller.
 */

const geoCache = new Map<string, THREE.BufferGeometry>()

function memo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key)
  if (hit) return hit as T
  const g = make()
  geoCache.set(key, g)
  return g
}

/** Diagnostics — distinct geometries currently held. */
export function geometryCount(): number {
  return geoCache.size
}

/** Test seam. Frees every cached geometry; callers must rebuild their scenes. */
export function clearGeometryCache(): void {
  for (const g of geoCache.values()) g.dispose()
  geoCache.clear()
}

/** Global fillet radius. Real objects have no perfectly sharp edges. */
export const FILLET = 0.06

/** Connector tube radius. One radius system-wide. */
export const R_LINK = 0.05

/** Corner rounding for orthogonal routes. */
export const ELBOW_R = 0.28

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z)

/**
 * Segments to spend on a fillet of radius `r`.
 *
 * Every rounded box used to be extruded at a flat 12 curve segments and 3 bevel
 * segments, whatever its size. A 0.008u corner — a couple of pixels at any
 * framing a diagram is actually read at — was therefore costing the same as a
 * 0.2u one, and `roundedBox` is the most-used primitive in the catalog by an
 * order of magnitude. Two of the heaviest parts were ~40k triangles each,
 * almost entirely corner rounding nobody can see.
 *
 * Tied to arc length rather than to a constant: a fillet subtends the same
 * screen angle regardless of the box it belongs to, so segments should follow
 * the radius and nothing else. The ceiling stays 12, so the largest fillets are
 * bit-for-bit what they were.
 */
export function filletSegments(r: number, max = 12): number {
  /* Floor of 4, not 2. Subdivision inscribes the arc, so a corner cut too
     coarsely does not merely look faceted — it measurably shrinks the part. At
     two segments the client's panel lost 25mm of its 1.56u width, enough to
     break the footprint invariant. Four holds every part inside the 0.02u the
     manifest test allows while still cutting the smallest fillets by 3×. */
  return Math.max(4, Math.min(max, Math.round(r * 56)))
}

/**
 * Box with rounded verticals and a bevelled top/bottom edge. Built as an
 * extruded rounded rectangle rather than a BoxGeometry so the fillet is real
 * geometry that catches a highlight, not a normal-map trick.
 */
export function roundedBox(
  w: number,
  h: number,
  d: number,
  r = 0.1,
  bevArg: number = FILLET * 0.5,
): THREE.ExtrudeGeometry {
  return memo(`rb|${w}|${h}|${d}|${r}|${bevArg}`, () => buildRoundedBox(w, h, d, r, bevArg))
}

function buildRoundedBox(
  w: number,
  h: number,
  d: number,
  r: number,
  bev: number,
): THREE.ExtrudeGeometry {
  bev = Math.min(bev, r * 0.85, h * 0.24, w * 0.24, d * 0.24)
  const W = w - 2 * bev
  const D = d - 2 * bev
  const R = Math.max(0.002, r - bev)
  const s = new THREE.Shape()
  const x = -W / 2
  const y = -D / 2
  s.moveTo(x + R, y)
  s.lineTo(x + W - R, y)
  s.quadraticCurveTo(x + W, y, x + W, y + R)
  s.lineTo(x + W, y + D - R)
  s.quadraticCurveTo(x + W, y + D, x + W - R, y + D)
  s.lineTo(x + R, y + D)
  s.quadraticCurveTo(x, y + D, x, y + D - R)
  s.lineTo(x, y + R)
  s.quadraticCurveTo(x, y, x + R, y)
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - 2 * bev),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    /* Both tied to the feature they describe — see `filletSegments`. The bevel
       is a smaller radius than the corner and gets proportionally fewer. */
    bevelSegments: filletSegments(bev, 3),
    curveSegments: filletSegments(R),
  })
  g.translate(0, 0, -(h / 2 - bev))
  g.rotateX(-Math.PI / 2)
  g.computeVertexNormals()
  return g
}

/**
 * A Shape cannot be cheaply hashed, so memoisation here is opt-in: pass `key`
 * when the shape is a constant of the part (the gateway arch, the cache bolt,
 * the queue envelope flap) and it will be built once for the whole document.
 */
export function extrudeShape(
  shape: THREE.Shape,
  depth: number,
  bev = 0.02,
  key?: string,
): THREE.ExtrudeGeometry {
  const make = (): THREE.ExtrudeGeometry => {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bev,
      bevelSize: bev,
      bevelSegments: 3,
      curveSegments: 14,
    })
    g.center()
    return g
  }
  return key ? memo(`ex|${key}|${depth}|${bev}`, make) : make()
}

/** Lathed cylinder with filleted top and bottom rims. The rim is the whole difference. */
export function drum(radius: number, height: number, fillet = 0.07, seg = 72): THREE.LatheGeometry {
  return memo(`dr|${radius}|${height}|${fillet}|${seg}`, () =>
    buildDrum(radius, height, fillet, seg),
  )
}

function buildDrum(
  radius: number,
  height: number,
  fillet: number,
  seg: number,
): THREE.LatheGeometry {
  const p: THREE.Vector2[] = []
  const n = 7
  p.push(new THREE.Vector2(0, 0))
  p.push(new THREE.Vector2(radius - fillet, 0))
  for (let i = 1; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / n)
    p.push(new THREE.Vector2(radius - fillet + fillet * Math.cos(a), fillet + fillet * Math.sin(a)))
  }
  p.push(new THREE.Vector2(radius, height - fillet))
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI / 2) * (i / n)
    p.push(
      new THREE.Vector2(
        radius - fillet + fillet * Math.cos(a),
        height - fillet + fillet * Math.sin(a),
      ),
    )
  }
  p.push(new THREE.Vector2(0, height))
  return new THREE.LatheGeometry(p, seg)
}

/** Bucket profile: bellied wall, rolled rim. Used for object storage and the client base. */
export function pail(
  rTop: number,
  rBottom: number,
  height: number,
  seg = 72,
): THREE.LatheGeometry {
  return memo(`pl|${rTop}|${rBottom}|${height}|${seg}`, () =>
    buildPail(rTop, rBottom, height, seg),
  )
}

function buildPail(
  rTop: number,
  rBottom: number,
  height: number,
  seg: number,
): THREE.LatheGeometry {
  const f = 0.05
  const p: THREE.Vector2[] = []
  const n = 6
  p.push(new THREE.Vector2(0, 0))
  p.push(new THREE.Vector2(rBottom - f, 0))
  for (let i = 1; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / n)
    p.push(new THREE.Vector2(rBottom - f + f * Math.cos(a), f + f * Math.sin(a)))
  }
  for (let i = 1; i <= 8; i++) {
    const t = i / 8
    p.push(
      new THREE.Vector2(
        rBottom + (rTop - rBottom) * t + Math.sin(t * Math.PI) * 0.018,
        f + (height - f - 0.09) * t,
      ),
    )
  }
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + Math.PI * 1.35 * (i / 8)
    p.push(new THREE.Vector2(rTop + 0.055 * Math.cos(a), height - 0.045 + 0.055 * Math.sin(a)))
  }
  return new THREE.LatheGeometry(p, seg)
}

/**
 * Hand-rolled capsule. Kept in preference to three's CapsuleGeometry because the
 * queue's acrylic shell depends on this exact lathe profile.
 */
export function capsule(radius: number, len: number, seg = 48): THREE.LatheGeometry {
  return memo(`cp|${radius}|${len}|${seg}`, () => buildCapsule(radius, len, seg))
}

function buildCapsule(radius: number, len: number, seg: number): THREE.LatheGeometry {
  const p: THREE.Vector2[] = []
  const n = 10
  const h = len / 2
  p.push(new THREE.Vector2(0, -h - radius))
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / n)
    p.push(new THREE.Vector2(radius * Math.cos(a), -h + radius * Math.sin(a)))
  }
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI / 2) * (i / n)
    p.push(new THREE.Vector2(radius * Math.cos(a), h + radius * Math.sin(a)))
  }
  p.push(new THREE.Vector2(0, h + radius))
  return new THREE.LatheGeometry(p, seg)
}

export function ringGeo(r: number, t: number, seg = 64): THREE.TorusGeometry {
  return memo(`rg|${r}|${t}|${seg}`, () => new THREE.TorusGeometry(r, t, 16, seg))
}

/* Memoised wrappers for the stock three primitives the part builders reach for
   inline. Same reasoning as above — the edge node's 48×32 sphere is 1568
   vertices, and a diagram with twenty edge nodes should pay for it once. */

export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  seg: number,
): THREE.CylinderGeometry {
  return memo(`cy|${rTop}|${rBottom}|${h}|${seg}`, () =>
    new THREE.CylinderGeometry(rTop, rBottom, h, seg),
  )
}

/** Open-ended part-cylinder, for the warehouse's barrel vault. */
export function vault(
  r: number,
  h: number,
  seg: number,
  thetaStart: number,
  thetaLength: number,
): THREE.CylinderGeometry {
  return memo(`vt|${r}|${h}|${seg}|${thetaStart}|${thetaLength}`, () =>
    new THREE.CylinderGeometry(r, r, h, seg, 1, false, thetaStart, thetaLength),
  )
}

export function plane(w: number, h: number): THREE.PlaneGeometry {
  return memo(`pn|${w}|${h}`, () => new THREE.PlaneGeometry(w, h))
}

export function sphere(r: number, ws: number, hs: number): THREE.SphereGeometry {
  return memo(`sp|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs))
}

/**
 * Upper hemisphere, open at the base.
 *
 * A full sphere sunk into a plinth wastes half its triangles below the floor
 * and leaves that half poking out under anything narrower than it. This stops
 * at the equator, so a dome sits *on* what it covers.
 */
export function dome(r: number, ws: number, hs: number): THREE.SphereGeometry {
  return memo(
    `dm|${r}|${ws}|${hs}`,
    () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2),
  )
}

export function torus(
  r: number,
  t: number,
  rs: number,
  ts: number,
  arc: number,
): THREE.TorusGeometry {
  return memo(`to|${r}|${t}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc))
}

export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  return memo(`bx|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d))
}

export function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  pos?: Triple,
  rot?: Triple,
  scale?: Triple,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  if (pos) m.position.set(pos[0], pos[1], pos[2])
  if (rot) m.rotation.set(rot[0], rot[1], rot[2])
  if (scale) m.scale.set(scale[0], scale[1], scale[2])
  return m
}

/**
 * Baked contact-shadow blob. Cheap ambient occlusion under a part, independent
 * of the real shadow map. Tagged `isShadow` so the assembly builder and the
 * LOD pass can strip it.
 */
const shadowMats = new Map<number, THREE.MeshBasicMaterial>()

export function occlusion(scale: number, opacity = 0.5): THREE.Mesh {
  let sm = shadowMats.get(opacity)
  if (!sm) {
    sm = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity,
    })
    shadowMats.set(opacity, sm)
  }
  const m = new THREE.Mesh(plane(scale, scale), sm)
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.004
  m.renderOrder = -1
  m.userData.isShadow = true
  return m
}

export function tubeMesh(
  curve: THREE.Curve<THREE.Vector3>,
  radius: number,
  mat: THREE.Material,
  segs = 90,
  radial = 16,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, radial, false), mat)
}

/**
 * Tubular segments proportional to a run's length.
 *
 * A connector's curve is not known ahead of time, so its geometry cannot be
 * memoised like the parametric primitives — it is rebuilt whenever a route
 * changes, which during a drag means every frame. A fixed high segment count
 * is the difference between a connector costing 11ms and costing 2ms.
 *
 * Takes a length rather than a curve deliberately: `Curve.getLength()` builds a
 * 200-entry arc-length table, which costs more than the geometry it was meant
 * to size. Callers already hold the polyline, so `polylineLength` is free.
 */
export function segmentsForLength(length: number, perUnit = 6, min = 20, max = 110): number {
  return Math.max(min, Math.min(max, Math.round(length * perUnit)))
}

export function polylineLength(pts: THREE.Vector3[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += pts[i].distanceTo(pts[i - 1])
  return n
}

/**
 * Arc-length resolution for connector curves.
 *
 * three defaults to 200 subdivisions, which is generous for a run of a few
 * units and is recomputed every time a route changes. Route curves are gentle —
 * straight segments joined by 0.28u fillets — so a coarser table is
 * indistinguishable and markedly cheaper.
 */
export const CURVE_ARC_DIVISIONS = 48

/**
 * Mark geometry as a modelled connector stub.
 *
 * Several parts have connections built into the model — the gateway's three
 * input pipes and lit output arrow, the balancer's flow arrows, the queue's
 * exit arrow. They read well in isolation, which is what a catalog needs. In a
 * diagram they dangle into empty space and double up with the real routed edge,
 * so the renderer strips them from any node that has an actual connection.
 */
export function stub<T extends THREE.Object3D>(o: T): T {
  o.userData.isStub = true
  return o
}

/** Remove modelled connector stubs from a part instance. Irreversible. */
export function stripStubs(root: THREE.Object3D): number {
  const doomed: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o.userData.isStub) doomed.push(o)
  })
  for (const o of doomed) o.removeFromParent()
  return doomed.length
}

/**
 * Show or hide a part's modelled connector stubs.
 *
 * Preferred over `stripStubs` for anything that can change: a node that loses
 * its last edge should get its pipework back, which removal cannot undo.
 */
export function setStubsVisible(root: THREE.Object3D, on: boolean): number {
  let n = 0
  root.traverse((o) => {
    if (!o.userData.isStub) return
    o.visible = on
    n++
  })
  return n
}

/** Does this part carry modelled connector stubs at all? */
export function hasStubs(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((o) => {
    if (o.userData.isStub) found = true
  })
  return found
}

/** Lathed arrowhead. Height is 2.5× the tube radius — fixed system-wide. */
export function arrowGeo(r: number): THREE.LatheGeometry {
  return memo(`ah|${r}`, () => buildArrowGeo(r))
}

function buildArrowGeo(r: number): THREE.LatheGeometry {
  const p: THREE.Vector2[] = []
  const n = 6
  p.push(new THREE.Vector2(0, 0))
  p.push(new THREE.Vector2(r * 2.5 - 0.012, 0))
  for (let i = 1; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / n)
    p.push(new THREE.Vector2(r * 2.5 - 0.012 + 0.012 * Math.cos(a), 0.012 + 0.012 * Math.sin(a)))
  }
  p.push(new THREE.Vector2(r * 0.09, r * 6.2))
  p.push(new THREE.Vector2(0, r * 6.4))
  return new THREE.LatheGeometry(p, 32)
}

/** Place an arrowhead at parameter `t` along a curve, aligned to its tangent. */
export function arrowHead(
  curve: THREE.Curve<THREE.Vector3>,
  t: number,
  radius: number,
  mat: THREE.Material,
): THREE.Mesh {
  const tt = Math.min(0.999, t)
  const dir = curve.getTangentAt(tt).normalize()
  const m = new THREE.Mesh(arrowGeo(radius), mat)
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir)
  m.position.copy(curve.getPointAt(tt))
  return m
}

/** Port pad and collar — the terminator every connector lands on. */
export function port(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  g.add(mesh(drum(0.13, 0.05, 0.02, 40), mat))
  g.add(mesh(ringGeo(0.16, 0.018, 40), mat, [0, 0.025, 0], [Math.PI / 2, 0, 0]))
  return g
}

/** Dashed run: `count` segments at `duty` fill. The ratio is fixed system-wide. */
export function dashedRun(
  curve: THREE.Curve<THREE.Vector3>,
  radius: number,
  mat: THREE.Material,
  count: number,
  duty = 0.58,
  radial = 16,
): THREE.Group {
  const g = new THREE.Group()
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const a = i / count
    const b = a + duty / count
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 6; k++) pts.push(curve.getPointAt(Math.min(1, a + ((b - a) * k) / 6)))
    const sub = new THREE.CatmullRomCurve3(pts)
    /* Each dash would otherwise build its own 200-entry arc-length table, and
       there are nine of them per connector. A dash spans a fraction of a unit
       and is very nearly straight, so a short table is exact enough. */
    sub.arcLengthDivisions = 12
    parts.push(new THREE.TubeGeometry(sub, 10, radius, radial, false))
  }

  /* One geometry, one draw call. Nine separate meshes made the dashed style the
     most expensive connector to rebuild by a wide margin, and a route is rebuilt
     on every frame of a drag. */
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  g.add(new THREE.Mesh(merged ?? parts[0], mat))
  return g
}

/**
 * Concatenate geometries sharing one material.
 *
 * Hand-rolled rather than pulled from three/addons: the addon handles morph
 * targets, groups and mismatched attribute sets, none of which apply to a set
 * of tubes built moments ago from the same call. Returns null if the inputs
 * ever disagree, so the caller can fall back rather than produce corrupt data.
 */
function mergeGeometries(
  geoms: THREE.BufferGeometry[],
  useGroups: boolean,
): THREE.BufferGeometry | null {
  if (!geoms.length || useGroups) return null
  const names = Object.keys(geoms[0].attributes)
  let vertexCount = 0
  let indexCount = 0
  for (const g of geoms) {
    if (Object.keys(g.attributes).length !== names.length) return null
    for (const n of names) if (!g.attributes[n]) return null
    if (!g.index) return null
    vertexCount += g.attributes.position.count
    indexCount += g.index.count
  }

  const out = new THREE.BufferGeometry()
  for (const name of names) {
    const itemSize = geoms[0].attributes[name].itemSize
    const array = new Float32Array(vertexCount * itemSize)
    let offset = 0
    for (const g of geoms) {
      const src = g.attributes[name]
      array.set(src.array as Float32Array, offset)
      offset += src.count * itemSize
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
  }

  const index = new Uint32Array(indexCount)
  let io = 0
  let vo = 0
  for (const g of geoms) {
    const src = g.index!
    for (let i = 0; i < src.count; i++) index[io + i] = src.getX(i) + vo
    io += src.count
    vo += g.attributes.position.count
  }
  out.setIndex(new THREE.BufferAttribute(index, 1))
  return out
}

/**
 * Round the corners of a polyline with quadratic blends, then fit a curve
 * through the result. This is what keeps dense orthogonal diagrams legible.
 */
export function elbowCurve(points: THREE.Vector3[], radius: number): THREE.CatmullRomCurve3 {
  const out: THREE.Vector3[] = [points[0].clone()]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const a = points[i - 1]
    const b = points[i + 1]
    const da = a.clone().sub(p)
    const db = b.clone().sub(p)
    const r = Math.min(radius, da.length() * 0.48, db.length() * 0.48)
    const s = p.clone().addScaledVector(da.normalize(), r)
    const e = p.clone().addScaledVector(db.normalize(), r)
    out.push(s)
    for (let k = 1; k < 9; k++) {
      const t = k / 9
      const it = 1 - t
      out.push(
        s
          .clone()
          .multiplyScalar(it * it)
          .addScaledVector(p, 2 * it * t)
          .addScaledVector(e, t * t),
      )
    }
    out.push(e)
  }
  out.push(points[points.length - 1].clone())
  const curve = new THREE.CatmullRomCurve3(out, false, 'centripetal', 0.4)
  curve.arcLengthDivisions = CURVE_ARC_DIVISIONS
  return curve
}
