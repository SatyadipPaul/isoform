/**
 * Merge pass.
 *
 * A `service` is about thirty meshes. Thirty draw calls per instance is fine for
 * a catalog tile and ruinous for a hundred-and-fifty-node diagram, so each part
 * type is flattened once into a handful of geometries — one per distinct
 * material — with every local transform baked into the vertices.
 *
 * Built per *type*, not per instance: merging bakes a part's internal transforms
 * but not its placement in the world, so every `service` in a document shares
 * one merged set and pays for it once.
 *
 * Three things deliberately survive unmerged:
 *
 *   · Transparent meshes, which need their own draw calls to blend in order.
 *   · Lines, which cannot share geometry with triangles.
 *   · The baked contact blob, which is dropped entirely — at this density the
 *     real shadow map does the work and a hundred-odd depth-write-off quads
 *     cost more in overdraw than they return.
 */

import * as THREE from 'three'
import { build } from '../parts/registry.js'
import type { PartId } from '../parts/types.js'

export interface MergedPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export interface MergedPart {
  /** Concatenated opaque geometry, one entry per material. */
  opaque: MergedPiece[]
  /** Kept individual: blending order matters. Matrices are pre-baked. */
  loose: Array<{ object: THREE.Object3D }>
  /** Draw calls one instance of this part costs at merged detail. */
  calls: number
}

const ATTRS = ['position', 'normal', 'uv'] as const

/**
 * Concatenate geometries that share a material.
 *
 * Restricted to position/normal/uv — the only attributes the part builders
 * produce that lighting needs. A missing uv is filled with zeros rather than
 * skipping the geometry, since several lathe and extrude paths omit it.
 */
function concat(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geoms.length) return null
  if (geoms.length === 1) return geoms[0]

  let verts = 0
  let indices = 0
  for (const g of geoms) {
    const pos = g.getAttribute('position')
    if (!pos) return null
    verts += pos.count
    indices += g.index ? g.index.count : pos.count
  }

  const out = new THREE.BufferGeometry()
  for (const name of ATTRS) {
    const itemSize = name === 'uv' ? 2 : 3
    const array = new Float32Array(verts * itemSize)
    let offset = 0
    for (const g of geoms) {
      const src = g.getAttribute(name)
      const count = g.getAttribute('position').count
      if (src && src.itemSize === itemSize) {
        array.set(src.array as ArrayLike<number>, offset)
      }
      /* Absent attribute: leave the span at zero. */
      offset += count * itemSize
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
  }

  const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  let io = 0
  let vo = 0
  for (const g of geoms) {
    const count = g.getAttribute('position').count
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + vo
    } else {
      for (let i = 0; i < count; i++) index[io++] = i + vo
    }
    vo += count
  }
  out.setIndex(new THREE.BufferAttribute(index, 1))
  out.computeBoundingSphere()
  return out
}

/**
 * Flatten a built part into merged geometry plus whatever cannot be merged.
 *
 * `withStubs` is baked in rather than toggled afterwards: once meshes are
 * concatenated there is no per-mesh visibility left to switch, so a part that
 * can appear both connected and unconnected needs one merged form of each.
 */
export function mergePart(root: THREE.Object3D, withStubs = true): MergedPart {
  root.updateMatrixWorld(true)
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  return collect([root], toRoot, (o) => (withStubs ? false : !!o.userData.isStub))
}

/**
 * Merge already-world-positioned objects, keeping them in world space.
 *
 * Connectors are built directly from resolved route points, so their geometry
 * is world-space to begin with and there is nothing to bake — which makes them
 * mergeable by exactly the same concatenation as a part's internals, with an
 * identity transform instead of a part-local one.
 */
export function mergeWorld(roots: Iterable<THREE.Object3D>): MergedPart {
  return collect(roots, new THREE.Matrix4(), () => false)
}

/**
 * Shared traversal: bucket geometry by material, transformed into `toRoot`.
 *
 * `skip` drops a subtree's own contribution without stopping the walk, which is
 * how stub exclusion works — the alternative, pruning children, would also drop
 * anything a stub happens to parent.
 */
