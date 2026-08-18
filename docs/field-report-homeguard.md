# Field report: mapping HomeGuard with isoform 0.8.0

An agent used the published package to draw a real system — 26 parts, 40
connectors, 5 boundaries, 4 traces — from a Python codebase it had just read.
This is what that cost, measured.

The picture came out well. This is not about the picture. It is a list of the
levers that were in reach and not pulled, and the ones that were not there.

## What the session actually called

    parseDsl, layout, fitGroups, serialize, dslGaps
    critique(doc, { aspect: 16/9, labels: true })
    suggestPose(doc, opts)
    renderDocument(doc, { width, pose, depthCue, trace, traceAt })
    renderSheet(doc, { width })
    exportHtml(doc, { title })

Six entry points. The result: six PNGs totalling ~8 MB, one 678 kB HTML, and a
26-entry hand-authored position table.

## The four defects, measured

| Defect | Consequence |
|---|---|
| `layout(doc)` returned a 53 × 14 unit strip — 13 ranks, widest rank 4 | unreadable as a still, so all 26 positions were hand-authored |
| At `hero`: 3 label collisions, 33 clipped nameplates | the exported HTML opens at `hero` and cannot be told otherwise |
| 63 connector crossings, 8 routes cutting through a boundary they do not belong to | nothing in the package measures either, so nothing optimised them |
| `renderSheet(doc, { width: 2200 })` produced a 1448 × 896 image | `width` is not a key of `SheetOptions`; it was dropped in silence |

That last one is the shape of much of what follows: the call succeeded, the
picture came out, and the option did nothing.

---

# Part 1 — the script I should have written

Every call below was run against 0.8.0 unless marked as a proposal.

## Step 0. Build the live file in Node, not in a browser

`exportHtml` inlines the runtime and embeds the document as JSON. It renders no
frame, so it has no DOM dependency — verified by running it in plain Node
v25: **677 kB out, autoplay id embedded, no browser involved.** The session
believed otherwise and stood up a static server, a browser pane and an HTTP
sink partly to produce it.

```js
// node build.mjs — no WebGL anywhere in this file
const { doc } = buildDoc(isoform, readFileSync('architecture.iso', 'utf8'))
writeFileSync('architecture.html', await exportHtml(doc, {
  title: 'HomeGuard architecture',
  autoplay: doc.traces[2].id,   // ← opens playing the SD-capture trace
  autoRotate: 0.05,
}))
```

`autoplay`, `autoRotate`, `labels`, `grid` are the whole of `HtmlOptions`
(`export/html.ts:30`). The session passed `title` alone, so four authored
traces shipped inside the file with nothing in the page offering them.

**Node-pure, verified by calling each one:** `parseDsl`, `layout`, `fitGroups`,
`serialize`, `toDsl`, `dslGaps`, `diffDocs`, `resolveEdges`, `exportHtml`.
**Throws `document is not defined`:** `critique`, `suggestPose`,
`renderDocument`, `renderSheet`, `renderStory`, `exportGif`.

## Step 1. Stop hand-authoring positions — or know why you must

`layout(doc, opts)` takes `rankGap`, `nodeGap`, `snap`, `sweeps`
(`layout/autolayout.ts:23`). The session passed none. Tuning them would not
have helped, and the reason is structural rather than a matter of the call:

```
ranks: 13 | widest rank: 4 | extent x: 53.0 z: 14.0
 0 disco agent me          6 relay sd evdb        11 rep
 1 cfg hud mcp             7 ring rec kf          12 reportd arch
 2 api                     8 media ev
 3 aim jobs q ppl          9 yolo
 4 ptz                    10 reid
 5 cam
```

Longest-path ranking marches along +x, so a system whose longest chain is 13
nodes is 13 ranks wide and at most 4 deep whatever the gaps are. The chain is
real — agent → MCP → API → jobs → camera → capture → keyframes → YOLO →
re-id → report → store — and every hop is one a person would say out loud. A
five-tier system came out as one 53-unit diagonal because tiers are not what
the ranker ranks.

Three consequences, all verified:

- **Groups cannot influence rank.** `bandGroups` runs *after* `orderRanks` and
  only permutes within a rank (`autolayout.ts:186`). A boundary pulls its
  members into a lane; it cannot pull them into a column.
- **All five edge kinds rank identically** — adjacency is built from
  `doc.edges` with no reference to `kind` (`autolayout.ts:56-62`). A control
  edge and a data-flow edge concatenate into one spine.
- **There is no pinning.** `layout` ignores any `pos` already on the document,
  so overriding two awkward nodes means owning all 26.

