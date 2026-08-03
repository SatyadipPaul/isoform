/**
 * Camera moves.
 *
 * Pure arithmetic, so everything here is checkable — which matters more than
 * usual because the failures are all *aesthetic*. A camera that eases wrong, or
 * that refits while orbiting, or that duplicates a frame at the loop point,
 * throws nothing and passes any test that only asks "did it produce frames".
 * You find out when you watch the GIF and it looks cheap.
 */

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  baseDistance,
  frameTimes,
  posePosition,
  resolvePose,
  sampleAt,
  storyboardDuration,
  turntable,
  type Storyboard,
} from './shots.js'

const HERO_AZ = 0.6

describe('resolvePose', () => {
  it('expands a preset name', () => {
    expect(resolvePose('hero').az).toBeCloseTo(HERO_AZ, 6)
    expect(resolvePose('hero').zoom).toBe(1)
  })

  it('keeps elevation short of the pole', () => {
    /* At exactly ±90° the azimuth stops meaning anything and the up vector is
       degenerate — `PRESET_POSE.top` already backs off by 0.001 for this. */
    const p = resolvePose({ az: 0, el: Math.PI })
    expect(Math.abs(p.el)).toBeLessThan(Math.PI / 2)
  })
})

describe('interpolation', () => {
  const dolly = (fromZoom: number, toZoom: number): Storyboard => ({
    from: { az: 0, el: 0.4, zoom: fromZoom },
    shots: [{ camera: { az: 0, el: 0.4, zoom: toZoom }, duration: 2, ease: 'linear' }],
  })

  it('interpolates zoom geometrically, not arithmetically', () => {
    /* Distance reads as a ratio. Halfway from 1× to 4× is 2×, not 2.5× — the
       arithmetic answer rushes out and then crawls. */
    const mid = sampleAt(dolly(1, 4), 1).pose.zoom
    expect(mid).toBeCloseTo(2, 6)
    expect(mid).not.toBeCloseTo(2.5, 2)
  })

  it('reaches its endpoints exactly', () => {
    expect(sampleAt(dolly(1, 4), 0).pose.zoom).toBeCloseTo(1, 6)
    expect(sampleAt(dolly(1, 4), 2).pose.zoom).toBeCloseTo(4, 6)
  })

  it('treats azimuth as absolute so a full turn is expressible', () => {
    /* Wrapping to the shortest arc would make this resolve to standing still,
       which is the whole of a turntable. */
    const sb: Storyboard = {
      from: { az: 0, el: 0.4 },
      shots: [{ camera: { az: Math.PI * 2, el: 0.4 }, duration: 4, ease: 'linear' }],
    }
    expect(sampleAt(sb, 2).pose.az).toBeCloseTo(Math.PI, 6)
    expect(sampleAt(sb, 4).pose.az).toBeCloseTo(Math.PI * 2, 6)
  })

  it('eases in and out by default, and linearly when asked', () => {
    const move = (ease: 'linear' | 'inOut'): number => {
      const sb: Storyboard = {
        from: { az: 0, el: 0.4 },
        shots: [{ camera: { az: 1, el: 0.4 }, duration: 2, ease }],
      }
      return sampleAt(sb, 0.5).pose.az
    }
    /* A quarter of the way through, an eased move has barely left. */
    expect(move('linear')).toBeCloseTo(0.25, 6)
    expect(move('inOut')).toBeLessThan(0.1)
  })
})

describe('sampleAt', () => {
  const sb: Storyboard = {
    from: 'hero',
    shots: [
      { camera: 'iso', duration: 2, focus: ['a'] },
      { camera: 'top', duration: 2, hold: 1, focus: ['b'], trace: 't1', traceFrom: 0, traceTo: 1 },
    ],
  }

  it('measures its own running time, holds included', () => {
    expect(storyboardDuration(sb)).toBe(5)
  })

  it('carries a shot state across the whole shot', () => {
    expect(sampleAt(sb, 0.1).focus).toEqual(['a'])
    expect(sampleAt(sb, 2.1).focus).toEqual(['b'])
    expect(sampleAt(sb, 2.1).trace).toBe('t1')
  })

  it('holds the camera still during a hold but keeps the trace moving', () => {
    /* The hold is the camera's, not time's — a request does not stop travelling
       because the shot stopped moving. */
    const atArrival = sampleAt(sb, 4)
    const duringHold = sampleAt(sb, 4.5)
    expect(duringHold.pose.az).toBeCloseTo(atArrival.pose.az, 6)
    expect(duringHold.traceAt).toBeGreaterThan(atArrival.traceAt)
  })

  it('advances the trace linearly even when the camera eases', () => {
    const t: Storyboard = {
      shots: [{ duration: 4, ease: 'inOut', trace: 'x', traceFrom: 0, traceTo: 1 }],
    }
    expect(sampleAt(t, 1).traceAt).toBeCloseTo(0.25, 6)
    expect(sampleAt(t, 3).traceAt).toBeCloseTo(0.75, 6)
  })

  it('holds the final state past the end rather than going undefined', () => {
    const end = sampleAt(sb, 99)
    expect(end.focus).toEqual(['b'])
    expect(end.traceAt).toBe(1)
    expect(Number.isFinite(end.pose.az)).toBe(true)
  })

  it('holds the previous pose for a shot that names no camera', () => {
    const held: Storyboard = {
      from: { az: 1, el: 0.4 },
      shots: [{ duration: 2, focus: ['a'] }],
    }
    expect(sampleAt(held, 0).pose.az).toBeCloseTo(1, 6)
    expect(sampleAt(held, 2).pose.az).toBeCloseTo(1, 6)
  })

  it('is a pure function of t', () => {
    /* Everything about a reproducible export rests on this. A wall-clock leak
       would show up as an export that differs between two identical runs. */
    for (const t of [0, 0.37, 1.5, 3.2, 5]) {
      expect(sampleAt(sb, t)).toEqual(sampleAt(sb, t))
    }
  })
})

