/**
 * Obstacles — what a route is not allowed to cross.
 *
 * Everything here works in the XZ ground plane. A route's height varies only to
 * meet its anchors; the question of whether it collides is two-dimensional.
 *
 * Rotation is handled exactly rather than by taking the axis-aligned bounds of
 * a rotated footprint. The conservative version costs up to 41% extra width on
 * a 45°-turned part, which is enough to make the ladder reject perfectly good
 * routes and fall through to A* for no reason.
 */

import type { Doc } from '../doc/schema.js'
import { manifestFor } from '../parts/registry.js'

/** Clearance kept between a run and a part, in grid units. */
export const INFLATE = 0.3

export interface Obstacle {
  id: string
  cx: number
  cz: number
  /** Half-extents, already inflated. */
  hw: number
  hd: number
  yaw: number
  /** Precomputed rotation. Recomputing these per test dominated the router. */
  cos: number
  sin: number
  /** Bounding radius, for the broad-phase reject. */
  r: number
}

export function obstaclesOf(doc: Doc, inflate = INFLATE): Obstacle[] {
  return doc.nodes.map((n) => {
    const f = manifestFor(n.type).footprint
    const s = n.scale ?? 1
    const hw = (f.w * s) / 2 + inflate
    const hd = (f.d * s) / 2 + inflate
    return {
      id: n.id,
      cx: n.pos[0],
      cz: n.pos[1],
      hw,
      hd,
      yaw: n.rot,
      cos: Math.cos(n.rot),
      sin: Math.sin(n.rot),
      r: Math.hypot(hw, hd),
    }
  })
}

/** World point → the obstacle's own frame, where the box is axis-aligned. */
function toLocal(o: Obstacle, x: number, z: number): [number, number] {
  const dx = x - o.cx
  const dz = z - o.cz
  /* Inverse of three's Y-rotation, which maps (x,z) → (x·cosθ + z·sinθ, −x·sinθ + z·cosθ). */
  return [dx * o.cos - dz * o.sin, dx * o.sin + dz * o.cos]
}

/**
 * Cheap reject before the slab test: is the obstacle's bounding circle even
 * near this segment? Most parts in a diagram are nowhere near any given run,
 * and this turns the router from O(edges × all parts) into something closer to
 * O(edges × nearby parts).
 */
function nearSegment(o: Obstacle, ax: number, az: number, bx: number, bz: number): boolean {
  const loX = Math.min(ax, bx) - o.r
  const hiX = Math.max(ax, bx) + o.r
  if (o.cx < loX || o.cx > hiX) return false
  const loZ = Math.min(az, bz) - o.r
  const hiZ = Math.max(az, bz) + o.r
  return o.cz >= loZ && o.cz <= hiZ
}

/**
 * Segment against one obstacle, by the slab method in the obstacle's frame.
 * Endpoints exactly on the boundary do not count as hits, so a route may leave
 * from and arrive at the very edge of a part.
 */
export function segmentHits(
  o: Obstacle,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  if (!nearSegment(o, ax, az, bx, bz)) return false
  const [x0, z0] = toLocal(o, ax, az)
  const [x1, z1] = toLocal(o, bx, bz)
  const dx = x1 - x0
  const dz = z1 - z0

  let tMin = 0
  let tMax = 1
  const EPS = 1e-6

  for (const [p, d, h] of [
    [x0, dx, o.hw],
    [z0, dz, o.hd],
  ] as Array<[number, number, number]>) {
    if (Math.abs(d) < EPS) {
      /* Parallel to this pair of slabs. Lying exactly on a face counts as
         outside: the box is already inflated by the clearance, so a run tangent
         to it is at precisely the separation we asked for, not in contact. */
      if (p <= -h + EPS || p >= h - EPS) return false
      continue
    }
    const t1 = (-h - p) / d
    const t2 = (h - p) / d
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
    if (tMin > tMax) return false
  }
  /* A grazing touch at a single parameter is contact, not penetration. */
  return tMax - tMin > EPS
}

export function pointInside(o: Obstacle, x: number, z: number): boolean {
  const [lx, lz] = toLocal(o, x, z)
  return Math.abs(lx) <= o.hw && Math.abs(lz) <= o.hd
}

/** Does any obstacle block this polyline? `skip` exempts the endpoints' nodes. */
export function polylineClear(
  pts: Array<{ x: number; z: number }>,
  obstacles: Obstacle[],
  skip: ReadonlySet<string>,
): boolean {
  for (const o of obstacles) {
    if (skip.has(o.id)) continue
    for (let i = 1; i < pts.length; i++) {
      if (segmentHits(o, pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z)) return false
    }
  }
  return true
}
