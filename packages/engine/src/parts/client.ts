/**
 * Client parts — and, by extension, everything that is not the system being
 * drawn. A desktop, a handset, and somebody else's service all belong here for
 * the same reason: they sit outside the boundary, so they take the neutral
 * slate rather than a category colour that would imply ownership.
 */

import * as THREE from 'three'
import { palette } from '../foundry/materials.js'
import {
  V,
  cylinder,
  dome,
  mesh,
  occlusion,
  pail,
  plane,
  ringGeo,
  roundedBox,
} from '../foundry/geometry.js'
import { textures } from '../foundry/textures.js'
import type { PartBuild } from './types.js'

let screenMat: THREE.MeshStandardMaterial | null = null
let phoneMat: THREE.MeshStandardMaterial | null = null

/**
 * The drawn browser window, used as both albedo and emissive map so the panel
 * appears lit from within. Bespoke rather than a finish preset, so it is
 * memoised here instead of going through the material registry.
 */
function screen(): THREE.MeshStandardMaterial {
  if (screenMat) return screenMat
  const browser = textures().browser
  screenMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    map: browser,
    emissive: 0xffffff,
    emissiveMap: browser,
    emissiveIntensity: 0.85,
    roughness: 0.22,
    metalness: 0,
  })
  return screenMat
}

/**
 * The same window, cropped rather than squashed.
 *
 * The handset's panel is 0.49 × 0.94 and the browser texture is 640 × 400, so
 * mapping it whole squeezed a landscape page into a portrait one — window dots
 * and URL bar compressed to a third of their width, which reads as a broken
 * desktop rather than a phone. Cropping the left 42% keeps everything at its
 * drawn proportions and gives a single narrow column of content, which is what
 * a mobile viewport looks like.
 *
 * The texture is cloned, not adjusted in place: `textures()` hands back one
 * shared instance, and setting `repeat` on it would crop the desktop monitor's
 * screen too.
 */
function phoneScreen(): THREE.MeshStandardMaterial {
  if (phoneMat) return phoneMat
  const cropped = textures().browser.clone()
  cropped.needsUpdate = true
  cropped.repeat.set(0.42, 1)
  cropped.offset.set(0.02, 0)
  phoneMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    map: cropped,
    emissive: 0xffffff,
    emissiveMap: cropped,
    emissiveIntensity: 0.85,
    roughness: 0.22,
    metalness: 0,
  })
  return phoneMat
}

/** Client device: monitor on a weighted stand, browser chrome on the panel. */
export function client(): PartBuild {
  const g = new THREE.Group()
  const P = palette('client')
  const shell = P.polymer('body')
  const steel = P.steel(0x9ba4b3)

  g.add(mesh(pail(0.5, 0.42, 0.05, 56), P.powder(0x2b2f37), [0, 0, 0]))
  g.add(mesh(roundedBox(0.5, 0.05, 0.34, 0.05), P.rubber(0x22252c), [0, 0.02, 0]))
  g.add(mesh(roundedBox(0.13, 0.62, 0.09, 0.04), steel, [0, 0.34, 0]))

  const panel = new THREE.Group()
  panel.add(mesh(roundedBox(1.56, 1.0, 0.07, 0.055), shell))
  panel.add(mesh(roundedBox(1.42, 0.86, 0.02, 0.03), P.powder(0x14181f), [0, 0.02, 0.036]))

  /* DELIBERATE DEVIATION from the source catalog.
     The recess plate is 0.02 deep centred at z=0.036, so its front face is at
     0.046 — and the catalog places this screen at 0.043, i.e. 3mm *inside* it.
     The panel therefore renders solid black, which defeats the one thing the
     part exists to show. Moved just clear of the plate. */
  panel.add(mesh(plane(1.38, 0.82), screen(), [0, 0.02, 0.048]))
  panel.add(mesh(roundedBox(0.05, 0.05, 0.02, 0.02), P.lit(0x5ce0a8, 2), [0, -0.44, 0.04]))
  panel.position.set(0, 1.16, 0)
  panel.rotation.x = -0.14
  g.add(panel)

  g.add(occlusion(2.9, 0.45))
  return { group: g, dist: 3.7, target: V(0, 0.82, 0) }
}

/**
 * Handset on a desk stand.
 *
 * The file header used to claim one part covered browser and handset and that
 * "aspect ratio does the rest" — but `client` is welded to a 16:10 monitor on a
 * weighted base, so there was no way to get a handset out of it. Any diagram
 * with a consumer product in it needs this, and at thumbnail size a tall slab
 * on a cradle is unmistakably not a monitor.
 */