describe('frameTimes', () => {
  it('never emits a frame that duplicates the first', () => {
    /* A full turn sampled inclusively ends where it began, and the loop hitches
       once per revolution. Frames belong at i/count, not i/(count-1). */
    const sb = turntable({ turns: 1, duration: 2 })
    const times = frameTimes(sb, 12)
    expect(times).toHaveLength(24)
    expect(times[0]).toBe(0)
    expect(times.at(-1)).toBeLessThan(storyboardDuration(sb))

    const first = sampleAt(sb, times[0]).pose.az
    const last = sampleAt(sb, times.at(-1)!).pose.az
    expect(last - first).toBeLessThan(Math.PI * 2)
  })

  it('leaves the wrap exactly one frame wide', () => {
    const sb = turntable({ turns: 1, duration: 2 })
    const times = frameTimes(sb, 12)
    const step = sampleAt(sb, times[1]).pose.az - sampleAt(sb, times[0]).pose.az
    const wrap =
      sampleAt(sb, 0).pose.az + Math.PI * 2 - sampleAt(sb, times.at(-1)!).pose.az
    expect(wrap).toBeCloseTo(step, 6)
  })

  it('always produces at least one frame', () => {
    expect(frameTimes({ shots: [] }, 24)).toHaveLength(1)
  })
})

describe('baseDistance', () => {
  /* A wide, flat, shallow diagram — the shape every real one has. */
  const bounds = new THREE.Box3(new THREE.Vector3(-8, 0, -2), new THREE.Vector3(8, 1.5, 2))

  it('holds one distance across a full orbit rather than refitting', () => {
    /* Refitting per frame makes the camera breathe: a wide diagram fits closer
       seen along its narrow axis than across it. */
    const sb = turntable({ turns: 1, duration: 4 })
    const d = baseDistance(bounds, sb, 32, 16 / 9)

    const total = storyboardDuration(sb)
    const centre = bounds.getCenter(new THREE.Vector3())
    for (let i = 0; i <= 16; i++) {
      const { pose } = sampleAt(sb, (total * i) / 16)
      const { position, target } = posePosition(pose, d, centre)
      /* Same distance from the subject at every angle. */
      expect(position.distanceTo(target)).toBeCloseTo(d, 6)
    }
  })

  it('is wide enough for the worst angle on the path', () => {
    const sb = turntable({ turns: 1, duration: 4 })
    const d = baseDistance(bounds, sb, 32, 16 / 9)
    const across = baseDistance(bounds, { from: { az: 0, el: 0.42 }, shots: [] }, 32, 16 / 9)
    expect(d).toBeGreaterThanOrEqual(across - 1e-9)
  })
})

describe('posePosition', () => {
  const centre = new THREE.Vector3(1, 0, 2)

  it('falls back to the diagram centre when a pose names no target', () => {
    const { target } = posePosition(
      { az: 0, el: 0.4, zoom: 1, target: null },
      10,
      centre,
    )
    expect(target.equals(centre)).toBe(true)
  })

  it('honours an explicit target', () => {
    const { target } = posePosition(
      { az: 0, el: 0.4, zoom: 1, target: [5, 0, 5] },
      10,
      centre,
    )
    expect([target.x, target.z]).toEqual([5, 5])
  })

  it('scales distance by zoom', () => {
    const near = posePosition({ az: 0, el: 0.4, zoom: 0.5, target: null }, 10, centre)
    expect(near.position.distanceTo(near.target)).toBeCloseTo(5, 6)
  })
})
