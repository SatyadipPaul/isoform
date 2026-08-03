# Changelog

## 0.6.0 — Labels you can actually read

Every diagram in this release is measured against the same five reference
architectures — Netflix, Uber, a RAG pipeline, WhatsApp and a URL shortener —
rendered through the shipping camera and counted in pixels rather than described.

### The declutter pass had never run

`declutter` slides overlapping nameplates apart. Rewritten to work in screen
space, it projected each plate through one shared scratch vector:

```js
const edge = probe.copy(c).addScaledVector(right, width / 2).project(camera)
const top  = probe.copy(c).setY(...).project(camera)   // same object
hw: Math.abs(edge.x - x)                               // reads the vertical probe
```

`edge` and `top` were the same object, so every plate's half-width was measured
off the *vertical* probe and came out at roughly zero. Nothing ever registered as
overlapping and the pass did nothing at all — silently, because a declutter that
finds no overlaps is indistinguishable from one that finds none to fix.

**Across the five: 5 colliding pairs, worst 69% of a plate buried. Now 0.**

### Separation solved, not approached

Pushing overlapping pairs apart and repeating does not reliably settle — each fix
disturbs a neighbour, and six tags inside two world units were still overlapping
after six passes. Keeping the tags in left-to-right order turns the problem into
a chain: separate each neighbouring pair and every pair is separated, because the
gaps accumulate. Subtracting the required gaps leaves plain isotonic regression,
which pool-adjacent-violators solves exactly in one pass, with the least total
movement and without ever letting one tag overtake another.

### Tags draw over the model

A tag is an annotation, not a prop, and a name the geometry in front of it eats
is worse than no name. **Eleven plates were more than 5% swallowed by parts and
trace arrows, one of them 80%. Now none.**

The lift is applied to a *clone* of the plate material, because the palette hands
the same cached material to a plate and to any part of the same category —
setting `depthTest = false` on what the cache returns turns depth testing off on
those parts too, and they render inside out. The clone is also renamed, since
`appearanceMaterials` keys derived materials on the source name: sharing a name
would let a dimmed *part* be served the depth-free twin out of that cache.

### Group-aware layout

Layered layout ordered nodes without regard for which group they belong to, so a
boundary drawn around its members could enclose parts that were not members.
Members are now banded into a contiguous lane per rank, with placeholders in the
ranks a group spans but has no member in, columns align to the group's own
position rather than to the centre of the rank, and the gap widens where one lane
meets another.

### A ruler that measures the picture

The critique metric took each plate's *world* axis-aligned bounds. A nameplate
billboards, so it is a tilted rectangle, and the box containing a tilted
rectangle is much bigger than the rectangle — it reported two clearly separated
plates as 34% overlapped. It now projects the plate's own oriented box, and
label clipping is measured by differencing rendered frames rather than by
raycasting a hand-modelled version of the scene.

## 0.5.0 — Getting a diagram out of the browser

0.4 shipped traces and gave them no way out. A PNG cannot hold motion, so the
flagship feature's only distribution channel was recording your screen. The
deeper problem is older: a PNG throws away the one thing that makes this library
different — the parts are modelled, and the reason to model them is that you can
move around them.

Three exports now, in descending fidelity, chosen by what the destination allows.

### `createViewer(el, { doc })`

The missing middle between `createEditor` (palette, inspector, undo, gizmos) and
`renderDocument` (a camera and no interaction). Orbit, focus, traces and
selection events; none of the authoring apparatus. Also the primitive the HTML
export is built from.

### `exportHtml` — one self-contained live file

three.js, the viewer and the document inlined into a single page that fetches
nothing. ~670 kB, which is routinely smaller than a 3840 px PNG of the same
diagram. Exposes `window.isoform` and mirrors it over `postMessage` so a host
page can drive it in an iframe; the document is embedded as readable JSON, so the
file doubles as a data file.

### `exportGif` — a planned camera move

A GIF of a static camera is a worse PNG. Camera, focus and trace compose on **one
clock**, sampled at the same `t`, so they cannot drift:

```ts
await exportGif(doc, { ...turntable({ turns: 1, duration: 6 }), width: 900 })
```