Node declaration order also moves the result: reversing only the node block,
with all 40 edges untouched, moves 20 of 26 nodes and changes which boundary is
drawn wrongly. The ranks are identical across permutations — the sensitivity is
`orderRanks` seeding `byRank` in declaration order, then breaking ties by
`localeCompare`. Sorting `ids` at `autolayout.ts:49` makes all orders produce
byte-identical positions.

**Smallest change that would have saved the table:** honour a per-node pin.
Second smallest: let one edge kind be declared non-ranking, so control edges
stop lengthening the spine.

## Step 2. A layout bug worth fixing before any of that

```js
const { doc } = parseDsl(src)
for (const n of doc.nodes) n.pos = layout(doc).positions.get(n.id)
doc.groups = fitGroups(doc)
// → kf is 43% inside boundary "Local stores", of which it is not a member
```

`laneDepth` reserves the depth of the widest *member* of an absent group
(`autolayout.ts:283`), which is not the clearance a neighbour needs from the
box `fitGroups` draws `GROUP_PAD` beyond it. The comment at
`autolayout.ts:96-99` describes exactly this failure as the one being
prevented — "the picture asserted a containment the document never stated" —
and it still reproduces on a 26-node document.

## Step 3. Wire the tiers, then reorder the edges

Both of these are available today, and together they are the largest single
improvement available to this diagram.

**Edges may terminate on a boundary.** The grammar is an explicit group id plus
an ordinary arrow (`io/dsl.ts:118` for the id, `:226` for resolution). The
system addresses whole tiers as one thing in three places and the map drew all
three as an arrow into whichever member sat nearest the box edge:

```
api -> stores  "plan_lookup · tag · forget · sync · search"
aim -> stores  "aim_calibration.json"
q   -> stores
```

Measured in place with `resolveEdges` in Node, against the session's own
positions: **40 → 38 connectors, 63 → 44 crossings (−30%), total run length
475.7u → 417.6u.**

**Edge order is the only lever on the lane allocator.** `LaneAllocator` is
constructed inside `Router.resolve` (`route/router.ts:652`) and `resolve` takes
no lane parameter, so the caller's only influence is the order of `doc.edges`.
Measured: document order **63** crossings, shortest-span-first **56**, best of
200 random permutations **51**. Stacked on the group endpoints: **63 → 36**.

