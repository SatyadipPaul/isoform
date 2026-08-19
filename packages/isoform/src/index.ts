/** isoform — machined 3D system diagrams. */

/* Kept in step with package.json by a test, because nothing else notices: this
   sat at 0.5.0 through the whole of the 0.6.0 release without a single check
   failing, and it is the string a consumer reads when reporting a bug. */
export const VERSION = '0.8.2'

export * from './foundry/rng.js'
export * from './foundry/textures.js'
export * from './foundry/geometry.js'
export * from './foundry/materials.js'
export * from './foundry/appearance.js'
export * from './foundry/env.js'

export * from './parts/registry.js'
export { boundary, type BoundaryOptions } from './parts/boundary.js'

export * from './doc/schema.js'
export * from './doc/commands.js'
export * from './doc/history.js'
export * from './doc/io.js'

export * from './route/router.js'
export * from './route/styles.js'

export * from './layout/autolayout.js'
export * from './io/dsl.js'
export * from './io/emit.js'
export * from './io/png.js'

export * from './render/camera.js'
export * from './render/stage.js'
export * from './render/reconciler.js'
export * from './render/trace.js'
export * from './render/shots.js'
export * from './render/frames.js'
export * from './render/viewer.js'
export * from './export/gif.js'
export * from './export/html.js'
export * from './render/labels.js'
export * from './render/snapshot.js'
export * from './render/critique.js'
export * from './render/sheet.js'

/* The mountable editor. `createEditor(container)` is the whole of it — see
   editor/chrome.ts for why the DOM and styles ship with the code rather than
   being something an embedder has to copy. */
export { createEditor, type Editor, type EditorOptions } from './editor/editor.js'
export { type ChromeOptions } from './editor/chrome.js'
export { PALETTE_GROUPS, partLabel, renderThumbnails } from './editor/thumbnails.js'
export { SEED_DOC } from './editor/seed.js'
