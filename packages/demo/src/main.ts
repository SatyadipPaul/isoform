/**
 * Demo host for the library.
 *
 * Everything this file used to contain — 1600 lines of editor — now lives in
 * `isoform` itself. What is left is the whole public surface of mounting one,
 * which is the point: if embedding the editor takes more than this, it is not
 * packaged.
 */

import * as Isoform from 'isoform'

const editor = Isoform.createEditor(document.getElementById('app')!, { debug: import.meta.env.DEV })

if (import.meta.env.DEV) {
  /* The verification harness drives the editor through these. `Isoform` is the
     whole library surface — the demo is the one page allowed to reach for it,
     since demonstrating it is the job. */
  Object.assign(globalThis, { __iso: editor.debug, __editor: editor, Isoform })
}