A crossing count is not in the package — that number came from a counter
written over `resolveEdges`, which is Node-pure and returns exactly what the
renderer draws (verified: 40 routes, rungs `{elbow:16, direct:9, double:8,
search:7}`, identical to the reconciler's own call).

**Caveat, verified:** group-terminated edges parse and route, but `layout`
skips any edge whose endpoints are not both node ids (`autolayout.ts:59`), so
they contribute nothing to ranking. This refactor improves the drawing and
degrades the auto-layout.

## Step 4. The artefact I said did not exist was one call away

The session shipped six whole-system PNGs because it saw no way to carry
subsystem detail. `SheetView` is that way (`render/sheet.ts:114`):

```ts
interface SheetView { pose?; caption?; focus?; trace?; traceAt? }
interface SheetOptions extends ComposeOptions, Omit<SnapshotOptions, 'pose'|'width'> { views? }
```

One image, one WebGL context, one tile per boundary, each captioned — and the
five groups in the document are already the tile list.

Two things to know before writing that call:

**`width` is Omit-ed; the key is `tileWidth`.** `renderSheet(doc, { width: 2200 })`
composed 700 px tiles into 1448 × 896 — confirmed from the PNG header of the
shipped file. Plain JS in an HTML page catches none of this. The type would
have.

**`focus` dims; it does not reframe.** Rendered both ways to be sure. With
`focus` alone the pipeline is still six small parts in a whole-system frame.
Legibility needs the camera moved too:

```js
renderDocument(doc, { width: 1600, focus: pipeline,
  pose: { ...pose, zoom: 0.45, target: [7, 0.4, -9.5] } })
```

That one call produced by far the most readable image of the session. `focus`
without a pose change is a highlight; with one it is a subsystem view.

## Step 5. Aim the exported page

`critique` scored the shipped camera at **0 collisions, 0 clipped, 0 occluded,
frameUse 0.502**, and `hero` at **3 collisions, 33 clipped**. The exported HTML
opens at `hero`, and there is no way to change it: `HtmlOptions` has no `view`,
the viewer defaults to `'hero'` (`render/viewer.ts:223`), and the page's
`setView` is typed `'hero' | 'iso' | 'top'` (`export/runtime-entry.ts:44`), so
not even a host page can post it a pose.

`doc.view` exists and is serialised. The export ignores it. The session did the
work of finding a good camera and then shipped a file that opens at the bad one.

## Step 6. Two cheap measurements never taken

**Connector tags are a third of the label load.** 23 of 40 edges carry labels,
and each tag joins the same declutter pool as the nameplates — 54 plates, not
31. Dropping them for the hero render only, since the document is plain data,
moved frame use from **0.502 to 0.615** with faults still at zero:

```js
const quiet = { ...doc, edges: doc.edges.map((e) => ({ ...e, label: undefined })) }
```

**Padding is insurance, not framing.** Sweeping it: `0.4 → 0.513`,
`1.0 → 0.482`, `1.8 → 0.446` frame use, faults zero throughout. It buys air
against clipping and costs size.

---

# Part 2 — what the library could not do

Ranked by what each cost this session.

### 1. The headless seam exists and nobody knows it does
`stageDocument` is `opts.canvas ?? document.createElement('canvas')`
(`render/snapshot.ts:38`), and **`canvas?: HTMLCanvasElement` is a published
option** on `SnapshotOptions` (`dist/render/snapshot.d.ts:94`), inherited by
`renderDocument`, `critique` and `suggestPose`. Passing one skips the DOM
entirely — verified by handing `renderDocument` a stub object in Node: it got
past `document`, called `getContext('webgl2')` twice, and died only when the
stub returned null.

So the gap is not the seam. It is that nothing says the seam is there: the
README's headless paragraph says "a headless browser will do", the option
carries no recipe, and the session — which read that README carefully — built a
static server, a browser pane and an HTTP sink instead. What is missing is a
documented pairing (`@kmamal/gl` or `headless-gl` behind a small canvas shim)
and one line in the README pointing at `canvas`. That, not an API change, is
what makes `critique` assertable in CI, which is where its value is.

### 2. `img.decode()` deadlocks whenever the tab is not visible
`render/sheet.ts:56-61` composes tiles by awaiting `img.decode()`, with a
comment preferring it to an onload race. In a hidden tab `decode()` never
settles — measured twice here on a 1 × 1 data URL, with `onload` firing
normally in the same page. Every multi-tile export inherits it: a six-tile
`renderSheet` in this environment never returned, while synchronous
`renderDocument` calls on the same page completed.

`createImageBitmap` has no such failure mode, and this was tested rather than
assumed: in the same hidden pane, on the same data URL, `createImageBitmap`
resolved while `decode()` timed out. Swapping that one step made a six-tile
subsystem sheet build first time — `renderDocument` per tile, `fetch` to a
blob, `createImageBitmap`, `drawImage` onto a 2472 x 2283 canvas. The cost of
the current choice is a silent hang, not a slower path.

### 3. Nothing measures connectors
`critique` returns label collisions, clipped plates, occluded parts and frame
use. 63 crossings and 8 routes cutting through a boundary are invisible to all
four, so `suggestPose` — which optimises exactly that tuple — cannot see the
diagram's most obvious visual defect. `resolveEdges` already returns every
polyline in Node, and `segmentHits` / `pointInside` / `polylineClear` are
already implemented inside `route/` but not exported. A `crossings` field is
mostly wiring, and it would let `suggestPose` optimise what readers notice.

### 4. Groups are not obstacles
`obstaclesOf` maps `doc.nodes` only (`route/obstacles.ts:34`), and the router
constructs it internally with no injection point. **8 of 40 routes** in this
diagram pass through the Media plane boundary — a box that reads as an
enclosure being crossed by lines that have no business inside it.

### 5. Nothing fits a camera to a subset
`focus` dims but does not reframe, and there is no companion that does:
`SuggestPoseOptions` is `SnapshotOptions` plus `azimuths` and `elevations`
(`dist/render/critique.d.ts:65-70`), so the pose search always frames the whole
document. A subsystem view therefore needs `pose.target` and `pose.zoom`
computed by the caller, from group boxes the library already has.

Doing that by hand is not reliable. Building the six-tile sheet above with the
obvious heuristic — target the group's centre, zoom by its extent over the
diagram's — clipped two tiles (the media plane and camera control ran off their
frames) and left a third at nearly full-diagram distance. `fitGroups` already
computes every boundary box; a `fit?: Iterable<string>` on `SnapshotOptions`,
or `suggestPose(doc, { only: ids })`, would turn the best artefact this library
can make into a one-liner.

### 6. The frame is fitted to geometry, then labels are placed outside it
`contentPoints()` unions node and group boxes only. Nameplates are positioned
after the camera is final, and declutter slides them in NDC with no clamp to
the frame. The renderer fits a box that excludes the objects it then measures
for leaving that box — which is why tightening the layout raised clipped
nameplates from 19 to 33: tighter parts mean more displacement, and
displacement has nowhere to go.

