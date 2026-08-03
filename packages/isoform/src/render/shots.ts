/**
 * Camera moves through the diagram.
 *
 * A GIF of a static camera is a worse PNG. What makes an animated export worth
 * making is that it travels *through* the space — which is also the only way a
 * flat image can carry the fact that this is a modelled 3D scene at all.
 *
 * This module is pure arithmetic: it turns a storyboard and a time into the
 * complete state of the scene at that instant. Nothing here touches three.js
 * beyond vector maths, and nothing reads a clock — which is what makes an export
 * reproducible.
 *
 * ## The three decisions that separate a considered move from an amateurish one
 *
 * · **Interpolate in orbit space, never cartesian.** `render/camera.ts` already
 *   parameterises the camera as azimuth, elevation, distance and target, and
 *   derives its position from those. Lerping two world *positions* instead sends
 *   the camera on a chord straight through the diagram it is supposed to be
 *   circling.
 * · **Zoom interpolates logarithmically.** Distance is perceived as a ratio, not
 *   a difference. A dolly from 1× to 4× must pass through 2× at the midpoint;
 *   linear interpolation puts it at 2.5×, which reads as a rush that then
 *   crawls.
 * · **Azimuth is absolute and never wrapped.** Normalising to the shortest arc
 *   makes a full turn inexpressible — it would resolve to standing still. A spin
 *   is simply `az: start + 2π`.
 *
 * ## The clock
 *
 * The storyboard owns time. Traces are *seeked* to a position derived from `t`,
 * never played on their own wall clock — two clocks is how a camera move and the
 * packet travelling under it drift apart, and why the same export would come out
 * different twice.
 */

import * as THREE from 'three'
import type { CameraPreset } from '../doc/schema.js'
import { PRESET_POSE, frame } from './camera.js'

/**
 * A camera position in orbit space.
 *
 * `zoom` is a multiplier on the distance that exactly frames the diagram, not an
 * absolute distance. A storyboard written against one diagram then still means
 * something against a bigger one — an absolute distance stops framing anything
 * the moment the subject grows.
 */
export interface CameraPose {
  /** Absolute, in radians. Not wrapped: `start + 2π` is a full turn. */
  az: number
  el: number
  /** 1 fits the diagram; below 1 pushes in, above 1 pulls back. */
  zoom?: number
  /** Look-at. Defaults to the centre of the diagram. */
  target?: [number, number, number]
}

export type Ease = 'linear' | 'in' | 'out' | 'inOut'

export interface Shot {
  /** Where the camera arrives. Omit to hold wherever the last shot left it. */
  camera?: CameraPose | Exclude<CameraPreset, 'free'>
  /** Applies for the whole shot. A set cannot be interpolated, so this cuts. */
  focus?: string[] | null
  trace?: string | null
  /** Where the trace sits when the shot begins. Defaults to where it was. */
  traceFrom?: number
  /** Where it sits when the shot ends. Defaults to 1. */
  traceTo?: number
  /** Seconds spent travelling to `camera`. */
  duration: number
  /** Seconds held still after arriving. */
  hold?: number
  /** Default `inOut`. */
  ease?: Ease
}

export interface Storyboard {
  /** Where the camera starts. Defaults to `hero`. */
  from?: CameraPose | Exclude<CameraPreset, 'free'>
  shots: Shot[]
}

/** Everything the scene needs to be in, at one instant. */
export interface SceneState {
  pose: Required<Omit<CameraPose, 'target'>> & { target: [number, number, number] | null }
  focus: string[] | null
  trace: string | null
  /** 0..1 through that trace. */
  traceAt: number
}

/* ------------------------------------------------------------------ *
 * Easing
 * ------------------------------------------------------------------ */

const EASE: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
  /* Cubic rather than quadratic: the gentler start and settle is what makes a
     move read as deliberate rather than as a slide. */
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
}

/* ------------------------------------------------------------------ *
 * Poses
 * ------------------------------------------------------------------ */

/** Elevation must stay short of the pole, where azimuth stops meaning anything. */
const EL_LIMIT = Math.PI / 2 - 0.001

export function resolvePose(p: CameraPose | Exclude<CameraPreset, 'free'>): Required<CameraPose> {
  const base = typeof p === 'string' ? { ...PRESET_POSE[p] } : p
  return {
    az: base.az,
    el: THREE.MathUtils.clamp(base.el, -EL_LIMIT, EL_LIMIT),
    zoom: base.zoom ?? 1,
    target: base.target ?? ([0, 0, 0] as [number, number, number]),
  }
}

/** Whether a pose named its own look-at, or wants the diagram's centre. */
function hasTarget(p: CameraPose | Exclude<CameraPreset, 'free'>): boolean {
  return typeof p !== 'string' && p.target !== undefined
}

interface Keyed {
  pose: Required<CameraPose>
  targeted: boolean
}

function lerpPose(a: Keyed, b: Keyed, k: number): Keyed {
  return {
    pose: {
      az: a.pose.az + (b.pose.az - a.pose.az) * k,
      el: a.pose.el + (b.pose.el - a.pose.el) * k,
      /* Geometric, not arithmetic — see the header. */
      zoom: Math.exp(Math.log(a.pose.zoom) + (Math.log(b.pose.zoom) - Math.log(a.pose.zoom)) * k),
      target: [0, 1, 2].map(
        (i) => a.pose.target[i] + (b.pose.target[i] - a.pose.target[i]) * k,
      ) as [number, number, number],
    },
    /* A move into a pose with an explicit look-at is targeted the whole way, so
       the interpolated target is used rather than snapping at the end. */
    targeted: a.targeted || b.targeted,
  }
}

/* ------------------------------------------------------------------ *
 * Sampling
 * ------------------------------------------------------------------ */

