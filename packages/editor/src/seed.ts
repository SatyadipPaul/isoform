/**
 * Opening document.
 *
 * The catalog's reference assembly, expressed as a Doc. It doubles as the M2
 * end-to-end check: this is the same topology the plan says a user should be
 * able to build by hand through the editor and get back.
 */

import { emptyDoc, fitGroups, type Doc } from '@isoform/engine'

const BASE: Doc = {
  ...emptyDoc(),
  nodes: [
    { id: 'n1', type: 'client', pos: [-7, 0], rot: 0, label: 'Browser' },
    { id: 'n2', type: 'cdn', pos: [-4, -3], rot: 0, label: 'Edge' },
    { id: 'n3', type: 'gateway', pos: [-3.5, 1], rot: 0, label: 'API' },
    { id: 'n4', type: 'service', pos: [1, -2.5], rot: 0, label: 'Orders' },
    { id: 'n5', type: 'service', pos: [1, 2.5], rot: 0, label: 'Billing' },
    { id: 'n6', type: 'database', pos: [5.5, -2.5], rot: 0, label: 'Postgres' },
    { id: 'n7', type: 'cache', pos: [5.5, 2.5], rot: 0, label: 'Redis' },
  ],
  edges: [
    { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'sync', route: 'auto' },
    { id: 'e2', from: { node: 'n2' }, to: { node: 'n3' }, kind: 'sync', route: 'auto' },
    { id: 'e3', from: { node: 'n1' }, to: { node: 'n3' }, kind: 'secure', route: 'auto' },
    { id: 'e4', from: { node: 'n3' }, to: { node: 'n4' }, kind: 'sync', route: 'auto' },
    { id: 'e5', from: { node: 'n3' }, to: { node: 'n5' }, kind: 'sync', route: 'auto' },
    { id: 'e6', from: { node: 'n4' }, to: { node: 'n6' }, kind: 'flow', route: 'auto' },
    { id: 'e7', from: { node: 'n5' }, to: { node: 'n7' }, kind: 'async', route: 'auto' },
  ],
  groups: [
    {
      id: 'g1',
      label: 'Service tier',
      cat: 'compute',
      /* Box is derived from membership by fitGroups; these are placeholders. */
      pos: [0, 0],
      size: [4, 1.5, 4],
      members: ['n4', 'n5'],
    },
  ],
}

export const SEED_DOC: Doc = { ...BASE, groups: fitGroups(BASE) }
