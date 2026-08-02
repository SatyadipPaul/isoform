/**
 * Control-plane parts — what observes and governs, rather than what serves.
 *
 * This category did not exist before, and its absence was the real gap in the
 * catalog: a diagram could show every service and every store and still have
 * nowhere to put the thing that authenticates, the thing that watches, or the
 * thing that knows where everything is. They were being drawn as tinted
 * services, which is exactly as informative as not drawing them.
 *
 * They share a violet the other categories do not use, so a control plane reads
 * as its own layer at a glance instead of dissolving into the services it
 * governs.
 */

import * as THREE from 'three'
import { palette } from '../foundry/materials.js'
import {
  V,
  cylinder,
  drum,
  extrudeShape,
  mesh,
  occlusion,
  plane,
  ringGeo,
  roundedBox,
  sphere,
} from '../foundry/geometry.js'
import type { PartBuild } from './types.js'

/**
 * Identity: a badge reader on a pedestal.
 *
 * A padlock was the obvious choice and the wrong one — the catalog already
 * spends a lock on the `secure` connector kind, and a lock says "encrypted"
 * where this needs to say "checked". A reader with a card presented to it is
 * the act, not the property.
 */
export function auth(): PartBuild {
  const g = new THREE.Group()
  const P = palette('ops')
  const shell = P.polymer('body')
  const trim = P.anodised('trim')
  const steel = P.steel(0xa2abba)

  g.add(mesh(drum(0.42, 0.08, 0.03, 40), P.powder('trim'), [0, 0, 0]))
  g.add(mesh(cylinder(0.15, 0.19, 0.78, 24), trim, [0, 0.47, 0]))

  /* The head is tilted back, the way a reader you present a card to is. */
  const head = new THREE.Group()
  head.position.set(0, 0.98, 0)
  head.rotation.x = -0.42
  head.add(mesh(roundedBox(0.62, 0.72, 0.16, 0.06), shell))
  head.add(mesh(roundedBox(0.5, 0.58, 0.03, 0.03), P.powder(0x161a21), [0, 0.02, 0.086]))

  /* Reader face pulses on accept, so it owns its material — a shared one would
     make every identity node in a diagram blink in lockstep with the last.

     Sitting at z=0.104, clear of the recess plate. It was at 0.100 — one
     millimetre *behind* the plate's front face at 0.1015 — so the panel that is
     the whole point of the part rendered as a dark rectangle. Exactly the fault
     the catalog carries a note about for the client's browser screen; the lesson
     did not transfer because the number looked plausible. */
  const faceMat = P.lit('lit', 1.4, { unique: true })
  const face = mesh(plane(0.44, 0.5), faceMat, [0, 0.02, 0.104])
  head.add(face)

  /* Key glyph: a bow ring and a bit, cut as one profile. */
  const key = new THREE.Shape()
  key.absarc(0, 0.12, 0.085, 0, Math.PI * 2, false)
  /* A Shape, not a Path — ExtrudeGeometry needs `extractPoints`, which only
     Shape defines. The two are otherwise interchangeable enough to swap by
     mistake and only find out at build time. */
  const bit = new THREE.Shape()
  bit.moveTo(-0.022, 0.06)
  bit.lineTo(0.022, 0.06)
  bit.lineTo(0.022, -0.16)
  bit.lineTo(0.075, -0.16)
  bit.lineTo(0.075, -0.21)
  bit.lineTo(0.022, -0.21)
  bit.lineTo(0.022, -0.25)
  bit.lineTo(-0.022, -0.25)
  bit.closePath()
  /* Dark on the lit panel, not steel on the dark recess. A metal glyph against
     a near-black plate was a smudge; a silhouette against a lit face reads. */
  const glyph = P.powder(0x14181f)
  head.add(mesh(extrudeShape(key, 0.02, 0.006, 'auth-bow'), glyph, [0, 0.06, 0.108]))
  head.add(mesh(extrudeShape(bit, 0.02, 0.006, 'auth-bit'), glyph, [0, 0.06, 0.108]))
  g.add(head)

  /* The card is the only moving piece: it dips to the reader and lifts away. */
  const card = new THREE.Group()
  card.add(mesh(roundedBox(0.38, 0.26, 0.022, 0.035), P.polymer('lit')))
  card.add(mesh(roundedBox(0.1, 0.08, 0.01, 0.015), steel, [-0.11, 0.04, 0.017]))
  card.add(mesh(roundedBox(0.2, 0.03, 0.008, 0.01), P.powder(0x1d222a), [0.04, -0.06, 0.016]))
  card.position.set(0, 1.5, 0.34)
  card.rotation.set(-0.42, 0, 0.12)
  g.add(card)
  g.add(occlusion(2.6, 0.4))

  return {
    group: g,
    dist: 3.3,
    target: V(0, 0.95, 0),
    animated: [card, face],
    update: (t) => {
      /* Present, hold, withdraw — 3.4s. The face lights only while held, so
         the pulse reads as a response rather than a heartbeat. */
      const c = (t * 0.3) % 1
      const dip = Math.max(0, Math.sin(c * Math.PI * 2))
      card.position.y = 1.5 - dip * 0.24
      card.position.z = 0.34 - dip * 0.1
      faceMat.emissiveIntensity = 0.9 + dip * dip * 2.6
    },
  }
}

