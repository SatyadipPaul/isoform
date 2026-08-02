# Isoform

Machined 3D system architecture diagrams for the browser. Parts are modelled as
the objects they represent — a rack chassis, a shipping container, a bucket with
a handle, a signpost — under one locked studio rig.

![A diagram built with Isoform](https://raw.githubusercontent.com/SatyadipPaul/isoform/main/docs/hero.png)

One package: a part catalog, a document model, an orthogonal router, a renderer,
and an editor you mount with a single call.

## Install

```bash
npm install @satyadip28/isoform three
```

`three` is a **peer dependency**, deliberately. An app that already uses three
must not end up with two copies — that breaks `instanceof` across the boundary
and ships the runtime twice.

Requires WebGL2 and `three` >= 0.180.

Scoped because npm refused the bare name: *"Package name too similar to
existing package iso-form"*. Scoped packages skip that similarity check.

## Quick start

```ts
import { createEditor } from '@satyadip28/isoform'

const editor = createEditor(document.getElementById('app')!)
```

```html
<div id="app" style="width: 100vw; height: 100vh"></div>
```

That is the whole of it. The editor builds its own DOM and injects its own
styles — there is no markup to copy and no stylesheet to remember to import. It
fills the element you give it rather than positioning against the viewport, so
it works just as well in a panel, a split view or a modal.

## Recipes

### Open with a diagram written as text

Text carries no positions, so run `layout` over it before showing it — that is
the point of describing a system rather than placing it.

```ts
import { createEditor, parseDsl, layout, fitGroups } from '@satyadip28/isoform'

const { doc, issues } = parseDsl(`
  web    client   "Browser"
  api    gateway  "API"
  svc    service  "Orders"
  pg     database "Postgres"
  mq     queue    "Jobs"
  w      worker   "Fulfilment"

  web -> api
  api -> svc
  svc => pg
  svc ~> mq
  mq  -> w

  group "Backend" { svc, pg }
`)
if (issues.length) console.warn(issues)   // { line, message }[]

const { positions } = layout(doc)
for (const node of doc.nodes) node.pos = positions.get(node.id) ?? node.pos
doc.groups = fitGroups(doc)

createEditor(el, { doc })
```

**Connector kinds:** `->` sync, `~>` async, `=>` flow, `+>` secure, `<->`
duplex. A trailing `#` starts a comment; a trailing `#rrggbb` is a tint.

### Build a document in code

```ts
import { createEditor, emptyDoc, type Doc } from '@satyadip28/isoform'

const doc: Doc = emptyDoc()
doc.nodes = [
  { id: 'web', type: 'client',   label: 'Browser',  pos: [-4, 0], rot: 0 },
  { id: 'api', type: 'gateway',  label: 'API',      pos: [0, 0],  rot: 0 },
  { id: 'db',  type: 'database', label: 'Postgres', pos: [4, 0],  rot: 0, tint: '#3ED8BC' },
]
doc.edges = [
  { id: 'e1', from: { node: 'web' }, to: { node: 'api' }, kind: 'sync', route: 'auto' },
  { id: 'e2', from: { node: 'api' }, to: { node: 'db'  }, kind: 'flow', route: 'auto' },
]

createEditor(el, { doc })
```

`pos` is `[x, z]` on the ground plane in grid units; `rot` is yaw in radians.
Positions snap to 0.5u in the editor, but any value is legal.

### Persist what the user draws

```ts
import { createEditor, serialize, deserialize } from '@satyadip28/isoform'

const saved = localStorage.getItem('diagram')
const editor = createEditor(el, { doc: saved ? deserialize(saved) : undefined })

const stop = editor.onChange((doc) => {
  localStorage.setItem('diagram', serialize(doc))
})
```

`onChange` returns an unsubscribe. `editor.save()` gives you the document
directly if you would rather pull than subscribe.

### Render an image with no editor

For a thumbnail service, a CI artefact, or a docs build. Needs a WebGL context —
a headless browser will do — but no visible canvas and no user.

```ts
import { parseDsl, layout, fitGroups, renderDocument } from '@satyadip28/isoform'

const { doc } = parseDsl(source)
const { positions } = layout(doc)
for (const node of doc.nodes) node.pos = positions.get(node.id) ?? node.pos
doc.groups = fitGroups(doc)

const png = renderDocument(doc, { width: 1920, preset: 'hero' })
// a data: URL. preset is 'hero' | 'iso' | 'top'
```

Measured at roughly 850ms per render; the first call pays about 3s more to warm
the geometry and texture caches. The document is not modified.

### Mount it in React

```tsx
import { useEffect, useRef } from 'react'
import { createEditor, type Doc } from '@satyadip28/isoform'

export function DiagramEditor({ doc, onChange }: {
  doc?: Doc
  onChange?: (doc: Doc) => void
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editor = createEditor(host.current!, { doc })
    const stop = onChange ? editor.onChange(onChange) : undefined
    return () => {
      stop?.()
      editor.destroy()     // DOM, window listeners and the render loop
    }
  }, [])

  return <div ref={host} style={{ width: '100%', height: '100%' }} />
}
```

`destroy()` is required, not optional — an editor that outlives its container
keeps a WebGL context and a render loop alive.

### Trim the chrome

```ts
createEditor(el, {
  chrome: {
    title: 'Architecture',  // '' drops the wordmark entirely
    help: false,            // the keyboard-shortcut strip
    dsl: false,             // the Text button and its sheet
    files: false,           // PNG / Save / Load
  },
})
```

### Use the engine without the editor

Everything below the editor is exported: the part registry, the document model
and its undo stack, the router, the layout pass and the whole geometry foundry.
`createEditor` is one consumer of that, not a wrapper around it.

```ts
import { Stage, Reconciler, History, palette } from '@satyadip28/isoform'

const stage = new Stage({ canvas })
const reconciler = new Reconciler(stage.scene, {
  anchorIdle: palette('link').lit('lit', 0.9),
})
const history = new History(doc)

history.subscribe((doc) => reconciler.sync(doc))
```

The document model, layout, routing and serialisation are pure and run in Node
with no DOM — useful for validating or generating diagrams server-side.

## The catalog — 24 parts

![The 24 parts at palette size](https://raw.githubusercontent.com/SatyadipPaul/isoform/main/docs/catalog.png)

| Group | Parts |
|---|---|
| Compute | Service · API gateway · Load balancer · Serverless · Container · **Worker** · **Model endpoint** |
| Data | Relational store · Cache · Object storage · Warehouse · **Search index** · **Vector store** |
| Messaging | Queue · Event stream |
| Edge & network | Edge node · Firewall · **DNS** |
| Control plane | **Identity** · **Observability** · **Service registry** |
| Client & external | Client device · **Handset** · **Third party** |

Ten of these were added after auditing the catalog against the AWS, Kubernetes
and network-diagram icon vocabularies. The gap that audit found was not breadth
— it was that the **operational plane was entirely missing**: a queue shipped
with nothing to consume it, and there was nowhere to put the thing that
authenticates, the thing that watches, or the thing that knows where everything
is. Those were being drawn as tinted services, which is as informative as not
drawing them.

The target is deliberately not parity with AWS's 900 icons. Twenty-four parts
that look like they came from one factory beat two hundred that look like a
clip-art folder, so each addition is modelled as the object it represents and
has to survive the catalog's own rule: **recognisable at 40px with no label.**

`ops` is a sixth category with its own colour — violet, between compute's indigo
and edge's rose — so a control plane reads as its own layer rather than
dissolving into the services it governs. `Category` is exported, and both the
DSL's accepted-category set and the editor's boundary-colour dropdown derive
from it rather than repeating the list.

Two parts sit in `client` that are not clients: **Handset** and **Third party**.
That category means *outside the system you are drawing*, and neutral slate is
right for all three — a third-party service is not yours to colour.

**Vector store is data and Model endpoint is compute.** A vector store is a
database and an inference endpoint runs computation; giving them a bespoke hue
would be marketing rather than information design.

## API

### `createEditor(container, options?)` → `Editor`

| Option | Type | Default | |
|---|---|---|---|
| `doc` | `Doc` | sample diagram | Document to open with |
| `chrome` | `ChromeOptions` | all shown | Which chrome to build |
| `debug` | `boolean` | `false` | Expose internals as `editor.debug` |

| Member | |
|---|---|
| `doc` | The document as it stands. Structurally shared — treat as read-only |
| `load(doc)` | Replace the document, discarding undo history |
| `save()` | Snapshot of the current document |
| `onChange(fn)` | Fires after any change. Returns an unsubscribe |
| `fit()` | Re-frame the camera on the diagram |
| `toPNG(width?)` | Data URL, without the editing scaffolding |
| `destroy()` | Remove the DOM, drop listeners, stop the render loop |

### Other entry points

| | |
|---|---|
| `parseDsl(text)` | `{ doc, issues }` — text to document |
| `layout(doc)` | `{ positions, ranks }` — layered auto-layout |
| `fitGroups(doc)` | Boundary boxes refitted to their members |
| `renderDocument(doc, opts?)` | PNG data URL, no editor |
| `serialize` / `deserialize` | Document to and from a JSON string |
| `MANIFESTS` / `PART_IDS` | The part catalog, as data |

## Keyboard

| | |
|---|---|
| Place | drag from the palette, snaps to 0.5u, `Alt` frees the snap |
| Select | click a part, connector or boundary; `Shift`+click to extend |
| Move | drag — one gesture is one undo step |
| Rotate | drag the ring, or `[` / `]`; snaps to 15°, `Alt` frees it |
| Group | `Ctrl`+`G`, `Ctrl`+`Shift`+`G` to ungroup; boundaries nest |
| Connect | hover for anchors, drag an anchor onto another part |
| Delete / duplicate | `Del` · `Ctrl`+`D` |
| Undo / redo | `Ctrl`+`Z` · `Ctrl`+`Shift`+`Z` or `Ctrl`+`Y` |
| Views | Hero · Iso · Top · `F` to fit |

## Contributing

Source, design notes and the full engineering record: [https://github.com/SatyadipPaul/isoform](https://github.com/SatyadipPaul/isoform).