### 7. The DSL cannot say what the model supports
Verified against the parser, not the README:

| in `DocNode` / `DocEdge` / `DocGroup` | in the DSL |
|---|---|
| `y` — tier height, for stacked placement | no grammar |
| `scale`, `rot` | no grammar |
| `edge.from.port` — pin to a compass anchor | no grammar |
| `route: 'manual'` + `waypoints` | no grammar |
| `group.members` may contain group ids (nesting) | **silently stripped** — `dsl.ts:146` filters members against nodes only, then reports "unknown node(s) in group" |
| `group.cat` — the boundary's own palette | hardcoded to `'compute'` (`dsl.ts:137`) |
| `doc.view`, `doc.theme.hues` | no grammar |

`y` is the one that stings. A five-tier system was drawn on a single plane
because the text format cannot say "this tier sits above that one", while the
document model has had the field all along.

### 8. Traces carry a number and nothing else
`DocTrace` is `{ path, timings }`. These traces span 2 ms to 600000 ms — a
300000× spread that is the whole point of drawing them — and playback divides
by duration with no clamp, no log option and no per-hop cap, so the animation is
99% one hop. There is also nowhere to record *why* a hop is slow: "1:1 with
real time" has to live in a caption or in an edge label that belongs to a
different edge.

---

# Part 2b — what a pass over the whole export list adds

Three things none of the six slices reached, found by reading `src/index.ts`
against what the session wrote.

### The command layer is pure, invertible, and was never touched
`apply(doc, cmd)`, `invert(doc, cmd)` and `History` (`doc/commands.ts:71`,
`:158`, `doc/history.ts:21`) all run in Node. Every post-parse mutation this
report recommends has an exact Command spelling, and the session hand-mutated
plain objects for all of them instead:

```js
apply(doc, { t: 'batch', cmds: [
  { t: 'updateNode',  id: 'api',   props: { y: 1.4 } },              // the tier lift
  { t: 'updateGroup', id: 'stores', props: { cat: 'data' } },        // the boundary palette
  { t: 'updateEdge',  id: 'e12',   props: { from: { node: 'api', port: 'e' } } },
  { t: 'updateEdge',  id: 'e12',   props: { label: null } },         // null deletes the field
  { t: 'setView',     view: { ...doc.view, ...pose } },              // commit the found camera
]})
```

Two details that matter. `merge` reads an explicit `null` as "delete this
optional field" (`commands.ts:50-58`) — which is the supported spelling of the
strip-connector-tags trick this report reaches for by object spread. And
`invert` returns the exact inverse, so a build script can apply a set of
presentation overrides and hand back the document it was given.

### `setTheme` is the per-category hue control the DSL lacks
`{ t: 'setTheme', cat, hex }` writes `doc.theme.hues[cat]` — the thing the text
format cannot say and the editor's colour dropdown drives. It is
per-*category*, not per-boundary, so it does not replace `group.cat`; the two
together are the whole colour surface.

### `renderPng` is the only way to reach multisampling
`SnapshotOptions` has no `samples` key; `PngOptions` does (`io/png.ts:12`),
along with `hide` for suppressing scene objects. Every still in this session was
rendered at the default sampling because the high-level path cannot ask for
more. `renderPng(renderer, scene, camera, { samples })` needs a `Stage` of your
own, which is a real step up in effort for what should be one option.

---

# Part 3 — if only three things changed

1. **Document the canvas you already surfaced,** with a WebGL2 pairing that
   works. The option is there; nothing points at it, so the library reads as
   browser-only when it is one paragraph away from being CI-usable.
2. **Let `exportHtml` open where the author aimed it** — one `view` option, and
   a trace picker in the runtime. The live file is the best artefact this
   library makes, and it currently ships pointed at the wrong camera with its
   traces unreachable.
3. **Pin positions in `layout`.** Every real diagram has three nodes the ranker
   gets wrong. Today that costs the whole table.

---

## How this was verified

Six agents read `packages/isoform/src` and the published `dist`; a second pass
opened every cited file and re-ran the claims, correcting six of them. Numbers
quoted here were produced by running code against
`HomeGuard/docs/architecture.iso`: PNG dimensions from file headers; rank
structure and boundary trespass from `layout` in Node; the DOM boundary by
calling each export in Node v25; crossing counts and run lengths from
`resolveEdges` in Node; frame-use figures from `critique` in a browser pane;
and `img.decode()` behaviour from a timed race in that same pane.
