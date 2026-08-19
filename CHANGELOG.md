# Changelog

## 0.8.2 — Tags thin out, the way a map's do

Two rounds on one report. The first bounded how far a tag may be slid; this one
decides what happens to the tags that still do not fit, which is the half that
was actually a design decision.

### The threads

`declutter` slides a tag sideways and its leader stem stretches to follow, and
the pass had no limit on the slide. Tags share a chain only if they share a band
of screen height — and a low camera flattens the whole diagram into one band, so
every tag joins one chain, the required gaps accumulate across the entire set,
and the solve spreads them wider than the frame.

Measured on a 26-part diagram 39.6 units across, 7° above the horizon: the median
tag was slid **26.7 units** and the worst **49.5** — further than the whole system
is wide, with 34 of 54 dragged past half the diagram. What that draws is not a
displaced label; it is a hairline stretched clean across the picture. A tag now
travels at most about three of its own widths.

Three and not less: six long tags crammed into two world units genuinely need
that much room, and a tighter bound turned the pass off for diagrams it was
already solving — so the bound was tuned against those tests rather than picked.

### What happens to the rest

Bounding the slide leaves tags overlapping, and a mat of stacked plates is not a
design, it is a shrug. There are three things a renderer can do with a tag that
will not fit, and only one of them is readable:

- **Slide it further** — the threads above.
- **Let it overlap** — honest about the crowding, useless to read.
- **Drop it** — what every map renderer does.

So the set now thins as the view gets harder, exactly the way street-level labels
thin when a map tilts toward the horizon. Boundaries name whole tiers and outlive
parts, parts outlive connectors, ties go to whatever is nearest the camera, and
nothing is deleted — a tag hidden at one angle returns the moment the camera
gives it room.

| | before | after |
|---|---|---|
| worst overlap, low camera | 100% | **15%** |
| collisions, low camera | 58 | 10 |
| tags shown, low camera | 54 of 54, unreadable | 36 of 54, all readable |
| tags shown, hero | 54 of 54 | 45 of 54 |

Nothing is lost where there was room: all five reference architectures keep
**every** tag — 17/17, 14/14, 13/13, 12/12, 10/10 — at 0 collisions.

`critique` now ignores tags the pass dropped. Counting hidden plates would report
faults in a picture that does not contain them.

One measurement bug found on the way: the cull first judged overlap from a probe
of the plate's width and height alone, ignoring its thickness. That box is
smaller than the one drawn, so pairs passed the cull and were then counted as
collisions by the metric — 11 of them, one at 55%, on a view this had just
declared clear. Both now project the plate's full oriented box.

## 0.8.2 — Leaders that stay leaders

The reported fault, correctly this time. 0.8.1 fixed a real defect at *high*
camera angles; what was actually reported was at low ones, where the labels
"create these weird thread-like objects".

Those threads are leader stems. `declutter` slides a tag sideways and the stem
stretches to keep it joined to its part, and the pass had no limit on how far it
would slide. Tags share a chain only if they share a band of screen height — and
a low camera flattens the whole diagram into a single band, so every tag joins
one chain, the required gaps accumulate across the entire set, and the solve
spreads them over a screen distance far wider than the frame.

Measured on a 26-part diagram 39.6 units across, viewed from 7° above the
horizon:

| | before | after |
|---|---|---|
| median slide | 26.7u | 6.4u |
| worst slide | 49.5u | 12.2u |
| tags dragged past half the diagram | 34 of 54 | 0 of 54 |

Tags were being thrown further than the entire system is wide, landing at the
frame edges with a hairline stem stretched across the picture behind them. A tag
now travels at most about three of its own widths and then stays put, overlapping
if it must. An overlap is a local, legible fault; a thread across the frame is
not.

Three, not less: six long tags crammed into two world units genuinely need that
much room to come apart, and a tighter bound turned the pass off for diagrams it
was already solving — caught by the tests written for that case, which is why the
bound was tuned against them rather than chosen.

No cost where it was already working: the five reference architectures still
measure 0 collisions and 0 clipped at the hero pose.

## 0.8.1 — Tags stay readable when you look down at them

Reported from a live export: labels render correctly from some angles and
"stretched sideways" from others. Reproduced at the reported camera, and the
cause is not stretching at all.

