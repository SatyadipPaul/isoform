/**
 * `Stage` itself needs a WebGL context and cannot be built in this environment,
 * so what is tested here is the arithmetic that was actually wrong: the depth
 * range a cue is fitted to.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { depthSpan } from './stage.js'

/** A box `w` wide, `d` deep, centred on the origin. */
const box = (w: number, d: number, h = 2): THREE.Box3 =>
  new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2))

describe('depthSpan', () => {
  it('measures the span the camera actually sees, not the bounding radius', () => {
    /* The shape most system diagrams are: wide and shallow. Viewed down -Z, the
       depth spread is the 4-unit depth, while the bounding sphere's radius is
       set by the 60-unit width and would claim ten times as much. Fitting a fade
       to the radius is what made depth cueing invisible. */
    const wide = box(60, 4)
    const eye = new THREE.Vector3(0, 1, 40)
    const { min, max } = depthSpan(wide, eye)

    const radius = wide.getBoundingSphere(new THREE.Sphere()).radius
    expect(max - min).toBeLessThan(radius)
    /* Nearest corner is a long way off-axis, so the span is wider than the raw
       4-unit depth — but nothing like the 2×radius the sphere would give. */
    expect(max - min).toBeLessThan(2 * radius * 0.6)
  })

  it('grows when the diagram is genuinely deep', () => {
    const eye = new THREE.Vector3(0, 1, 40)
    const shallow = depthSpan(box(20, 2), eye)
    const deep = depthSpan(box(20, 30), eye)
    expect(deep.max - deep.min).toBeGreaterThan(shallow.max - shallow.min)
  })

  it('puts the nearest corner nearer than the furthest, from any angle', () => {
    const b = box(30, 12)
    for (const az of [0, 1, 2, 3, 4, 5]) {
      const eye = new THREE.Vector3(Math.sin(az) * 40, 12, Math.cos(az) * 40)
      const { min, max } = depthSpan(b, eye)
      expect(min).toBeGreaterThan(0)
      expect(max).toBeGreaterThan(min)
    }
  })

  it('collapses to a point for an empty box, so a caller can skip the fade', () => {
    const point = new THREE.Box3(new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1))
    const { min, max } = depthSpan(point, new THREE.Vector3(0, 0, 10))
    expect(max - min).toBeCloseTo(0, 9)
  })
})