/**
 * Observability: an instrument cluster.
 *
 * Two gauges and a strip chart on a stand. The needles and the trace carry the
 * meaning — a static dial is a clock, a sweeping one is a measurement — which
 * is why this is one of the parts that must animate to be legible at all.
 */
export function monitor(): PartBuild {
  const g = new THREE.Group()
  const P = palette('ops')
  const shell = P.powder('body')
  const bezel = P.anodised('trim')
  const steel = P.steel(0xa2abba)

  g.add(mesh(roundedBox(0.66, 0.06, 0.5, 0.02), P.powder('trim'), [0, 0.03, 0]))
  g.add(mesh(roundedBox(0.13, 0.5, 0.11, 0.04), steel, [0, 0.3, 0]))

  /* The whole cluster tilts back as one, so everything mounted on it inherits
     the angle and each instrument can be authored flat. */
  const panel = new THREE.Group()
  panel.position.set(0, 0.95, 0)
  panel.rotation.x = -0.3
  panel.add(mesh(roundedBox(1.5, 0.86, 0.14, 0.05), shell))
  panel.add(mesh(roundedBox(1.4, 0.76, 0.02, 0.03), P.powder(0x161a21), [0, 0, 0.075]))

  const needles: THREE.Group[] = []
  for (const [i, x] of [-0.45, 0.03].entries()) {
    panel.add(mesh(ringGeo(0.2, 0.022, 36), bezel, [x, 0.02, 0.085]))
    panel.add(mesh(drum(0.19, 0.008, 0.003, 36), P.powder(0x0f1319), [x, 0.02, 0.082], [Math.PI / 2, 0, 0]))
    /* Graduations, so a sweeping needle has something to sweep against. */
    for (let k = 0; k < 9; k++) {
      const a = -2.3 + (k / 8) * 4.6
      panel.add(
        mesh(
          roundedBox(0.035, 0.008, 0.006, 0.002),
          i === 0 ? P.lit('lit', 0.7) : bezel,
          [x + Math.cos(a) * 0.155, 0.02 + Math.sin(a) * 0.155, 0.09],
          [0, 0, a],
        ),
      )
    }

    /* Pivot at the dial centre, via a group rather than by translating the
       needle's geometry.

       `roundedBox` memoises: the geometry it hands back is shared with every
       other user of that size. Translating it in place mutated the cache — the
       two needles here alone shifted it twice, and every further monitor shifted
       it again, so the pivot drifted 0.13 per part built and the needles
       eventually stuck out past the bezel. A parent group carries the offset
       without touching geometry anyone else holds. */
    const pivot = new THREE.Group()
    pivot.position.set(x, 0.02, 0.095)
    pivot.add(mesh(roundedBox(0.15, 0.014, 0.008, 0.004), P.lit('lit', 2.4), [0.075, 0, 0]))
    needles.push(pivot)
    panel.add(pivot)
    panel.add(mesh(sphere(0.022, 12, 10), steel, [x, 0.02, 0.1]))
  }

  /**
   * Strip chart: fixed columns whose heights scroll, not a trace that travels.
   *
   * The first version slid a 22-bar group sideways behind two slabs meant to
   * mask its ends. Every part of that was wrong — the slabs stood 0.043 proud of
   * the panel rather than being bezel, the right one overhung the panel edge by
   * 0.11, the left one sat squarely on top of the second gauge, and the trace
   * ran outside its own window in both directions anyway.
   *
   * Columns that stay put and change height cannot overflow by construction, so
   * there is nothing to mask. It is also what a strip chart actually looks like.
   */
  const CHART_X = 0.47
  panel.add(mesh(roundedBox(0.42, 0.6, 0.02, 0.02), P.powder(0x0f1319), [CHART_X, 0.02, 0.082]))
  panel.add(mesh(roundedBox(0.38, 0.008, 0.008, 0.002), bezel, [CHART_X, -0.25, 0.09]))

  /* A fixed sample table, not a PRNG: every observability node in every diagram
     shows the same trace, so the part reads as one manufactured object. */
  const SAMPLES = [0.3, 0.52, 0.41, 0.68, 0.55, 0.33, 0.47, 0.72, 0.6, 0.38, 0.44, 0.66, 0.29, 0.58]
  const MAX_H = 0.5
  const COLS = 12
  const bars: THREE.Group[] = []
  for (let i = 0; i < COLS; i++) {
    /* Authored one unit tall with the bar sitting above its group's origin, so
       scaling the group in Y grows it from the baseline instead of about its
       own middle — then scaled to its first sample right away. The rest pose is
       what the palette thumbnail and the merged geometry are built from, and a
       column left at unit height stands two feet clear of the panel. */
    const col = new THREE.Group()
    col.position.set(0.305 + i * 0.03, -0.245, 0.092)
    col.scale.y = SAMPLES[i % SAMPLES.length] * MAX_H
    col.add(mesh(roundedBox(0.019, 1, 0.008, 0.003), P.lit('lit', 1.9), [0, 0.5, 0]))
    bars.push(col)
    panel.add(col)
  }

  g.add(panel)
  g.add(occlusion(2.7, 0.4))

  return {
    group: g,
    dist: 3.4,
    target: V(0, 0.9, 0),
    animated: [...needles, ...bars],
    update: (t) => {
      needles[0].rotation.z = -2.3 + (Math.sin(t * 0.9) * 0.5 + 0.5) * 4.6
      needles[1].rotation.z = -2.3 + (Math.sin(t * 1.7 + 1.1) * 0.5 + 0.5) * 4.6

      /* Interpolated between samples so the data marches smoothly leftward
         rather than snapping a column at a time. */
      const p = t * 2.4
      const s = Math.floor(p)
      const f = p - s
      for (let i = 0; i < COLS; i++) {
        const a = SAMPLES[(i + s) % SAMPLES.length]
        const b = SAMPLES[(i + s + 1) % SAMPLES.length]
        bars[i].scale.y = (a + (b - a) * f) * MAX_H
      }
    },
  }
}