Three decisions carry it: interpolation in **orbit space** (lerping world
positions sends the camera on a chord *through* the diagram), **logarithmic
zoom** (1→4 must pass through 2, not 2.5), and **absolute azimuth** (wrapping to
the shortest arc makes a full turn resolve to standing still).

### Also

- `renderFrames` returns raw RGBA for your own encoder
- `transparent` now reachable from `renderDocument` and `editor.toPNG`. It had
  been implemented in `renderPng` since it was written and exposed by nothing, so
  every exported image carried the opaque dark backdrop
- **GIF** and **HTML** buttons in the editor, with progress and a default
  storyboard — a trace playthrough if one is selected, else a turntable

### Measured, not guessed

- **A 57-second export that should take 8.** `setTimeout(…, 0)` between frames is
  clamped to one second in a background tab, and nobody watches a 120-frame
  export — they switch tabs. A `MessageChannel` yield is a task, not a timer.
- **Dither strength 0.35, not 0.55.** The same 80 frames encoded four ways: no
  diffusion bands visibly, 0.35 resolves it at +46%, and 0.55 costs +139% for a
  picture nobody can tell apart.
- **The encode froze the tab for 6 of 20 seconds.** Now yields between frames and
  reports progress, like the render half already did.

### Framing, and the README images

`frame()` fits the diagram's *bounding box*, and for a system laid out as a chain
that box is mostly air — its eight corners contain nothing, so the fit reserved
the picture for empty volume. Measured on the hero shot, the furthest corner
projected to 0.72 of the frame width: nearly a third of the image was held open
for no reason. `framePoints` fits the corners of each part instead, and recentres
before fitting. `frame` keeps its box behaviour, and for a box the recentring is
provably a no-op, so nothing that called it changed.

The README images were hand-made for 0.3.0 and had drifted: the hero showed two
labels both reading "Edge", filled half its frame, and depicted a version of the
library that no longer existed; the catalog was captioned "24 parts" and rendered
25, including the 4×4 `boundary` container that shrank everything else to specks.
They are now rendered from the live library by a page in the demo, so they cannot
go stale silently.

`renderDocument` also gained `pose` — an arbitrary camera rather than one of the
three presets.

### Dependency

First runtime dependency: `gifenc` (62 kB, no transitive deps). `gif.js` is the
better-known name and ships a separate worker file every consumer must serve,
which would break the library's one-call promise.

It is imported by its ESM file rather than by bare specifier. gifenc declares
both `main` (CommonJS) and `module` (ESM); a bundler picks `module` and named
imports work, but **Node picks `main`** and cannot see them — so `exportGif` threw
at load for anyone consuming the published package from Node, while passing every
test here. Found by installing the packed tarball into a clean project.

---

## 0.4.0 — Explanations

Until now the library could draw what a system **is** and nothing about what
happens in it. A diagram was a static backdrop for a moving argument: someone
points at it and says *"a request comes in here, hits the gateway, and if Redis
is cold it goes all the way to Postgres — that's the path that's slow."* Every
interesting property of a system is a path, a change, or a failure, and none of
them could be drawn.

This release adds the vocabulary for saying those things.

### Traces

A path through the system, stored in the document and played as motion. A packet
travels the **actual routed connectors**, hop by hop, and the parts it reaches
light up behind it.

```ts
doc.traces = [{
  id: 'checkout',
  label: 'Checkout — p99 840ms',
  path: ['web', 'cdn', 'api', 'orders', 'pg'],
  timings: [12, 40, 180, 610],   // ms per hop, optional
}]
```

In text:

```
trace "Checkout" { web -> cdn -> api -> orders -> pg }
trace "Checkout" { web -12-> cdn -40-> api -610-> pg }    # timed
```

Timings are the difference between decoration and information. Without them the
packet moves at constant speed and shows the route; with them, time is divided
by **duration** rather than distance, so the slow hop is visibly slow — which is
usually the whole reason someone is showing you the trace.

The duration sits on the hop it belongs to rather than in a trailing array. A
positionally-mispaired array animates perfectly while stating something false
about which hop is slow, which is the one error the feature exists to reveal.

A path naming two nodes with no connector between them is **reported, not
thrown**. The hops that exist are drawn and the gaps are named.

