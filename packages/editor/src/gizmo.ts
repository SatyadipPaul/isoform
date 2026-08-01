/**
 * Rotation gizmo.
 *
 * A graduated ring lying on the ground around the selection, with a handle you
 * drag to turn it. Rotation existed before this only as a bracket-key binding
 * documented in the help strip, which is to say it did not exist: nothing about
 * a selected part suggested it could be turned.
 *
 * Flat on the ground rather than a three-axis ball. Parts in this language only
 * ever yaw — they sit on a floor, and a rack tipped onto its side is not a
 * diagram, it is a mistake. Offering pitch and roll would only offer ways to
 * make the drawing wrong.
 */

import * as THREE from 'three'
import { mesh, palette, ringGeo, roundedBox, sphere } from '@isoform/engine'

/** The design's rotation increment. Shared with the bracket keys. */
export const ROT_STEP = Math.PI / 12

/** Ring radii are rounded to this before geometry is built. */
const RADIUS_QUANTUM = 0.05

/** Grab tolerance around the ring. The visible tube is far too thin to hit. */
const PICK_TUBE = 0.16

const TICKS = 24

const link = palette('link')

export class RotateGizmo {
  readonly object = new THREE.Group()

  private ring: THREE.Mesh
  private pick: THREE.Mesh
  private handle: THREE.Mesh
  private ticks: THREE.Mesh[] = []
  private radius = 0

  /** What the pointer may grab. Raycast these before anything else. */
  readonly handles: THREE.Object3D[] = []

  constructor() {
    const dim = link.steel('body')
    const hot = link.lit('lit', 2.6)

    this.ring = mesh(ringGeo(1, 0.022, 96), dim, [0, 0, 0], [Math.PI / 2, 0, 0])
    this.object.add(this.ring)

    /* Invisible, and deliberately fat. `visible = false` would take it out of
       raycasting too, so it is transparent with zero opacity instead. */
    this.pick = mesh(
      ringGeo(1, PICK_TUBE, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    )
    this.object.add(this.pick)

    for (let i = 0; i < TICKS; i++) {
      /* Every 90° gets a longer mark, so the cardinal directions read at a
         glance — that is what makes a quarter turn checkable without a readout. */
      const major = i % 6 === 0
      const t = mesh(roundedBox(major ? 0.15 : 0.075, 0.03, 0.035, 0.008), dim)
      this.ticks.push(t)
      this.object.add(t)
    }

    this.handle = mesh(sphere(0.1, 20, 16), hot)
    this.object.add(this.handle)

    this.handles.push(this.handle, this.pick)
    this.object.visible = false
    this.object.renderOrder = 3
  }

  /** Place the ring around a selection and point the handle at its yaw. */
  show(centre: THREE.Vector3, radius: number, rot: number): void {
    const r = Math.max(RADIUS_QUANTUM, Math.round(radius / RADIUS_QUANTUM) * RADIUS_QUANTUM)
    if (r !== this.radius) {
      this.radius = r
      /* Rebuilt at true size rather than scaled: scaling a torus stretches its
         tube with it, so the pick volume would swell with the part and the
         visible line would thicken. The geometry cache keys on the rounded
         radius, so the same part size costs one build ever. */
      this.ring.geometry = ringGeo(r, 0.022, 96)
      this.pick.geometry = ringGeo(r, PICK_TUBE, 32)
      this.ticks.forEach((t, i) => {
        const a = i * ROT_STEP
        t.position.set(Math.sin(a) * r, 0, Math.cos(a) * r)
        /* Local +X points radially outward when yawed by a − π/2. */
        t.rotation.y = a - Math.PI / 2
      })
    }
    this.object.visible = true
    this.object.position.set(centre.x, centre.y + 0.02, centre.z)
    this.setAngle(rot)
  }

  hide(): void {
    this.object.visible = false
  }

  get visible(): boolean {
    return this.object.visible
  }

  /** Move the handle to `rot` without touching the document. */
  setAngle(rot: number): void {
    this.handle.position.set(Math.sin(rot) * this.radius, 0, Math.cos(rot) * this.radius)
  }

  /**
   * Yaw implied by a world point on the gizmo's plane.
   *
   * `atan2(x, z)`, not the textbook `atan2(z, x)`: a three.js yaw takes +Z
   * toward +X, so this is the convention a node's own `rot` uses. Mixing the two
   * silently mirrors every rotation.
   */
  angleAt(point: THREE.Vector3): number {
    return Math.atan2(point.x - this.object.position.x, point.z - this.object.position.z)
  }

  /** Height of the gizmo plane, for projecting the pointer onto it. */
  get planeY(): number {
    return this.object.position.y
  }
}

/** Wrap to (−π, π] so a stored angle cannot creep past a full turn. */
export function normalizeAngle(a: number): number {
  const t = (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return t - Math.PI
}

export function snapAngle(a: number, free: boolean): number {
  return free ? a : Math.round(a / ROT_STEP) * ROT_STEP
}

export const degrees = (rad: number): number => Math.round((normalizeAngle(rad) * 180) / Math.PI)
