/**
 * Instanced batching for nodes at merged detail.
 *
 * The merge pass took a part from ~30 draw calls to ~6, which was enough until
 * the diagram got large: 150 nodes still cost 967 calls, and with the shadow
 * pass doubling that, 2431 calls dominated the frame outright. Measured, the
 * budget went to call overhead rather than to triangles — halving the catalog's
 * triangle count bought 11ms of a 67ms frame, so the remaining 56ms was the
 * calls themselves.
 *
 * Every node of the same type, tint and stub state draws identical geometry with
 * identical materials, differing only by transform. That is exactly what an
 * `InstancedMesh` is for: one call per merged piece per *type*, not per node.
 *
 * ## What is not batched, and why
 *
 * · **Lines.** A Line has no per-instance form at all, so the handful of parts
 *   carrying line work — the edge node's meridians — keep it per-node.
 * · **Nodes at full detail.** A selected or hovered part shows its articulated
 *   rig with live animation. It leaves the batch while it does.
 *
 * Transparent pieces *are* batched, against the usual advice. They were 198 of
 * the 601 remaining draw calls — more than every opaque surface in the diagram
 * — and the cost of batching them is that instances within one batch are not
 * depth-sorted against each other. Every one is a small lit decal sitting on its
 * own part, so two overlapping on screen is rare and the artifact when it
 * happens is a decal drawn in the wrong order at a few pixels.
 *
 * ## Slot management
 *
 * Instances are kept dense: a batch's `count` is exactly its membership, and
 * removal swaps the last member into the hole rather than leaving gaps. Membership
 * changes are rare next to transforms — dragging a node rewrites one matrix and
 * touches nothing else, which is what keeps a drag cheap in a large diagram.
 */

import * as THREE from 'three'
import { instanceableLoose, mergedFor } from './merge.js'
import { overrideMaterials, type IsoMaterial } from '../foundry/materials.js'
import { manifestFor } from '../parts/registry.js'
import type { PartId } from '../parts/types.js'

/** Instances a fresh batch can hold before it has to grow. */
const INITIAL_CAPACITY = 16

/** Reused for matrix composition — this runs once per slice per moved node. */
const SCRATCH = new THREE.Matrix4()

/**
 * One InstancedMesh, plus the part-local transform its geometry sits at.
 *
 * Opaque pieces come out of the merge pass already baked into part space, so
 * their offset is identity. The loose pieces do not — they were kept as separate
 * objects precisely because they could not be baked into a shared buffer — so
 * each carries its own placement within the part, and an instance's matrix is
 * the node's world transform composed with it.
 */
interface Slice {
  mesh: THREE.InstancedMesh
  offset: THREE.Matrix4 | null
}

interface Batch {
  key: string
  type: PartId
  tint?: string
  stubs: boolean
  slices: Slice[]
  /** Dense; index is the instance index. */
  members: string[]
  index: Map<string, number>
  matrices: Map<string, THREE.Matrix4>
  capacity: number
}

/** One batch per distinct appearance. Anything that changes materials or geometry belongs in the key. */
export function batchKey(type: PartId, tint: string | undefined, stubs: boolean): string {
  return `${type}|${tint ?? ''}|${stubs ? 1 : 0}`
}

export class NodeBatcher {
  private batches = new Map<string, Batch>()
  /** Which batch each node currently sits in, so a change can vacate the old one. */
  private placement = new Map<string, string>()

  constructor(private readonly layer: THREE.Object3D) {}

  /**
   * Put `id` in the batch for this appearance, creating it if needed.
   *
   * Safe to call when nothing changed — it detects that the node is already in
   * the right batch and only refreshes the matrix.
   */
  set(id: string, type: PartId, tint: string | undefined, stubs: boolean, matrix: THREE.Matrix4): void {
    const key = batchKey(type, tint, stubs)
    const current = this.placement.get(id)
    if (current === key) {
      this.move(id, matrix)
      return
    }
    if (current) this.vacate(id, current)

    const batch = this.batches.get(key) ?? this.create(key, type, tint, stubs)
    if (batch.members.length >= batch.capacity) this.grow(batch)

    const slot = batch.members.length
    batch.members.push(id)
    batch.index.set(id, slot)
    batch.matrices.set(id, matrix.clone())
    this.placement.set(id, key)
    this.write(batch, slot, matrix)
    this.setCount(batch, batch.members.length)
  }

  /** Update one node's transform. The hot path during a drag. */
  move(id: string, matrix: THREE.Matrix4): void {
    const key = this.placement.get(id)
    if (!key) return
    const batch = this.batches.get(key)
    if (!batch) return
    const slot = batch.index.get(id)
    if (slot === undefined) return
    batch.matrices.get(id)?.copy(matrix)
    this.write(batch, slot, matrix)
  }

  remove(id: string): void {
    const key = this.placement.get(id)
    if (!key) return
    this.vacate(id, key)
    this.placement.delete(id)
  }

  has(id: string): boolean {
    return this.placement.has(id)
  }

  /** Draw calls the batched layer currently costs. */
  get drawCalls(): number {
    let n = 0
    for (const b of this.batches.values()) if (b.members.length) n += b.slices.length
    return n
  }

  get batchCount(): number {
    let n = 0
    for (const b of this.batches.values()) if (b.members.length) n++
    return n
  }