Nameplates turned about Y only, so a tag stayed exactly upright in the world
while the camera climbed. An upright plate seen from `el` above the horizon
projects to `cos(el)` of its height:

| camera elevation | height that survives |
|---|---|
| 24° (the hero pose) | 0.91 |
| 46° | 0.70 |
| 69° | 0.36 |
| 83° | 0.12 |

At the hero angle that is a 9% squash nobody notices, which is why it was never
seen in a still. But the viewer lets a reader orbit anywhere, and by 54° the
letterforms are compressed to well under two thirds of their height — which does
not read as "a plate seen from above", it reads as text that has been stretched.
The low-camera screenshot in the same report was pristine, and that is the tell:
the fault tracks elevation exactly.

A tag now holds its ground until the squash is imperceptible and then tips back
only as far as it must, never falling below 0.86 of its height at any elevation.
Below ~31° nothing tilts at all, so the plate keeps reading as a machined object
standing in the scene rather than a sticker pasted over it — which is what
turning about Y alone was protecting, and why this is a cap rather than a full
billboard.

Two things followed from the tilt and would each have been a quiet defect:

- The **leader stem** measured the plate's underside straight down in world Y.
  Once a tag tips, the underside moves with it, and the stem detached visibly. It
  now travels through the plate's own orientation.
- **`declutter`** measured each tag's half-height along world Y for the same
  reason, so past ~31° it was resolving collisions against a box that was not the
  one on screen — precisely the elevation range where tags crowd together and the
  pass matters most.

No change at the hero pose: the five reference architectures measure identically
— 0 collisions, 0 clipped, same frame use and occlusion.

## 0.8.0 — Diagrams are mostly verbs

Found by trying to recreate a stock AWS ECS diagram using nothing but the public
API, as an agent would have to. It has seven labelled connectors — *Create ECS
Cluster*, *Login*, *Access ALB via dynamic port*, *Users accessing container via
SSH* — and the library could draw none of them.

### Connectors carry their labels

`DocEdge.label` was in the schema, accepted by the type checker, and reported by
`dslGaps`. **Nothing rendered it.** The only readers were the DSL's *node* label
and the gap reporter. So a caller set it, saw no error, rendered successfully,
and shipped a diagram with its verbs missing — silent, which is the failure mode
this project keeps having to design against.

```
user -> alb "Access ALB via dynamic port"
alb  -> app "Dynamic port mapping via Target group"
```

The tag sits at the route's **arc-length** midpoint, not its middle vertex: an L
or a Z bunches its corner vertices, so the middle one by index can land almost on
an endpoint. It goes through the same declutter pass as every other tag — a
connector runs *between* parts, so its midpoint is exactly where the parts' own
tags are heading, and a separate pass would let the two collections resolve into
each other. It dims with the line it names, because text is the loudest thing in
a frame and a bright verb on a played-down connector reads as emphasis on it.

Drawn at 0.78 scale. A diagram has more connectors than parts, and at equal
weight the verbs shout over the nouns.

### The text format carries everything it draws

A **sublabel** was renderable and unwritable — the nameplate had always drawn one
and the grammar had no way to say it, so a document using one could be drawn and
could not be exported as text. That is the worst combination available: reaching
for the feature meant leaving the format permanently. A second quoted string is
now the sublabel, and `dslGaps` on the recreated AWS diagram is empty.

### `actor` — the catalog had no people in it

Twenty-five parts, every one of them equipment. Drawing a person meant drawing a
monitor, and in the AWS recreation "User" and "AWS Management Console" rendered
as the same object, separable only by tint.

A mannequin, not a cartoon: no face, no limbs, symmetrical so a turntable never
catches its back, and proportioned to stand a little taller than the monitor
beside it. Two corrections came from looking at it — `pail` is `(rTop, rBottom,
height)`, and passing a height into the second slot produced a wide flared skirt;
then the bellied bucket profile that is right for object storage read as an urn
on a figure, and became a filleted slab.

### `suggestPose`

Every caller was writing this loop. On the AWS diagram it moved the picture from
44% of frame with a label collision and a hidden node, to 60–68% with neither.

```ts
const { pose, critique } = suggestPose(doc)
```

