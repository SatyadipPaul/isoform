/**
 * Trace playback — a request travelling the diagram.
 *
 * The library could draw what a system *is* and nothing about what happens in
 * it. This is the piece that changes that: a packet runs the actual routed
 * connectors, hop by hop, and the parts it has reached light up behind it.
 *
 * ## The whole design decision
 *
 * A trace is `['web', 'cdn', 'api', 'pg']` — node ids, the way a person says it
 * out loud. Everything hard is in turning that into motion:
 *
 * · **Hops resolve to connectors, and connectors have their own direction.** A
 *   path routinely runs an edge backwards; a cache read replies to the service
 *   that asked. So each hop records whether it traverses its edge forward, and
 *   the curve parameter is flipped when it does not.
 * · **The packet follows `routeCurve`, not the polyline.** Same curve the tube
 *   was swept along, corner rounding included — otherwise the packet cuts every
 *   bend and leaves its own conduit.
 * · **Timings, when present, own the clock.** Without them the packet moves at
 *   constant speed and shows the route. With them, time is divided by *duration*
 *   rather than distance, so a slow hop is visibly slow — which is usually the
 *   entire reason someone is showing you the trace.
 * · **A gap is reported, not thrown.** Paths name node pairs with no connector
 *   between them all the time, especially when an agent wrote them. Drawing the
 *   hops that exist and naming the ones that do not is more useful than refusing
 *   to draw anything.
 */

import * as THREE from 'three'
import type { DocTrace } from '../doc/schema.js'
import { palette } from '../foundry/materials.js'
import { routeCurve } from '../route/styles.js'

/** Something that can answer where connectors run. The Reconciler, in practice. */
export interface RouteSource {
  routeOf(edgeId: string): readonly THREE.Vector3[] | null
  edgeBetween(a: string, b: string): { id: string; forward: boolean } | null
  /**
   * Where a node stands and how wide it is, for parking the marker.
   *
   * The radius is not optional detail. A marker sized by a constant disappears
   * under any part wider than it — which was the first version, an invisible
   * ring drawn dutifully beneath every service in the diagram.
   */
  anchorOf?(nodeId: string): { position: THREE.Vector3; radius: number } | null
}

export interface TraceHop {
  from: string
  to: string
  edgeId: string
  /** False when this hop runs its connector against the declared direction. */
  forward: boolean
  curve: THREE.Curve<THREE.Vector3>
  length: number
  /** Share of total playback this hop occupies, summing to 1 across the trace. */
  weight: number
}

export interface TraceResolution {
  hops: TraceHop[]
  /**
   * Consecutive pairs in the path with no connector between them.
   *
   * Reported rather than thrown. Each is a hop the packet skips over.
   */
  gaps: Array<{ from: string; to: string }>
  /** True when at least one hop resolved and the trace can be played at all. */
  playable: boolean
}

/** Radius of the travelling packet, in grid units. Reads at hero framing. */
const PACKET_R = 0.075

/** How long a full trace runs when it carries no timings, in seconds. */
const DEFAULT_DURATION = 3.2

/** Inner edge of the unit marker ring: a band around the outside, not a disc. */
const MARKER_INNER = 0.86

/** Clearance between a part's silhouette and the ring around it, in grid units. */
const MARKER_CLEARANCE = 0.22

export class TracePlayer {
  readonly group = new THREE.Group()

  private packet: THREE.Mesh
  private marker: THREE.Mesh
  private res: TraceResolution | null = null
  private trace: DocTrace | null = null
  private duration = DEFAULT_DURATION
  /** 0..1 through the whole trace. */
  private u = 0
  private running = false

  constructor(private readonly routes: RouteSource) {
    const P = palette('data')
    this.packet = new THREE.Mesh(new THREE.SphereGeometry(PACKET_R, 20, 16), P.lit('lit', 3.2))
    /* The packet is the thing the eye tracks, so it must never be occluded by
       the conduit it is inside — the tube is translucent but still writes depth
       on its collars. */
    this.packet.renderOrder = 3
    this.packet.visible = false

    /* A flat ring that snaps to the part the packet has most recently reached.
       Deliberately a separate object rather than a material change on the part:
       lighting a node by substituting its materials would move it between
       instance batches on every hop, which is a buffer rebuild per hop for an
       effect that lasts a few hundred milliseconds.

       Built at unit radius and scaled per node — the parts range from a 0.6u
       client to a 2.4u balancer, and one ring size cannot clear both. */
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_INNER, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0x74f0da,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.position.y = 0.012
    this.marker.visible = false

    this.group.add(this.packet, this.marker)
  }

  /**
   * Work out which hops of `trace` can actually be drawn.
   *
   * Pure apart from caching the result — safe to call to inspect a trace without
   * playing it, which is what the editor's trace list and `critique` both want.
   */
  resolve(trace: DocTrace): TraceResolution {
    const hops: TraceHop[] = []
    const gaps: TraceResolution['gaps'] = []

    for (let i = 0; i < trace.path.length - 1; i++) {
      const from = trace.path[i]
      const to = trace.path[i + 1]
      const link = this.routes.edgeBetween(from, to)
      const pts = link && this.routes.routeOf(link.id)
      if (!link || !pts || pts.length < 2) {
        gaps.push({ from, to })
        continue
      }
      const curve = routeCurve(pts as THREE.Vector3[])
      hops.push({
        from,
        to,
        edgeId: link.id,
        forward: link.forward,
        curve,
        /* Arc length, not the straight-line distance: a route that detours
           around three parts really is longer to travel, and a constant-speed
           packet has to take longer over it. */
        length: curve.getLength(),
        weight: 0,
      })
    }

    this.weigh(hops, trace)
    return { hops, gaps, playable: hops.length > 0 }
  }

