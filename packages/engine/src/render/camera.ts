/**
 * Camera presets and exact framing.
 *
 * `hero` is the catalog's locked pose: 32° lens, azimuth 34°, elevation 24°.
 * `iso` is a true orthographic isometric, which matters for a diagram — parallel
 * edges stay parallel and a reader can compare distances across the frame,
 * neither of which perspective gives you.
 */

import * as THREE from 'three'
import type { CameraPreset } from '../doc/schema.js'

export const HERO_AZ = 0.6
export const HERO_EL = 0.42
export const HERO_FOV = 32

/** Azimuth/elevation for each preset. `free` keeps whatever the user set. */
export const PRESET_POSE: Record<Exclude<CameraPreset, 'free'>, { az: number; el: number }> = {
  hero: { az: HERO_AZ, el: HERO_EL },
  iso: { az: Math.PI / 4, el: Math.atan(Math.SQRT1_2) },
  top: { az: 0, el: Math.PI / 2 - 0.001 },
}

export interface Framing {
  position: THREE.Vector3
  target: THREE.Vector3
  dist: number
}

/**
 * Distance at which `bounds` exactly fills the frame from the given pose.
 *
 * Fits the eight corners of the box rather than its bounding sphere. A diagram
 * is wide, flat and shallow, so its sphere radius is set by the diagonal —
 * fitting that leaves most of the frame empty, which is exactly the mistake
 * that made the first editor build look like scattered objects.
 *
 * For a camera at `target + w·d` looking along −w, a corner q (relative to
 * target) needs `d ≥ q·w + |q·u| / tan(fovH/2)` horizontally, and the same
 * against v vertically. The answer is the max over all corners.
 */
export function frame(
  bounds: THREE.Box3,
  az: number,
  el: number,
  fovDeg: number,
  aspect: number,
  margin = 1.06,
): Framing {
  const target = bounds.getCenter(new THREE.Vector3())
  const w = new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ).normalize()
  const u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), w).normalize()
  const v = new THREE.Vector3().crossVectors(w, u).normalize()

  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
  const tanH = tanV * aspect

  let dist = 0
  const q = new THREE.Vector3()
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        q.set(x, y, z).sub(target)
        const along = q.dot(w)
        dist = Math.max(dist, along + Math.abs(q.dot(u)) / tanH, along + Math.abs(q.dot(v)) / tanV)
      }
    }
  }
  dist = Math.max(dist * margin, 0.5)

  return { position: target.clone().addScaledVector(w, dist), target, dist }
}

export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Frame `bounds` into the part of the canvas that is not covered by UI.
 *
 * Fitting to the whole canvas puts a third of the diagram under the palette rail
 * and the inspector, which reads as "not centred" — because it isn't, in the
 * only region the user can actually see. This fits the free rectangle and then
 * slides the camera sideways so the content's centre lands on that rectangle's
 * centre rather than the canvas's.
 */
export function frameInset(
  bounds: THREE.Box3,
  az: number,
  el: number,
  fovDeg: number,
  canvasW: number,
  canvasH: number,
  insets: Insets,
  margin = 1.06,
): Framing {
  const freeW = Math.max(64, canvasW - insets.left - insets.right)
  const freeH = Math.max(64, canvasH - insets.top - insets.bottom)

  const target = bounds.getCenter(new THREE.Vector3())
  const w = new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ).normalize()
  const u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), w).normalize()
  const v = new THREE.Vector3().crossVectors(w, u).normalize()

  /* Vertical fov spans the full canvas height, so the free region subtends a
     proportionally smaller angle on each axis. */
  const tanFull = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
  const tanV = (tanFull * freeH) / canvasH
  const tanH = (tanFull * freeW) / canvasH

  let dist = 0
  const q = new THREE.Vector3()
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        q.set(x, y, z).sub(target)
        const along = q.dot(w)
        dist = Math.max(dist, along + Math.abs(q.dot(u)) / tanH, along + Math.abs(q.dot(v)) / tanV)
      }
    }
  }
  dist = Math.max(dist * margin, 0.5)

  /* Offset so the free region's centre, not the canvas centre, holds the content. */
  const freeCx = insets.left + freeW / 2
  const freeCy = insets.top + freeH / 2
  const worldPerPx = (2 * dist * tanFull) / canvasH
  const shift = u
    .clone()
    .multiplyScalar(-(freeCx - canvasW / 2) * worldPerPx)
    .add(v.clone().multiplyScalar((freeCy - canvasH / 2) * worldPerPx))

  target.add(shift)
  return { position: target.clone().addScaledVector(w, dist), target, dist }
}

/** Orthographic half-extents that fit `bounds` from the given pose. */
export function frameOrtho(
  bounds: THREE.Box3,
  az: number,
  el: number,
  aspect: number,
  margin = 1.06,
): { position: THREE.Vector3; target: THREE.Vector3; halfHeight: number; dist: number } {
  const target = bounds.getCenter(new THREE.Vector3())
  const w = new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ).normalize()
  const u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), w).normalize()
  const v = new THREE.Vector3().crossVectors(w, u).normalize()

  let hu = 0
  let hv = 0
  let depth = 0
  const q = new THREE.Vector3()
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        q.set(x, y, z).sub(target)
        hu = Math.max(hu, Math.abs(q.dot(u)))
        hv = Math.max(hv, Math.abs(q.dot(v)))
        depth = Math.max(depth, Math.abs(q.dot(w)))
      }
    }
  }
  const halfHeight = Math.max(hv, hu / aspect) * margin
  const dist = depth * 2 + halfHeight * 4
  return { position: target.clone().addScaledVector(w, dist), target, halfHeight, dist }
}
