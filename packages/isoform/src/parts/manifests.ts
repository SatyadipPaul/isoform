/**
 * Part manifests — the metadata a catalog never needed but an engine cannot
 * work without: how much ground a part occupies, where a connector may land on
 * it, and how to frame it.
 *
 * FOOTPRINT IS NOT THE BOUNDING BOX. Several parts carry decorative connector
 * stubs that reach well past the body — the gateway's three input tubes run out
 * to x=-1.9, the balancer's three arms to x=1.2, the queue's exit arrow past the
 * channel. Snapping and route-obstacle tests want the body, not the stubs, so
 * `footprint` is a declared design value. The registry measures the true extent
 * separately and stores it as `bounds`; `manifests.test.ts` checks that the
 * declared footprint never exceeds the measured geometry and flags any part
 * where the two diverge enough to be worth a second look.
 *
 * EVERY PART HAS THE SAME FOUR ANCHORS. Parts used to declare their own port
 * sets — the gateway three-in/one-out, the queue in/out, the boundary none —
 * which meant you could not predict where a connector would attach without
 * knowing the part. Each manifest now declares only `portY`, the height at
 * which connectors meet it, and the four compass anchors are derived.
 *
 * The semantics that model carried survive through fan-spreading: several
 * connectors may share one anchor and get spread across that face, so a gateway
 * still reads as three routes arriving on its west side.
 */

import type { PartId, PartManifest, PortSpec } from './types.js'

/**
 * The four compass anchors, at the centre of each footprint face.
 *
 * Derived rather than declared per part, so no part can drift out of the
 * uniform model — which is the whole basis of predictable connector snapping.
 */
function ports(y: number): PortSpec[] {
  return [
    { id: 'n', side: '-z', y },
    { id: 'e', side: '+x', y },
    { id: 's', side: '+z', y },
    { id: 'w', side: '-x', y },
  ]
}

/** Build the port set and the height it came from in one go. */
function anchors(y: number): { portY: number; ports: PortSpec[] } {
  return { portY: y, ports: ports(y) }
}