  /**
   * Divide playback among the hops.
   *
   * Timings win when they are present and usable, because they are the point:
   * they turn the trace from a picture of a route into a picture of where the
   * time goes. `deserialize` already drops a timings array whose length does not
   * match the path, but a trace built in memory has not been through it, and a
   * mismatched array here would silently pair hop 3 with hop 5's duration.
   */
  private weigh(hops: TraceHop[], trace: DocTrace): void {
    if (!hops.length) return

    const hopIndex = (h: TraceHop): number => trace.path.indexOf(h.from)
    const timings = trace.timings
    const usable = !!timings && timings.length === trace.path.length - 1

    const raw = hops.map((h) => {
      if (usable) return Math.max(0, timings![hopIndex(h)])
      return h.length
    })
    const total = raw.reduce((a, b) => a + b, 0)

    /* Zero-length routes and all-zero timings both land here. An equal split is
       the only answer that still moves. */
    if (total <= 0) {
      for (const h of hops) h.weight = 1 / hops.length
      return
    }
    hops.forEach((h, i) => (h.weight = raw[i] / total))

    /* Real durations set the clock as well as the split, so a 900ms request
       takes about 900ms to watch. Clamped: a trace of microseconds is
       unwatchable and one of minutes is not worth waiting for. */
    if (usable) {
      const ms = timings!.reduce((a, b) => a + Math.max(0, b), 0)
      this.duration = THREE.MathUtils.clamp(ms / 1000, 1.2, 12)
    } else {
      this.duration = DEFAULT_DURATION
    }
  }

  /** Load a trace and park the packet at its start. Does not begin playing. */
  load(trace: DocTrace): TraceResolution {
    this.trace = trace
    this.res = this.resolve(trace)
    this.u = 0
    this.running = false
    this.packet.visible = this.res.playable
    this.marker.visible = false
    if (this.res.playable) this.seek(0)
    return this.res
  }

  /** Routes moved. Rebuild the curves against the same trace. */
  refresh(): void {
    if (!this.trace) return
    const u = this.u
    const running = this.running
    this.res = this.resolve(this.trace)
    this.packet.visible = this.res.playable
    if (this.res.playable) this.seek(u)
    this.running = running
  }

  play(): void {
    if (this.res?.playable) this.running = true
  }

  pause(): void {
    this.running = false
  }

  stop(): void {
    this.running = false
    this.trace = null
    this.res = null
    this.packet.visible = false
    this.marker.visible = false
  }

  get isPlaying(): boolean {
    return this.running
  }

  get progress(): number {
    return this.u
  }

  get resolution(): TraceResolution | null {
    return this.res
  }

  /** The node the packet has most recently arrived at, or null before the first. */
  get reached(): string | null {
    const hop = this.hopAt(this.u)
    if (!hop) return null
    return hop.local > 0.995 ? hop.hop.to : hop.index > 0 ? this.res!.hops[hop.index - 1].to : null
  }

  /**
   * Advance by `dt` seconds. Wraps, so a trace loops until it is stopped.
   *
   * Driven by elapsed time rather than by frame count so playback runs at the
   * same speed on any refresh rate, and so a dropped frame skips ahead rather
   * than slowing the request down.
   */
  tick(dt: number): void {
    if (!this.running || !this.res?.playable) return
    this.u = (this.u + dt / this.duration) % 1
    this.seek(this.u)
  }

  /** Place the packet at `u` through the trace, 0..1. */
  seek(u: number): void {
    if (!this.res?.playable) return
    this.u = THREE.MathUtils.clamp(u, 0, 1)
    const at = this.hopAt(this.u)
    if (!at) return

    /* Flip the curve parameter rather than reversing the point list: the curve
       is arc-length parameterised, and rebuilding it backwards for every hop
       that happens to run against its edge would cost a curve per hop for a
       value that is one subtraction. */
    const t = at.hop.forward ? at.local : 1 - at.local
    this.packet.position.copy(at.hop.curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1)))

    const reached = this.reached
    const anchor = reached ? this.routes.anchorOf?.(reached) : null
    this.marker.visible = !!anchor
    if (anchor) {
      this.marker.position.set(anchor.position.x, anchor.position.y + 0.012, anchor.position.z)
      const r = anchor.radius + MARKER_CLEARANCE
      this.marker.scale.set(r, r, 1)
    }
  }

  /** Which hop `u` falls in, and how far through it. */
  private hopAt(u: number): { hop: TraceHop; index: number; local: number } | null {
    const hops = this.res?.hops
    if (!hops?.length) return null
    let acc = 0
    for (let i = 0; i < hops.length; i++) {
      const w = hops[i].weight
      if (u <= acc + w || i === hops.length - 1) {
        return { hop: hops[i], index: i, local: w > 0 ? (u - acc) / w : 0 }
      }
      acc += w
    }
    return null
  }

  dispose(): void {
    this.group.removeFromParent()
    this.packet.geometry.dispose()
    this.marker.geometry.dispose()
    ;(this.marker.material as THREE.Material).dispose()
  }
}
