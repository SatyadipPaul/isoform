/**
 * Lane allocation.
 *
 * Two routes that turn on the same coordinate render as one thick line, which
 * is the classic way a dense diagram becomes unreadable. Rather than offsetting
 * finished geometry — which breaks the joins — the router asks here for the
 * coordinate to turn on, and gets back the nearest free lane.
 *
 * 0.17u matches the offset the catalog's bidirectional connector already uses,
 * so parallel runs sit at a spacing the design language established.
 */

export const LANE_STEP = 0.17

export interface Claim {
  axis: 'x' | 'z'
  coord: number
  lo: number
  hi: number
}

export class LaneAllocator {
  private claims: Claim[] = []

  /**
   * Re-assert claims made on a previous pass.
   *
   * Incremental resolution re-routes only the edges that changed, but lanes are
   * a shared resource — without the untouched edges' claims in hand, a
   * re-routed edge would happily take a corridor that is already occupied.
   */
  preload(claims: Iterable<Claim>): void {
    for (const c of claims) this.claims.push(c)
  }

  /** Claims made since construction, so a caller can carry them forward. */
  taken(): Claim[] {
    return this.claims
  }

  /**
   * A turn coordinate near `desired` on `axis`, free across the span [lo,hi].
   *
   * Candidates are tried outward — desired, +1, −1, +2, −2 … — so a route only
   * moves as far from its ideal line as it must. Past `maxTries` the desired
   * coordinate is taken anyway: an overlapping run beats a wildly detoured one.
   */
  claim(axis: 'x' | 'z', desired: number, lo: number, hi: number, maxTries = 8): number {
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)

    for (let k = 0; k <= maxTries; k++) {
      for (const sign of k === 0 ? [0] : [1, -1]) {
        const coord = desired + sign * k * LANE_STEP
        if (this.free(axis, coord, a, b)) {
          const c: Claim = { axis, coord, lo: a, hi: b }
          this.claims.push(c)
          this.recent.push(c)
          return coord
        }
      }
    }
    const c: Claim = { axis, coord: desired, lo: a, hi: b }
    this.claims.push(c)
    this.recent.push(c)
    return desired
  }

  /** Claims since the last `beginEdge`, so they can be attributed to one edge. */
  private recent: Claim[] = []

  beginEdge(): void {
    this.recent = []
  }

  edgeClaims(): Claim[] {
    return this.recent
  }

  /** Is this exact corridor free? For rungs whose turn coordinate is fixed. */
  isFree(axis: 'x' | 'z', coord: number, lo: number, hi: number): boolean {
    return this.free(axis, coord, Math.min(lo, hi), Math.max(lo, hi))
  }

  /**
   * Take a corridor at a coordinate that cannot move.
   *
   * The single-elbow rungs have no free parameter — their corner is fixed by the
   * two anchors — so they cannot be nudged into a neighbouring lane. They can
   * only take the corridor or decline it, which is what lets a conflicting L
   * route fall through to the double-elbow rung that *can* be shifted.
   */
  claimExact(axis: 'x' | 'z', coord: number, lo: number, hi: number): void {
    const c: Claim = { axis, coord, lo: Math.min(lo, hi), hi: Math.max(lo, hi) }
    this.claims.push(c)
    this.recent.push(c)
  }

  private free(axis: 'x' | 'z', coord: number, lo: number, hi: number): boolean {
    for (const c of this.claims) {
      if (c.axis !== axis) continue
      /* Only conflicts if the runs actually overlap along their shared axis. */
      if (c.hi < lo - 1e-6 || c.lo > hi + 1e-6) continue
      if (Math.abs(c.coord - coord) < LANE_STEP * 0.9) return false
    }
    return true
  }

  reset(): void {
    this.claims = []
  }

  get size(): number {
    return this.claims.length
  }
}
