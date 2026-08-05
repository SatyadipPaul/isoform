import { it } from 'vitest'
import * as THREE from 'three'
import { build } from '../packages/isoform/src/parts/registry.js'
import { stripStubs } from '../packages/isoform/src/foundry/geometry.js'

it('probe', () => {
  const p = build('actor')
  stripStubs(p.group)
  p.group.updateWorldMatrix(true, true)
  p.group.traverse((o: any) => {
    if (!o.isMesh) return
    const b = new THREE.Box3().setFromObject(o)
    const s = b.getSize(new THREE.Vector3())
    console.log(
      (o.geometry.type as string).padEnd(18),
      'w', s.x.toFixed(3), 'h', s.y.toFixed(3), 'd', s.z.toFixed(3),
      '| visible', o.visible,
    )
  })
})