- `TracePlayer` on the reconciler: `load` · `play` · `pause` · `seek` · `resolve`
- `renderDocument(doc, { trace, traceAt })` for a still of a moving thing
- Transport strip in the editor, hidden unless the document has traces
- `addTrace` / `removeTrace` / `updateTrace`, with inverses

### Semantic node state

`tint` is a colour and means whatever the author decides. `state` is a fixed
vocabulary rendered the same way everywhere, so `degraded` looks like `degraded`
in any diagram anyone makes:

```ts
{ id: 'pg', type: 'database', state: 'degraded' }
```

`healthy` · `degraded` · `down` · `new` · `deprecated` · `planned`.

`healthy` renders identically to unset — they differ only as a claim, one saying
nothing and the other saying someone checked. A diagram where everything is fine
must not read as a diagram where everything is flagged.

### Focus

Emphasise a subset; everything else recedes toward the backdrop.

```ts
renderDocument(doc, { focus: ['orders', 'pg'] })
reconciler.setFocus(['orders', 'pg'])
```

View state, deliberately not document state — one diagram supports as many
arguments as there are subsets worth pointing at. Focus reaches the **whole**
picture: connectors dim when both endpoints are outside the set, and nameplates
dim with the parts they name.

### Connectors to a group boundary

A boundary is now a first-class endpoint. Wiring a tier as one thing is the
point — otherwise every line into "Backend" has to land on some arbitrary member
inside it, and the picture says something the architecture does not.

```
group backend "Backend tier" { orders, pg }
api -> backend
backend -> metrics
```

Connectors dock on the wall facing the other end. Group-to-group works. In the
editor, hovering a boundary reveals its four anchors and a drag lands on them.

### Cursor affordances

One place derives the pointer from what the next click would actually do:
`grab` on a part, `grabbing` while dragging, `crosshair` on an anchor and
throughout a connector drag, `alias` on the rotation ring, `pointer` on a
connector or boundary, `copy` while placing.

### Breaking

- **`Doc.traces` is required.** `emptyDoc()` and `deserialize` supply it; only
  hand-written `Doc` literals need updating.
- **`Reconciler.updateDetail({ focus })` is now `{ detailed }`.** It always meant
  "which parts get their articulated rig", which is a different set from
  emphasis. One name for both invited passing the wrong one, silently.
- **`batchKey(type, appearance, stubs)`** and `NodeBatcher.set(…)` take an
  `Appearance` where they took a tint string.
- `DocEdgeEnd.node` may now name a **group**. Read it as "endpoint". A collision
  between a node id and a group id resolves in the node's favour.

### Fixed

- **Clearing a tint did nothing.** `applyTint` substituted materials on the way
  in and had no way back, so a cleared tint stayed painted. Substitution is now
  reversible by construction — it maps from the shipped material, never from
  whatever is currently assigned.
- **The text format could not resolve forward references.** Declarations were
  resolved where they appeared, and the shipped example puts groups *after*
  edges — so a connector to a boundary could never resolve. Cross-references now
  resolve against the whole file.
- **Untimed traces were silently dropped** by a split pattern that required the
  leading dash of a timed hop.
- **`labels.ts` was classified as binary by git** — a raw NUL byte used as a
  cache-key separator, written as a control character instead of `\0`. The file
  had no reviewable diff.
- A nameplate rebuilt while focus was active came back at full brightness.
- The "reached" marker in a trace was drawn at a fixed radius, so it sat inside
  the footprint of anything wider than a unit and was never visible.

### Internal

- New `foundry/appearance.ts` resolves tint, state and dim in **one** pass.
  Applying them separately means the second discards the first.
- Port geometry is derived from a footprint box rather than a part id, which is
  what let a group become connectable with no special-casing downstream.
- `removeGroup` cascades its edges the way `removeNode` always has.

---

## 0.3.1

README shipped with the package. npm resolves README relative to the package
directory, so 0.3.0's page was blank.

## 0.3.0

First scoped publish as `@satyadip28/isoform`.

## 0.2.0

Production hardening for virtual threads and Spring coverage; `createEditor`
with a real handle and teardown; the editor builds its own DOM and styles.