/**
 * Service registry: a rotary card index.
 *
 * A drum of radial cards with one lit under the read head. "Where is this
 * service right now" is a lookup against a spinning directory, and the object
 * that does that is a rolodex — which also gives a silhouette nothing else in
 * the catalog has.
 */
export function registry(): PartBuild {
  const g = new THREE.Group()
  const P = palette('ops')
  const frame = P.anodised('trim')
  const steel = P.steel(0xa2abba)

  /* The cradle has to be taller than the drum it holds.
     It was not: 0.78-tall cheeks reaching y=0.89 around a drum of radius 0.36
     centred at 0.76, so the cards swung 0.23 clear of the frame at the top and
     out past it at the front. It read as an explosion, not a card index. The
     cheeks now clear the drum on every side. */
  const SPINDLE_Y = 0.72
  const CARD_R = 0.25
  g.add(mesh(roundedBox(1.34, 0.1, 0.94, 0.04), P.powder('trim'), [0, 0.05, 0]))
  for (const x of [-0.56, 0.56]) {
    /* Side cheeks, cut as a rounded upright so the drum sits in a cradle. */
    g.add(mesh(roundedBox(0.09, 1.0, 0.72, 0.06), frame, [x, 0.6, 0]))
  }
  g.add(mesh(cylinder(0.035, 0.035, 1.24, 16), steel, [0, SPINDLE_Y, 0], [0, 0, Math.PI / 2]))

  /* Cards on a spindle. One group: 20 meshes that stay mergeable. */
  const drumG = new THREE.Group()
  const CARDS = 20
  const cardMat = P.polymer('body')
  for (let i = 0; i < CARDS; i++) {
    const c = new THREE.Group()
    /* Authored standing up from the spindle, then rolled into place. The group
       sits on the axis and the card hangs off it, so rotating the group swings
       the card round — a fan meeting at the spindle, which is what a rolodex
       is. Offsetting the group instead would slide all twenty sideways. */
    c.add(mesh(roundedBox(0.5, CARD_R - 0.02, 0.012, 0.03), cardMat, [0, CARD_R / 2 + 0.01, 0]))
    c.add(mesh(roundedBox(0.3, 0.025, 0.008, 0.008), P.lit('lit', 0.55), [0, CARD_R - 0.03, 0.009]))
    c.rotation.x = (i / CARDS) * Math.PI * 2
    drumG.add(c)
  }
  drumG.position.set(0, SPINDLE_Y, 0)
  g.add(drumG)

  /* Read head, just clear of the drum's sweep rather than floating above it. */
  const HEAD_Y = SPINDLE_Y + CARD_R + 0.06
  g.add(mesh(roundedBox(0.56, 0.05, 0.12, 0.02), steel, [0, HEAD_Y, 0]))
  const litMat = P.lit('lit', 2.6, { unique: true })
  const lamp = mesh(roundedBox(0.42, 0.02, 0.06, 0.008), litMat, [0, HEAD_Y - 0.035, 0])
  g.add(lamp)
  g.add(mesh(roundedBox(0.1, 0.1, 0.03, 0.02), P.lit('lit', 2.2), [-0.5, 0.16, 0.48]))
  g.add(occlusion(2.7, 0.42))

  return {
    group: g,
    dist: 3.4,
    target: V(0, 0.72, 0),
    animated: [drumG, lamp],
    update: (t) => {
      drumG.rotation.x = t * 0.55
      /* Flashes as each card passes the head — 20 cards per revolution. */
      litMat.emissiveIntensity = 1.6 + Math.abs(Math.sin(t * 0.55 * 10)) * 1.6
    },
  }
}