export const MANIFESTS: Record<PartId, PartManifest> = {
  service: {
    id: 'service',
    name: 'Service',
    pn: 'CMP-01',
    cat: 'compute',
    finish: 'Powder-coat + anodised',
    /* 1.84 not 1.62: the mounting ears are solid structure and must reserve ground. */
    footprint: { w: 1.84, d: 1.22 },
    height: 0.71,
    ...anchors(0.36),
    camera: { dist: 3.5, target: [0, 0.4, 0] },
    desc: '2U rack chassis: mounting ears with hex screws, four drive bays, perforated intake, rubber foot rail.',
    spec: ['1.62 × 0.66 × 1.16u', '4 bays'],
  },

  gateway: {
    id: 'gateway',
    name: 'API gateway',
    pn: 'CMP-02',
    cat: 'compute',
    finish: 'Moulded polymer',
    /* Measured extent is 4.08 wide, but ~2u of that is the modelled input and
       output pipework. Those represent connections, so they must not reserve
       ground or block routes — footprint is the gate body only.

       Depth was 1.16, which is the *service* chassis depth and appears to have
       been copied from it: the gate's deepest element is its base plate at
       1.05. Over-declaring reserves ground the part does not occupy, so it
       pushed neighbours away and gave the router a phantom obstacle. Caught by
       manifests.test.ts, which is the reason that file now exists. */
    footprint: { w: 2.0, d: 1.05 },
    height: 1.61,
    /* Low, to meet the modelled pipework height the gate was drawn around. */
    ...anchors(0.34),
    camera: { dist: 4.3, target: [0, 0.65, 0] },
    desc: 'An actual gate. Three routes enter, one leaves through the lit aperture between the jambs.',
    spec: ['2.0 × 1.05u', '3→1'],
  },

  balancer: {
    id: 'balancer',
    name: 'Load balancer',
    pn: 'CMP-03',
    cat: 'compute',
    finish: 'Anodised aluminium',
    /* Includes the three legs: unlike the gateway's pipework these are the
       part, and ports sitting at the leg ends is exactly right.

       It should not include the flow arrows on the ends of those legs, which
       are stubs — struck the moment a real connector lands. Was 2.78 × 1.3,
       measured body 2.43 × 1.19. */
    footprint: { w: 2.43, d: 1.19 },
    height: 0.8,
    ...anchors(0.46),
    camera: { dist: 3.9, target: [0.1, 0.5, 0] },
    desc: 'Flow manifold — a single header with a spinning balance vane feeding three flanged legs.',
    spec: ['⌀0.6 header', '1→3'],
  },

  lambda: {
    id: 'lambda',
    name: 'Serverless',
    pn: 'CMP-04',
    cat: 'compute',
    finish: 'Moulded polymer',
    footprint: { w: 1.27, d: 1.27 },
    height: 1.35,
    ...anchors(0.42),
    camera: { dist: 3.2, target: [0, 0.78, 0] },
    desc: 'The λ glyph in three filleted strokes, floating clear of its own datum rings.',
    spec: ['0.2u stroke', 'Detached'],
  },

  container: {
    id: 'container',
    name: 'Container',
    pn: 'CMP-05',
    cat: 'compute',
    finish: 'Corrugated powder-coat',
    footprint: { w: 1.81, d: 1.6 },
    height: 1.22,
    ...anchors(0.4),
    camera: { dist: 3.7, target: [0, 0.55, 0] },
    desc: 'A shipping container: normal-mapped corrugation, eight corner castings, door end with locking bars.',
    spec: ['1.3 × 0.62 × 0.66u', 'Stacks ×n'],
  },

  worker: {
    id: 'worker',
    name: 'Worker',
    pn: 'CMP-06',
    cat: 'compute',
    finish: 'Powder-coat + anodised',
    /* Width covers the arm at rest, which overhangs the bench — the arm also
       sweeps ±0.5 rad in yaw, so it passes outside this. That is fine: nothing
       collides at runtime, and reserving the whole swept disc would make a
       worker claim three times the ground it stands on. The sweep was ±0.8,
       which threw the arm 2.5u deep over a 0.86u bench and read as flailing. */
    footprint: { w: 2.0, d: 0.86 },
    height: 1.21,
    ...anchors(0.3),
    camera: { dist: 3.5, target: [0, 0.45, 0] },
    desc: 'Articulated arm over a parts tray — the consumer end of a queue, working through what it is handed.',
    spec: ['2-axis arm', 'Pick / place'],
  },

  model: {
    id: 'model',
    name: 'Model endpoint',
    pn: 'CMP-07',
    cat: 'compute',
    finish: 'Anodised frame + acrylic',
    footprint: { w: 1.75, d: 0.72 },
    height: 1.12,
    ...anchors(0.5),
    camera: { dist: 3.7, target: [0, 0.62, 0] },
    desc: 'Five layers of nodes wired to their neighbours, with an activation travelling front to back.',
    spec: ['5 layers', '3-4-4-4-3'],
  },

  database: {
    id: 'database',
    name: 'Relational store',
    pn: 'DAT-01',
    cat: 'data',
    finish: 'Polymer + steel bands',
    footprint: { w: 1.52, d: 1.52 },
    height: 1.18,
    ...anchors(0.55),
    camera: { dist: 3.4, target: [0, 0.58, 0] },
    desc: 'Three stacked platters with machined bands between them — the canonical cylinder, built as discs.',
    spec: ['⌀1.48 × 1.16u', '3 platters'],
  },

  cache: {
    id: 'cache',
    name: 'Cache',
    pn: 'DAT-02',
    cat: 'data',
    finish: 'Polymer + emissive',
    /* Wider than the drum: the datum halo sits on the ground at r=0.98 and
       another part overlapping it would look like a collision. Height clears
       the floating bolt badge, not just the drum. */
    footprint: { w: 1.98, d: 1.98 },
    height: 1.08,
    ...anchors(0.28),
    camera: { dist: 3.2, target: [0, 0.44, 0] },
    desc: 'Short drum under a lit bolt badge, with a datum halo that pulses. Reads hot at a glance.',
    spec: ['⌀1.56 × 0.46u', 'Emissive'],
  },

  blob: {
    id: 'blob',
    name: 'Object storage',
    pn: 'DAT-03',
    cat: 'data',
    finish: 'Polymer + steel',
    /* Lugs and wire handle, not just the pail. */
    footprint: { w: 1.74, d: 1.71 },
    height: 1.71,
    ...anchors(0.45),
    camera: { dist: 3.4, target: [0, 0.5, 0] },
    desc: 'A literal bucket — bellied wall, rolled rim, lugs and a wire handle, objects settling inside.',
    spec: ['⌀1.6 × 1.0u', 'Rolled rim'],
  },

  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    pn: 'DAT-04',
    cat: 'data',
    finish: 'Powder-coat + anodised',
    footprint: { w: 2.1, d: 1.44 },
    height: 1.36,
    /* Dock height, so a route lands level with the roller shutters. */
    ...anchors(0.4),
    camera: { dist: 4.1, target: [0, 0.55, 0] },
    desc: 'Barrel-vault roof over two normal-mapped roller shutters, rubber dock bumpers, lit clerestory.',
    spec: ['2.0 × 1.3u', '2 bays'],
  },

  search: {
    id: 'search',
    name: 'Search index',
    pn: 'DAT-05',
    cat: 'data',
    finish: 'Powder-coat + anodised',
    /* The open drawer reaches forward of the carcass and is body, not stub —
       a part cannot be placed so close that something sits inside the drawer. */
    footprint: { w: 1.48, d: 1.63 },
    height: 1.7,
    ...anchors(0.55),
    camera: { dist: 3.8, target: [0, 0.75, 0] },
    desc: 'Card-catalog cabinet with one drawer standing open — an inverted index, which is what a card catalog was.',
    spec: ['4 drawers', 'Riffling'],
  },

  vectordb: {
    id: 'vectordb',
    name: 'Vector store',
    pn: 'DAT-06',
    cat: 'data',
    finish: 'Anodised cage',
    footprint: { w: 1.5, d: 1.5 },
    height: 1.42,
    ...anchors(0.6),
    camera: { dist: 3.7, target: [0, 0.7, 0] },
    desc: 'An embedding space in a cage: a fixed cloud of points with one query and its three nearest neighbours lit.',
    spec: ['26 points', 'k = 3'],
  },

  queue: {
    id: 'queue',
    name: 'Queue',
    pn: 'MSG-01',
    cat: 'msg',
    finish: 'Cast acrylic',
    /* The channel is exactly 2.5 long; the extra 0.49 of measured extent is the
       exit arrowhead, which marks where a connection leaves rather than being
       part of the vessel. */
    footprint: { w: 2.5, d: 0.8 },
    height: 0.89,
    ...anchors(0.46),
    camera: { dist: 3.6, target: [0, 0.44, 0] },
    desc: 'Open channel with clamp rings carrying three envelopes — flap embossed — strictly first in, first out.',
    spec: ['1.7 × ⌀0.8u', 'FIFO'],
  },

  stream: {
    id: 'stream',
    name: 'Event stream',
    pn: 'MSG-02',
    cat: 'msg',
    finish: 'Polymer + acrylic',
    footprint: { w: 2.2, d: 1.35 },
    height: 0.37,
    ...anchors(0.22),
    camera: { dist: 3.7, target: [0, 0.25, 0] },
    desc: 'Three partitions of an append-only log. Written segments are solid, unwritten are acrylic, heads travel independently.',
    spec: ['3 × 9 segments', 'Append-only'],
  },

  cdn: {
    id: 'cdn',
    name: 'Edge node',
    pn: 'NET-01',
    cat: 'edge',
    finish: 'Polymer + steel',
    /* Globe is ⌀1.52; the extra width is surface pins and the routed arcs
       bulging to R×1.34, which are part of the object. */
    footprint: { w: 1.84, d: 1.64 },
    height: 1.76,
    ...anchors(0.45),
    camera: { dist: 3.5, target: [0, 0.9, 0] },
    desc: 'A globe with eight meridians, three parallels, six surface pins and routed arcs between them.',
    spec: ['⌀1.52u', '6 PoPs'],
  },

  firewall: {
    id: 'firewall',
    name: 'Firewall',
    pn: 'NET-02',
    cat: 'edge',
    finish: 'Brick powder-coat',
    /* 2.0 is the plinth course, which is the widest element. */
    footprint: { w: 2.0, d: 0.44 },
    height: 1.35,
    /* At the lit slit, so a route reads as passing through the barrier. */
    ...anchors(0.68),
    camera: { dist: 3.7, target: [0, 0.66, 0] },
    desc: 'Brick wall with a real mortar recess baked into the normal map, buttressed ends, coping course on top.',
    spec: ['1.9 × 1.2u', 'Stretcher bond'],
  },

  dns: {
    id: 'dns',
    name: 'DNS',
    pn: 'NET-03',
    cat: 'edge',
    finish: 'Anodised post + polymer boards',
    /* The fingerboards are body — they are the part — but they point off-axis
       at four different headings, so the ground they cover is a disc. Declared
       square to it rather than to any one arm. */
    footprint: { w: 1.7, d: 1.7 },
    height: 1.76,
    ...anchors(0.5),
    camera: { dist: 3.6, target: [0, 1.0, 0] },
    desc: 'A signpost. Four fingerboards at four headings — resolution is which way to a name, and this is the object that has always meant that.',
    spec: ['4 boards', 'Sway ±9°'],
  },

  auth: {
    id: 'auth',
    name: 'Identity',
    pn: 'OPS-01',
    cat: 'ops',
    finish: 'Moulded polymer + steel',
    footprint: { w: 0.84, d: 0.84 },
    height: 1.65,
    ...anchors(0.5),
    camera: { dist: 3.3, target: [0, 0.95, 0] },
    desc: 'Badge reader on a pedestal, card presented to it. The act of checking a credential, not the property of being locked.',
    spec: ['Key glyph', 'Accept pulse'],
  },

  monitor: {
    id: 'monitor',
    name: 'Observability',
    pn: 'OPS-02',
    cat: 'ops',
    finish: 'Powder-coat + anodised bezels',
    /* 1.5, the panel. It was 1.61 because a slab meant to mask the strip chart
       overhung the panel's right edge by 0.11 — the footprint test measured the
       defect faithfully and the manifest recorded it. */
    footprint: { w: 1.5, d: 0.5 },
    height: 1.38,
    ...anchors(0.45),
    camera: { dist: 3.4, target: [0, 0.9, 0] },
    desc: 'Instrument cluster: two graduated gauges with sweeping needles and a strip chart scrolling behind a masked window.',
    spec: ['2 gauges', '22-bar trace'],
  },

  registry: {
    id: 'registry',
    name: 'Service registry',
    pn: 'OPS-03',
    cat: 'ops',
    finish: 'Anodised cradle + polymer cards',
    footprint: { w: 1.34, d: 0.96 },
    height: 1.1,
    ...anchors(0.45),
    camera: { dist: 3.4, target: [0, 0.72, 0] },
    desc: 'Rotary card index turning under a read head — where a service is right now, looked up against a spinning directory.',
    spec: ['20 cards', 'Read head'],
  },

  client: {
    id: 'client',
    name: 'Client device',
    pn: 'CLI-01',
    cat: 'client',
    finish: 'Polymer + rubber base',
    /* Depth is set by the weighted base and the panel's 8° tilt, not the panel. */
    footprint: { w: 1.56, d: 1.11 },
    height: 1.66,
    ...anchors(0.45),
    camera: { dist: 3.7, target: [0, 0.82, 0] },
    desc: 'Monitor on a weighted stand. The panel is a drawn browser window — chrome, URL pill, content blocks — used as the emissive map.',
    spec: ['1.56 × 1.0u', 'Tilt 8°'],
  },

  actor: {
    id: 'actor',
    name: 'Person',
    pn: 'CLI-04',
    cat: 'client',
    finish: 'Polymer + rubber base',
    /* The weighted disc, not the shoulders: the base is the widest thing and is
       what a neighbour would collide with. */
    footprint: { w: 0.9, d: 0.9 },
    height: 1.61,
    ...anchors(0.5),
    camera: { dist: 3.9, target: [0, 0.85, 0] },
    desc: 'Mannequin on a weighted disc. No face and no limbs: an actor has to stand beside equipment without becoming the subject, and it is symmetrical so a turntable never catches its back.',
    spec: ['0.9 × 0.9u', 'Stands 1.61u'],
  },

  mobile: {
    id: 'mobile',
    name: 'Handset',
    pn: 'CLI-02',
    cat: 'client',
    finish: 'Polymer + rubber base',
    footprint: { w: 0.6, d: 0.42 },
    height: 1.23,
    ...anchors(0.35),
    camera: { dist: 2.9, target: [0, 0.66, 0] },
    desc: 'Handset in a desk cradle. Same drawn browser as the monitor, cropped to a tall viewport so it reads as mobile.',
    spec: ['0.6 × 1.12u', 'Tilt 15°'],
  },

  external: {
    id: 'external',
    name: 'Third party',
    pn: 'CLI-03',
    cat: 'client',
    finish: 'Frosted acrylic dome',
    footprint: { w: 1.3, d: 1.3 },
    height: 0.76,
    ...anchors(0.35),
    camera: { dist: 3.1, target: [0, 0.42, 0] },
    desc: 'A machine under frosted acrylic — deliberately unreadable, which is exactly what somebody else’s service is in your diagram.',
    spec: ['⌀1.2 dome', 'Opaque'],
  },

  boundary: {
    id: 'boundary',
    name: 'Group boundary',
    pn: 'GRP-01',
    cat: 'compute',
    finish: 'Cast acrylic + lit outline',
    footprint: { w: 5.1, d: 4.5 },
    height: 1.5,
    /* An enclosure is not usually a connection endpoint, but it keeps the same
       four anchors as everything else — a uniform model with an exception is
       not a uniform model. Mid-height, so a route meets it on the face. */
    ...anchors(0.75),
    camera: { dist: 9.7, target: [0, 0.75, 0] },
    desc: 'Translucent volume with a lit wireframe outline. Encloses a VPC, an availability zone, a trust boundary.',
    spec: ['Resizable', 'Non-routing'],
  },
}

export const PART_IDS = Object.keys(MANIFESTS) as PartId[]

export function manifest(id: PartId): PartManifest {
  return MANIFESTS[id]
}