  dispose(): void {
    for (const b of this.batches.values()) {
      for (const s of b.slices) {
        s.mesh.removeFromParent()
        s.mesh.dispose()
      }
    }
    this.batches.clear()
    this.placement.clear()
  }

  /* ---------------------------------------------------------------- */

  private create(key: string, type: PartId, tint: string | undefined, stubs: boolean): Batch {
    const batch: Batch = {
      key,
      type,
      tint,
      stubs,
      slices: [],
      members: [],
      index: new Map(),
      matrices: new Map(),
      capacity: INITIAL_CAPACITY,
    }
    this.batches.set(key, batch)
    this.allocate(batch)
    return batch
  }

  /** Build the InstancedMeshes for a batch at its current capacity. */
  private allocate(batch: Batch): void {
    const merged = mergedFor(batch.type, batch.stubs)
    const sub = this.tintMap(batch)

    const add = (
      geometry: THREE.BufferGeometry,
      src: THREE.Material,
      offset: THREE.Matrix4 | null,
      shadow: boolean,
    ): void => {
      const material = sub?.get(src as IsoMaterial) ?? src
      const mesh = new THREE.InstancedMesh(geometry, material, batch.capacity)
      /* Transforms change on every drag, so the buffer must not be uploaded
         once and cached. */
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = shadow
      mesh.receiveShadow = shadow
      mesh.count = 0
      /* Instance transforms are written directly into the buffer; the container
         itself never moves, so three need not re-derive its world matrix. */
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = false
      batch.slices.push({ mesh, offset })
      this.layer.add(mesh)
    }

    for (const piece of merged.opaque) add(piece.geometry, piece.material, null, true)

    /* Transparent pieces batch too. They keep `castShadow` off, exactly as the
       merge pass left them, and they sort as one object per type rather than
       one per node — which is the trade: instances within a batch are not
       depth-sorted against each other. These are small lit decals on separate
       parts, so two rarely overlap; the alternative was 198 draw calls, more
       than every opaque surface in the diagram combined. */
    for (const loose of instanceableLoose(merged)) {
      loose.updateMatrix()
      add(loose.geometry, loose.material as THREE.Material, loose.matrix.clone(), false)
    }
  }

  /**
   * Tint substitution for a batch, or null when it is untinted.
   *
   * Reuses the same `overrideMaterials` path a per-node tint goes through, so a
   * batched node and an articulated one of the same tint resolve to the *same*
   * cached material rather than two that merely look alike.
   */
  private tintMap(batch: Batch): Map<IsoMaterial, IsoMaterial> | null {
    if (!batch.tint) return null
    const merged = mergedFor(batch.type, batch.stubs)
    const mats = merged.opaque.map((p) => p.material as IsoMaterial)
    const map = overrideMaterials(mats, manifestFor(batch.type).cat, batch.tint)
    return map.size ? map : null
  }

  /** Double capacity, rebuilding the meshes and replaying every matrix. */
  private grow(batch: Batch): void {
    for (const s of batch.slices) {
      s.mesh.removeFromParent()
      s.mesh.dispose()
    }
    batch.slices = []
    batch.capacity *= 2
    this.allocate(batch)
    batch.members.forEach((id, slot) => {
      const mx = batch.matrices.get(id)
      if (mx) this.write(batch, slot, mx)
    })
    this.setCount(batch, batch.members.length)
  }

  private vacate(id: string, key: string): void {
    const batch = this.batches.get(key)
    if (!batch) return
    const slot = batch.index.get(id)
    if (slot === undefined) return

    /* Swap the last member into the hole so instances stay dense — a batch with
       gaps would either draw stale transforms or need a per-slot occupancy test
       every frame. */
    const last = batch.members.length - 1
    if (slot !== last) {
      const moved = batch.members[last]
      batch.members[slot] = moved
      batch.index.set(moved, slot)
      const mx = batch.matrices.get(moved)
      if (mx) this.write(batch, slot, mx)
    }
    batch.members.pop()
    batch.index.delete(id)
    batch.matrices.delete(id)
    this.setCount(batch, batch.members.length)
  }

  private write(batch: Batch, slot: number, matrix: THREE.Matrix4): void {
    for (const s of batch.slices) {
      /* Compose rather than replace: a loose piece's placement inside the part
         is not in the node's world matrix, and dropping it would collapse every
         decal onto the part's origin. */
      s.mesh.setMatrixAt(slot, s.offset ? SCRATCH.multiplyMatrices(matrix, s.offset) : matrix)
      s.mesh.instanceMatrix.needsUpdate = true
    }
  }

  private setCount(batch: Batch, count: number): void {
    for (const { mesh: m } of batch.slices) {
      m.count = count
      /* An empty batch is left allocated but invisible: emptying and refilling
         is common (select all, deselect) and reallocating each time would cost
         more than the handful of bytes an idle batch holds. */
      m.visible = count > 0
    }
  }
}

/** Diagnostics: how many draw calls a set of node types costs batched vs not. */
export function batchStats(types: Iterable<PartId>): { batched: number; perNode: number } {
  let batched = 0
  let perNode = 0
  for (const t of new Set(types)) batched += mergedFor(t).opaque.length
  for (const t of types) perNode += mergedFor(t).calls
  return { batched, perNode }
}