export function mobile(): PartBuild {
  const g = new THREE.Group()
  const P = palette('client')
  const shell = P.polymer('body')
  const steel = P.steel(0x9ba4b3)

  g.add(mesh(roundedBox(0.54, 0.05, 0.4, 0.02), P.rubber(0x22252c), [0, 0.025, 0]))
  /* A leaning cradle rather than a stalk: the phone has to rest on something
     for the tilt to read as deliberate. */
  g.add(mesh(roundedBox(0.46, 0.3, 0.12, 0.04), P.powder(0x2b2f37), [0, 0.16, -0.1], [-0.26, 0, 0]))
  g.add(mesh(roundedBox(0.42, 0.04, 0.07, 0.02), steel, [0, 0.09, 0.09]))

  const handset = new THREE.Group()
  handset.add(mesh(roundedBox(0.6, 1.12, 0.07, 0.075), shell))
  handset.add(mesh(roundedBox(0.53, 1.0, 0.02, 0.05), P.powder(0x14181f), [0, 0.02, 0.037]))

  handset.add(mesh(plane(0.49, 0.94), phoneScreen(), [0, 0.02, 0.049]))
  handset.add(mesh(roundedBox(0.16, 0.028, 0.02, 0.012), P.powder(0x0d1016), [0, 0.53, 0.05]))
  handset.add(mesh(roundedBox(0.2, 0.025, 0.015, 0.01), steel, [0, -0.5, 0.05]))
  handset.position.set(0, 0.68, 0.02)
  handset.rotation.x = -0.26
  g.add(handset)

  g.add(occlusion(2.2, 0.4))
  return { group: g, dist: 2.9, target: V(0, 0.66, 0) }
}

/**
 * Third-party service: a frosted dome over a plinth.
 *
 * The one part that is deliberately unreadable. Everything else in the catalog
 * is modelled as the machine it is; this one is a machine you are not allowed
 * to see, which is exactly what a third-party dependency is in a diagram you
 * are drawing. Neutral slate for the same reason — it is not yours to colour.
 */
export function external(): PartBuild {
  const g = new THREE.Group()
  const P = palette('client')
  const steel = P.steel(0x9ba4b3)

  /* Wide enough for the dome to land on it. At 1.18 the plate was narrower than
     the 1.2 dome, so the glass overhung its own base all the way round. */
  g.add(mesh(roundedBox(1.3, 0.16, 1.3, 0.04), P.powder('trim'), [0, 0.08, 0]))
  g.add(mesh(roundedBox(1.16, 0.06, 1.16, 0.02), P.anodised('trim'), [0, 0.18, 0]))

  /* An indistinct shape under the dome. Three blocks at unhelpful angles: it
     must be clear that there is something in there and unclear what. */
  const inner = P.polymer(0x555d6b)
  g.add(mesh(roundedBox(0.42, 0.44, 0.36, 0.05), inner, [0.04, 0.42, -0.02], [0, 0.5, 0.1]))
  g.add(mesh(roundedBox(0.3, 0.3, 0.3, 0.05), inner, [-0.2, 0.36, 0.14], [0.2, -0.3, 0]))
  g.add(mesh(cylinder(0.12, 0.14, 0.34, 18), inner, [0.2, 0.38, 0.2]))

  /* Acrylic as frost. At 0.16 opacity it was clear glass — the three blocks
     inside read as three distinct blocks, which defeats the one thing the part
     is for. 0.34 leaves them as masses you can see are there and cannot
     identify. A hemisphere, so it sits on the plate rather than sinking half of
     itself through the floor. */
  const cap = new THREE.Mesh(dome(0.58, 32, 16), P.acrylic('body', 0.34, { side: THREE.DoubleSide }))
  cap.scale.set(1, 0.95, 1)
  cap.position.y = 0.21
  g.add(cap)
  g.add(mesh(ringGeo(0.58, 0.03, 56), steel, [0, 0.23, 0], [Math.PI / 2, 0, 0]))

  /* Four corner studs: it is mounted, not floating — the same hardware
     vocabulary as the rest of the catalog, so it still belongs to the set. */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(cylinder(0.035, 0.035, 0.06, 12), steel, [sx * 0.47, 0.19, sz * 0.47]))
    }
  }
  g.add(mesh(roundedBox(0.22, 0.1, 0.02, 0.015), P.lit('lit', 0.9), [0, 0.09, 0.6]))
  g.add(occlusion(2.6, 0.45))

  return { group: g, dist: 3.1, target: V(0, 0.42, 0) }
}
