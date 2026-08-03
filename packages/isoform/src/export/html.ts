/**
 * A diagram as one self-contained, live HTML file.
 *
 * The native export for this library. A PNG throws away the one thing that
 * makes it worth using — the parts are modelled, and the reason to model them is
 * that you can move around them. This carries that out of the browser it was
 * authored in.
 *
 * Measured: the runtime is ~660 kB and a 3840 px PNG of the same diagram runs
 * 1–3 MB, so the *live* file is routinely smaller than the screenshot it
 * replaces. That is usually the objection, and it is the wrong way round.
 *
 * ## Self-contained means self-contained
 *
 * three.js and the viewer are inlined, not fetched. An exported file has to
 * survive a corporate proxy, an air-gapped wiki, and being double-clicked from
 * a `file://` path out of an email — all of which a CDN reference fails.
 *
 * ## Confluence, which is where these end up
 *
 * Cloud removed the HTML macro and Data Center ships it disabled, so pasting
 * this into page content is the one route that generally will *not* work.
 * Attaching the file and linking it does, and an iframe does where hosting
 * exists — which is why the page also speaks `postMessage`.
 */

import type { Doc } from '../doc/schema.js'
import type { Storyboard } from '../render/shots.js'

export interface HtmlOptions {
  /** Page `<title>`, and the caption shown above the diagram. */
  title?: string
  /** Trace id to start playing on load. */
  autoplay?: string
  /** Idle spin, in radians per second. 0 is off. */
  autoRotate?: number
  labels?: boolean
  grid?: boolean
  /** Reserved: a storyboard to offer as a guided tour. Not yet driven. */
  storyboard?: Storyboard
}

/**
 * Build the file.
 *
 * Async because the runtime is imported dynamically — a bundler can then split
 * ~660 kB out of anyone's application who never calls this.
 */
export async function exportHtml(doc: Doc, opts: HtmlOptions = {}): Promise<string> {
  const runtime = await loadRuntime()
  const title = opts.title ?? 'Diagram'

  const config = {
    autoplay: opts.autoplay ?? null,
    autoRotate: opts.autoRotate ?? 0,
    labels: opts.labels !== false,
    grid: opts.grid === true,
  }

  return page(title, doc, config, runtime)
}

async function loadRuntime(): Promise<string> {
  try {
    const mod = (await import('../generated/viewer-runtime.js')) as { default: string }
    return mod.default
  } catch {
    throw new Error(
      'Isoform: the viewer runtime has not been built. Run `npm run build:runtime` ' +
        '(or a full `npm run build`) to generate it before calling exportHtml.',
    )
  }
}

/**
 * Escape a JSON payload for embedding in a `<script>` block.
 *
 * `</script>` inside a node label would otherwise close the block early and turn
 * the rest of the document into page text — the oldest injection in the book,
 * and entirely reachable here because labels are free text.
 *
 * U+2028 and U+2029 are legal in JSON and are *line terminators* in JavaScript,
 * so a label containing one breaks the script block it lands in.
 *
 * The matcher is built with `String.fromCharCode` rather than written as a regex
 * literal, and that is not fussiness. Spelling them as raw characters makes the
 * literal unterminated — they end the line. Spelling them as `\\u2028` escapes
 * works, but every tool that rewrites this file (editors, codemods, patch
 * appliers) is then one normalisation away from turning the escape back into the
 * raw character and breaking the file silently. Constructing the pattern from
 * code points cannot be mangled by any of them.
 */
const LINE_SEPARATORS = new RegExp(
  `[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
  'g',
)

function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(LINE_SEPARATORS, (c) => (c.charCodeAt(0) === 0x2028 ? '\\u2028' : '\\u2029'))
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)
}

function page(title: string, doc: Doc, config: unknown, runtime: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #0E1116; color: #E7EBF2;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  #isoform-root { position: absolute; inset: 0; }
  /* Non-interactive so it never eats a drag meant for the camera. */
  #isoform-caption { position: absolute; left: 16px; top: 14px; z-index: 2;
    font-size: 13px; letter-spacing: .01em; color: #98A3B4; pointer-events: none; }
  #isoform-hint { position: absolute; right: 16px; bottom: 14px; z-index: 2;
    font-size: 11px; color: #5F6A7B; pointer-events: none; }
</style>
</head>
<body>
<div id="isoform-root"></div>
<div id="isoform-caption">${escapeHtml(title)}</div>
<div id="isoform-hint">drag to orbit · scroll to zoom</div>

<!-- The document, in the open. This file doubles as a data file: extract this
     block and you have the diagram, ready to re-render or edit elsewhere. -->
<script type="application/json" id="isoform-doc">${embedJson(doc)}</script>
<script type="application/json" id="isoform-config">${embedJson(config)}</script>

<script>${runtime}</script>
</body>
</html>
`
}

/** Trigger a download. Browser only. */
export function downloadHtml(html: string, filename = 'diagram.html'): void {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
