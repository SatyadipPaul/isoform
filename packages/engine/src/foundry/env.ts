/**
 * Studio environment and light rig — ported from catalog section 0.
 *
 * "Identical in 21 scenes" is one of the catalog's locked rules, and it is the
 * single biggest reason the parts read as one system. Every scene the engine
 * builds gets its lighting from `makeRig`; nothing configures lights inline.
 *
 * Port note: `renderer.outputEncoding = sRGBEncoding` became
 * `renderer.outputColorSpace = SRGBColorSpace`. The r155 lighting-units change
 * does not apply here — the rig is Directional and Hemisphere only, both of
 * which are unitless, so the catalog's intensities carry over untouched.
 */

import * as THREE from 'three'
import { setMaxAnisotropy } from './textures.js'

/**
 * A boxed studio: dark shell, big white key panel above-left, cool bounce from
 * the right, warm bounce from behind-left, dark floor. Fed to PMREM for image
 * based lighting — this is what puts believable reflections in the metals.
 */
export function buildEnvironmentScene(): THREE.Scene {
  const s = new THREE.Scene()
  s.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(30, 30, 30),
      new THREE.MeshBasicMaterial({ color: 0x1e222a, side: THREE.BackSide }),
    ),
  )
  const panel = (color: number, w: number, h: number, pos: [number, number, number]): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }))
    m.position.set(pos[0], pos[1], pos[2])
    m.lookAt(0, 0, 0)
    s.add(m)
  }
  panel(0xffffff, 13, 13, [-3.5, 9, 3.5])
  panel(0xf2f6ff, 6, 6, [-1, 10, -2])
  panel(0x8fb0ff, 10, 15, [9, 1.5, 1])
  panel(0xffc190, 8, 11, [-9, 0.5, -3.5])
  panel(0x0c0e12, 16, 9, [0, -8, 0])
  return s
}

const envByRenderer = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()

/** Prefiltered environment map. Built once per renderer. */
export function environmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const hit = envByRenderer.get(renderer)
  if (hit) return hit
  const pmrem = new THREE.PMREMGenerator(renderer)
  const scene = buildEnvironmentScene()
  const t = pmrem.fromScene(scene, 0.03).texture
  pmrem.dispose()
  envByRenderer.set(renderer, t)
  return t
}

export interface RendererOptions {
  canvas?: HTMLCanvasElement
  alpha?: boolean
  /** Off-screen rendering for export needs a readable buffer. */
  preserveDrawingBuffer?: boolean
}

/** The catalog's renderer configuration, in one place. */
export function createRenderer(o: RendererOptions = {}): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: o.canvas,
    antialias: true,
    alpha: o.alpha ?? true,
    preserveDrawingBuffer: o.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04
  renderer.setClearAlpha(0)
  renderer.shadowMap.enabled = true
  /* The catalog asks for PCFSoftShadowMap, which r185 removed — it warns and
     silently substitutes PCFShadowMap on the first shadow render. Naming the
     substitute keeps the console clean and makes the choice explicit; softness
     then comes from `shadow.radius`, which the rig sets to the catalog's 3.
     A/B against VSMShadowMap (radius 3 and 8) was indistinguishable at the
     locked camera, because most of the visible contact shadow is the baked
     occlusion blob rather than the shadow map. Revisit if Phase 7 drops those
     blobs at merged LOD, which is when the map starts doing the work. */
  renderer.shadowMap.type = THREE.PCFShadowMap

  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy())
  return renderer
}

export interface Rig {
  key: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  rim: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  /**
   * Re-aim the shadow camera at a region. A single fixed extent is fine for one
   * part on a tile; a 150-node diagram spans far more than the shadow map can
   * cover at usable resolution, so the stage refits this as the view changes.
   */
  fitShadow(halfExtent: number, centre?: THREE.Vector3): void
}

export interface RigOptions {
  /** Half-extent of the shadow camera box. Catalog uses 2.6 per tile, 9 for the assembly. */
  bounds?: number
  shadowMapSize?: number
}

/**
 * Key casts a soft shadow, cool fill from the right, warm rim from behind.
 * Adds all four lights to `scene` and returns handles.
 */
export function makeRig(scene: THREE.Scene, o: RigOptions = {}): Rig {
  const bounds = o.bounds ?? 2.6
  const size = o.shadowMapSize ?? 768

  const key = new THREE.DirectionalLight(0xffffff, 1.55)
  key.position.set(-3.4, 5.6, 3.6)
  key.castShadow = true
  key.shadow.mapSize.set(size, size)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 24
  key.shadow.bias = -0.0012
  key.shadow.normalBias = 0.022
  key.shadow.radius = 3
  scene.add(key)
  scene.add(key.target)

  const fill = new THREE.DirectionalLight(0xa8c4ff, 0.46)
  fill.position.set(4.6, 1.5, 1.9)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffd2a0, 0.5)
  rim.position.set(1.3, 2.2, -4.4)
  scene.add(rim)

  const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x14171c, 0.28)
  scene.add(hemi)

  const offset = key.position.clone()

  const fitShadow = (halfExtent: number, centre = new THREE.Vector3()): void => {
    const cam = key.shadow.camera
    cam.left = -halfExtent
    cam.right = halfExtent
    cam.top = halfExtent
    cam.bottom = -halfExtent
    /* Keep the light's direction fixed and slide it with the region, so the
       shadow direction stays identical no matter where the camera is looking —
       the whole point of a locked rig. At the catalog's tile extent this
       resolves to exactly the catalog's own light position and far plane; it
       only pulls back once a diagram outgrows them. */
    const dist = Math.max(offset.length(), halfExtent * 2.4)
    cam.far = Math.max(24, dist * 2.2)
    key.position.copy(centre).addScaledVector(offset.clone().normalize(), dist)
    key.target.position.copy(centre)
    key.target.updateMatrixWorld()
    cam.updateProjectionMatrix()
  }

  fitShadow(bounds)

  return { key, fill, rim, hemi, fitShadow }
}
