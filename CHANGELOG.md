# Changelog

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