Ranked lexicographically — faults, then framing in 2% steps, then proximity to
the hero azimuth. Not a weighted score: a hidden part is a *fault* and no amount
of frame filling compensates for one. The last term is not cosmetic. Several
poses are usually fault-free with near-identical framing, so ranking on framing
alone is decided by noise — the same document answered 23°, 327° and 147° across
three runs differing only in one part's height — and some of those winners put
the camera behind the client monitor, which scores perfectly while showing the
reader the blank back of the screen.

**It stages the scene once and re-aims.** Calling `critique` per candidate looks
equivalent and is not: a WebGL context is bound to its canvas and
`renderer.dispose()` does not release it, so even sharing one canvas across the
sweep exhausts the browser's supply partway through — and the failure lands on
whatever unrelated render comes next. That is exactly how the first version
failed. `StagedDocument.reframe` is the seam, and 48 candidates now cost ~400 ms.

## 0.7.0 — Surfaces for a reader who cannot orbit

Everything shipped so far assumed someone looking at a screen and moving the
camera. This release is for the cases where nobody can: a pull request, a
printed page, CI, an agent with no eyes.

### `critique` — the ruler, promoted

The measurement harness that drove the 0.6.0 label work was a script in the demo
package. It is now a library call, and it no longer builds its own scene:
`stageDocument` assembles the scene once and both `renderDocument` and `critique`
use it. They had already drifted — the harness fitted the camera at a fixed
margin of 1.08 while the renderer used `1.06 + padding / 20`, which agree at the
default padding and nowhere else. A ruler that quietly measures a different
picture than the one shipped is worse than no ruler.

```ts
const c = critique(doc, { aspect: 16 / 9, labels: true })
c.labelCollisions   // 0
c.occludedIds       // ['tv', 'phone']
c.notes             // the same findings, in words
```

`clipped` is new: nameplates crossing the frame edge, which is a name the reader
cannot finish.

### `toDsl` — the format writes as well as reads

Lossy, and it says so where it matters. Anything the grammar has no room for —
a sublabel, a tier height, a manual route — is written into the output as a
comment beside its declaration, so a fact is never silently dropped. `dslGaps`
returns the same list separately. Positions are the one deliberate exception:
every node has one, none is expressible, and `layout` derives them.

The node line now carries **state** (`pg database "Postgres" down`), so a
marked-up document survives the round trip. Trailing tokens are read as a group
rather than one at a time, which also means a line with two of them reports the
one token it did not understand instead of failing to parse entirely.

### `renderSheet` · `renderStory` · `renderDiff`

Several renders composed into one image, sharing one canvas and therefore one
WebGL context — four separate `renderDocument` calls burn four, and browsers
kill the oldest once about sixteen are live, silently returning blank.

`renderDiff` emphasises only what changed *semantically*. Movement is reported
in the caption and deliberately not lit: adding one node re-runs the layout and
shifted six of nine nodes in the first version, and highlighting almost
everything highlights nothing. `diffDocs` is the same comparison as pure data.

### Depth cueing and a finite stage plate

Both off by default; both change the composition, and silently restyling every
existing render is not a minor-version thing to do.

The cue is fitted to the diagram's **actual depth along the view axis**, taken
from the corners of its bounds. The obvious shorthand — bounding-sphere radius —
is only right for a diagram as deep as it is wide, and system diagrams are wide
and shallow. Fitted that way, the arithmetic reported the far parts as 87% hazed
while the render showed no difference at any strength, because the parts it
called far were not far, only off to one side.

The plate took three attempts, each corrected by looking at it. `steel` is fully
metallic and a metal has no diffuse colour, so a dark grey came back as a sheet
of warm brown reflected off the studio rig. A matte finish barely helped: with a
dark base the broad specular dominates, and the rig's specular is warm. Metalness
zero, roughness one, and the environment turned down leaves it reading as a dark
plate.

### Fixed: every explicit camera pose looked at the world origin

`resolvePose` fills an absent target with `[0, 0, 0]`, so `renderDocument`'s test
for "did the caller name a target" answered yes every time. Any pose that was not
a preset framed the diagram against the origin rather than its own centre, and
`layout` starts at a corner — so the content sat shoved off one edge with empty
space on the other. Found by rendering a rotated view and looking at it; it would
have broken every tile `renderSheet` produces.

### Also

`VERSION` said `0.5.0` throughout the whole of 0.6.0. A test now keeps it in step
with package.json.

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