const span = (s: Shot): number => Math.max(0, s.duration) + Math.max(0, s.hold ?? 0)

/** Total running time, in seconds. */
export function storyboardDuration(sb: Storyboard): number {
  return sb.shots.reduce((t, s) => t + span(s), 0)
}

/**
 * The complete scene state at `t` seconds.
 *
 * Pure: the same storyboard and the same `t` always give the same answer, which
 * is the property every frame export rests on.
 */
export function sampleAt(sb: Storyboard, t: number): SceneState {
  const start: Keyed = {
    pose: resolvePose(sb.from ?? 'hero'),
    targeted: sb.from !== undefined && hasTarget(sb.from),
  }

  let cursor = start
  let focus: string[] | null = null
  let trace: string | null = null
  let traceAt = 0
  let elapsed = 0

  for (const shot of sb.shots) {
    const total = span(shot)
    const to: Keyed = shot.camera
      ? { pose: resolvePose(shot.camera), targeted: hasTarget(shot.camera) }
      : cursor

    const from = traceAt
    const shotTraceFrom = shot.traceFrom ?? from
    const shotTraceTo = shot.traceTo ?? 1

    /* Past this shot entirely: adopt its end state and carry on. */
    if (t >= elapsed + total) {
      cursor = to
      if (shot.focus !== undefined) focus = shot.focus
      if (shot.trace !== undefined) trace = shot.trace
      traceAt = shotTraceTo
      elapsed += total
      continue
    }

    const local = t - elapsed
    if (shot.focus !== undefined) focus = shot.focus
    if (shot.trace !== undefined) trace = shot.trace

    /* The camera eases; time does not. A request does not accelerate because the
       shot it appears in has an ease on it. */
    const linear = total > 0 ? THREE.MathUtils.clamp(local / total, 0, 1) : 1
    traceAt = shotTraceFrom + (shotTraceTo - shotTraceFrom) * linear

    const move = Math.max(0, shot.duration)
    const k = move > 0 ? THREE.MathUtils.clamp(local / move, 0, 1) : 1
    const eased = EASE[shot.ease ?? 'inOut'](k)
    const at = lerpPose(cursor, to, eased)

    return {
      pose: { ...at.pose, target: at.targeted ? at.pose.target : null },
      focus,
      trace,
      traceAt,
    }
  }

  /* Past the end — hold the final state so a frame at exactly `duration` is
     valid rather than undefined. */
  return {
    pose: { ...cursor.pose, target: cursor.targeted ? cursor.pose.target : null },
    focus,
    trace,
    traceAt,
  }
}

/**
 * When each frame of an export should be sampled.
 *
 * Frames land at `i / count`, never at `i / (count - 1)`. For a full turn the
 * last frame would otherwise be identical to the first, and the loop visibly
 * stutters on the repeat — the classic way an otherwise good turntable looks
 * broken.
 */
export function frameTimes(sb: Storyboard, fps: number): number[] {
  const total = storyboardDuration(sb)
  const count = Math.max(1, Math.round(total * fps))
  return Array.from({ length: count }, (_, i) => (i / count) * total)
}

/* ------------------------------------------------------------------ *
 * Framing
 * ------------------------------------------------------------------ */

/**
 * One distance that frames the diagram from every pose the storyboard visits.
 *
 * Refitting per frame looks wrong: a diagram is wide, flat and shallow, so it
 * fits closer seen along its narrow axis than across it, and a camera that
 * refits while orbiting appears to breathe in and out. Taking the widest fit
 * over the whole path instead gives a steady camera that never lets the subject
 * overflow, and leaves `zoom` meaning exactly what it says relative to it.
 */
export function baseDistance(
  bounds: THREE.Box3,
  sb: Storyboard,
  fovDeg: number,
  aspect: number,
  samples = 48,
): number {
  let worst = 0
  const total = storyboardDuration(sb)
  for (let i = 0; i <= samples; i++) {
    const { pose } = sampleAt(sb, total * (i / samples))
    worst = Math.max(worst, frame(bounds, pose.az, pose.el, fovDeg, aspect).dist)
  }
  return worst
}

/** World position for a pose, given the base fit distance and a look-at. */
export function posePosition(
  pose: SceneState['pose'],
  baseDist: number,
  centre: THREE.Vector3,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const target = pose.target ? new THREE.Vector3(...pose.target) : centre.clone()
  const dir = new THREE.Vector3(
    Math.cos(pose.el) * Math.sin(pose.az),
    Math.sin(pose.el),
    Math.cos(pose.el) * Math.cos(pose.az),
  ).normalize()
  return { position: target.clone().addScaledVector(dir, baseDist * pose.zoom), target }
}

/* ------------------------------------------------------------------ *
 * Ready-made moves
 * ------------------------------------------------------------------ */

export interface TurntableOptions {
  turns?: number
  duration?: number
  /** Elevation to spin at. Defaults to the hero pose's. */
  el?: number
  zoom?: number
  focus?: string[]
  trace?: string
}

/**
 * A slow orbit — the move almost everyone wants first.
 *
 * Linear on purpose. Easing a full revolution puts a slow-down at the seam,
 * which on a looping GIF reads as a hitch once per turn.
 */
export function turntable(o: TurntableOptions = {}): Storyboard {
  const start = resolvePose('hero')
  const el = o.el ?? start.el
  const zoom = o.zoom ?? 1
  return {
    from: { az: start.az, el, zoom },
    shots: [
      {
        camera: { az: start.az + Math.PI * 2 * (o.turns ?? 1), el, zoom },
        duration: o.duration ?? 8,
        ease: 'linear',
        focus: o.focus ?? null,
        trace: o.trace ?? null,
        traceFrom: 0,
        traceTo: o.trace ? 1 : 0,
      },
    ],
  }
}