function collect(
  roots: Iterable<THREE.Object3D>,
  toRoot: THREE.Matrix4,
  skip: (o: THREE.Object3D) => boolean,
): MergedPart {
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const loose: Array<{ object: THREE.Object3D }> = []

  const visit = (o: THREE.Object3D): void => {
    if (o.userData.isShadow) return
    if (skip(o)) return

    const asMesh = o as THREE.Mesh
    if (!asMesh.isMesh) {
      /* Lines cannot join a triangle buffer; carry them across as-is. */
      if ((o as THREE.Line).isLine) {
        const clone = o.clone()
        clone.matrix.copy(new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld))
        clone.matrix.decompose(clone.position, clone.quaternion, clone.scale)
        loose.push({ object: clone })
      }
      return
    }

    const mat = asMesh.material as THREE.Material
    if (Array.isArray(asMesh.material) || !asMesh.geometry) return

    const local = new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld)

    if (mat.transparent || mat.depthWrite === false) {
      const clone = new THREE.Mesh(asMesh.geometry, mat)
      clone.applyMatrix4(local)
      clone.castShadow = false
      clone.receiveShadow = false
      loose.push({ object: clone })
      return
    }

    const baked = asMesh.geometry.clone().applyMatrix4(local)
    const list = byMaterial.get(mat)
    if (list) list.push(baked)
    else byMaterial.set(mat, [baked])
  }

  for (const root of roots) {
    root.updateMatrixWorld(true)
    root.traverse(visit)
  }

  const opaque: MergedPiece[] = []
  for (const [material, geoms] of byMaterial) {
    const geometry = concat(geoms)
    if (!geometry) continue
    /* The per-mesh clones were only scaffolding for the concatenation. */
    for (const g of geoms) if (g !== geometry) g.dispose()
    opaque.push({ geometry, material })
  }

  return { opaque, loose, calls: opaque.length + loose.length }
}

const cache = new Map<string, MergedPart>()

/** Merged form of a part type, built on first use. */
export function mergedFor(id: PartId, withStubs = true): MergedPart {
  const key = `${id}|${withStubs ? 1 : 0}`
  const hit = cache.get(key)
  if (hit) return hit
  const made = mergePart(build(id).group, withStubs)
  cache.set(key, made)
  return made
}

/**
 * A scene group for one instance at merged detail.
 *
 * Geometry and materials are shared with every other instance of the type, so
 * this costs a handful of Mesh wrappers and no GPU allocation.
 *
 * `opaqueToo` is false when a `NodeBatcher` owns the opaque pieces — they are
 * then drawn once for every instance of the type as an `InstancedMesh`, and
 * emitting per-node copies as well would draw the part twice. The loose pieces
 * stay per-node either way: blending is order-dependent and lines cannot share
 * a triangle buffer, which is why the merge pass set them aside to begin with.
 */
export function instantiateMerged(m: MergedPart, mode: InstantiateMode = 'all'): THREE.Group {
  const g = new THREE.Group()
  if (mode === 'all') {
    for (const piece of m.opaque) {
      const mesh = new THREE.Mesh(piece.geometry, piece.material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      g.add(mesh)
    }
  }
  for (const l of m.loose) {
    /* `lines` leaves the transparent meshes to the batcher and keeps only what
       instancing cannot express: a Line has no per-instance form at all. */
    if (mode === 'lines' && !(l.object as THREE.Line).isLine) continue
    g.add(l.object.clone())
  }
  return g
}

/**
 * How much of a merged part to realise as per-node objects.
 *
 * `all` — everything, for a scene with no batcher.
 * `lines` — only the line work, because a `NodeBatcher` owns the rest.
 */
export type InstantiateMode = 'all' | 'lines'

/** Loose pieces a batcher can take: meshes yes, lines no. */
export function instanceableLoose(m: MergedPart): THREE.Mesh[] {
  return m.loose.map((l) => l.object).filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh)
}

/** Diagnostics: draw calls one instance costs, merged versus articulated. */
export function mergeStats(id: PartId): { merged: number; full: number } {
  const merged = mergedFor(id)
  let full = 0
  build(id).group.traverse((o) => {
    if (o.userData.isShadow) return
    if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine) full++
  })
  return { merged: merged.calls, full }
}

export function clearMergeCache(): void {
  for (const m of cache.values()) for (const p of m.opaque) p.geometry.dispose()
  cache.clear()
}
