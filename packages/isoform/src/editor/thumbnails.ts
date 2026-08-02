/**
 * Palette thumbnails.
 *
 * Rendered once at startup into a render target and read back as data URLs.
 * The catalog's live scissor-rect tiles are lovely but wrong here: a palette of
 * fifteen simultaneously-animating WebGL viewports competes with the editor
 * viewport for exactly the frame budget the diagram needs.
 */

import * as THREE from 'three'
import {
  PART_IDS,
  build,
  environmentTexture,
  makeRig,
  manifestFor,
  measure,
  frame as frameCamera,
  HERO_AZ,
  HERO_EL,
  HERO_FOV,
  type PartId,
} from '../index.js'

export function renderThumbnails(renderer: THREE.WebGLRenderer, size = 256): Map<PartId, string> {
  const out = new Map<PartId, string>()

  const scene = new THREE.Scene()
  scene.environment = environmentTexture(renderer)
  makeRig(scene, { shadowMapSize: 512 })

  const camera = new THREE.PerspectiveCamera(HERO_FOV, 1, 0.1, 200)
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 })
  rt.texture.colorSpace = THREE.SRGBColorSpace

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const prevTarget = renderer.getRenderTarget()
  const prevScissor = renderer.getScissorTest()
  renderer.setScissorTest(false)

  for (const id of PART_IDS) {
    /* The boundary is an enclosure, not something you drop from a palette. */
    if (id === 'boundary') continue

    const part = build(id)
    part.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mm = m.material as THREE.Material | undefined
      const soft = mm && (mm.transparent || mm.depthWrite === false)
      m.castShadow = !soft
      m.receiveShadow = !soft
    })
    scene.add(part.group)

    const f = frameCamera(measure(id), HERO_AZ, HERO_EL, HERO_FOV, 1, 1.18)
    camera.position.copy(f.position)
    camera.lookAt(f.target)
    camera.updateProjectionMatrix()

    renderer.setRenderTarget(rt)
    renderer.setViewport(0, 0, size, size)
    renderer.clear(true, true, true)
    renderer.render(scene, camera)

    const buf = new Uint8Array(size * size * 4)
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf)

    const img = ctx.createImageData(size, size)
    /* GL reads bottom-up. */
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4
      img.data.set(buf.subarray(src, src + size * 4), y * size * 4)
    }
    ctx.putImageData(img, 0, 0)
    out.set(id, canvas.toDataURL('image/png'))

    scene.remove(part.group)
  }

  renderer.setRenderTarget(prevTarget)
  renderer.setScissorTest(prevScissor)
  rt.dispose()
  return out
}

/** Palette groups, in the catalog's own order. */
export const PALETTE_GROUPS: Array<{ title: string; ids: PartId[] }> = [
  { title: 'Compute', ids: ['service', 'gateway', 'balancer', 'lambda', 'container', 'worker'] },
  { title: 'Data', ids: ['database', 'cache', 'blob', 'warehouse', 'search'] },
  { title: 'Messaging', ids: ['queue', 'stream'] },
  { title: 'Edge & network', ids: ['cdn', 'firewall', 'dns'] },
  { title: 'Control plane', ids: ['auth', 'monitor', 'registry'] },
  { title: 'AI', ids: ['model', 'vectordb'] },
  { title: 'Client & external', ids: ['client', 'mobile', 'external'] },
]

export function partLabel(id: PartId): string {
  return manifestFor(id).name
}
