/**
 * The self-contained HTML export.
 *
 * Two properties matter and neither is visible by opening the file once on a
 * machine that happens to have a network:
 *
 * · **Containment.** One missed external reference and the export works
 *   perfectly for whoever made it and is a blank rectangle behind a corporate
 *   proxy, in an air-gapped wiki, or on a laptop on a train.
 * · **Escaping.** Node labels are free text, and the document is embedded in a
 *   `<script>` block. A label containing `</script>` closes the block early and
 *   turns the rest of the file into page content.
 */

import { describe, expect, it } from 'vitest'
import { exportHtml } from './html.js'
import { emptyDoc, type Doc } from '../doc/schema.js'

/* The runtime is a build artifact, not a source file. Where it is missing these
   are skipped rather than failed — a clean checkout has not built it yet, and a
   red suite that only means "run the build" trains people to ignore red.
   Probed by import rather than by `existsSync` so the check runs the same way in
   a browser as in node, and needs no filesystem types. */
const runtimeBuilt = await import('../generated/viewer-runtime.js').then(
  () => true,
  () => false,
)
const whenBuilt = runtimeBuilt ? it : it.skip

function doc(label = 'Browser'): Doc {
  const d = emptyDoc()
  d.nodes = [
    { id: 'web', type: 'client', label, pos: [0, 0], rot: 0 },
    { id: 'api', type: 'gateway', label: 'API', pos: [4, 0], rot: 0 },
  ]
  d.edges = [{ id: 'e1', from: { node: 'web' }, to: { node: 'api' }, kind: 'sync', route: 'auto' }]
  d.traces = [{ id: 't1', label: 'Hit', path: ['web', 'api'] }]
  return d
}

describe('exportHtml', () => {
  whenBuilt('fetches nothing — no script src, no stylesheet link', async () => {
    const html = await exportHtml(doc())
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i)
    expect(html).not.toMatch(/<link[^>]+\bhref=/i)
    expect(html).not.toMatch(/@import/i)
  })

  whenBuilt('inlines a runtime big enough to actually contain three.js', async () => {
    /* A tiny file would mean the bundle failed to include three and every export
       would be a blank page that only fails once someone opens it. */
    const html = await exportHtml(doc())
    expect(html.length).toBeGreaterThan(200_000)
  })

  whenBuilt('cannot be broken out of by a node label', async () => {
    const html = await exportHtml(doc('Browser </script><script>window.pwned=1</script>'))
    /* The payload must survive as escaped data and never as a second script. */
    expect(html).not.toMatch(/<script>window\.pwned/)
    expect(html).toContain('\\u003c/script\\u003e')
  })

  whenBuilt('embeds a document that parses back to the same diagram', async () => {
    const source = doc()
    const html = await exportHtml(source)
    const block = html.match(/id="isoform-doc">([\s\S]*?)<\/script>/)
    expect(block).toBeTruthy()

    /* Undo only the two escapes the embedding applies. */
    const json = block![1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')
    const back = JSON.parse(json) as Doc
    expect(back.nodes.map((n) => n.id)).toEqual(['web', 'api'])
    expect(back.edges).toHaveLength(1)
    expect(back.traces[0].path).toEqual(['web', 'api'])
  })

  whenBuilt('escapes the title rather than letting it inject markup', async () => {
    const html = await exportHtml(doc(), { title: '<img onerror=alert(1)>' })
    expect(html).not.toContain('<img onerror')
    expect(html).toContain('&lt;img onerror=alert(1)&gt;')
  })

  whenBuilt('carries the boot options into the page', async () => {
    const html = await exportHtml(doc(), { autoplay: 't1', autoRotate: 0.2, grid: true })
    const block = html.match(/id="isoform-config">([\s\S]*?)<\/script>/)
    const cfg = JSON.parse(block![1]) as Record<string, unknown>
    expect(cfg).toMatchObject({ autoplay: 't1', autoRotate: 0.2, grid: true, labels: true })
  })

  it('says what to do when the runtime has not been built', async () => {
    /* The one failure a consumer will actually hit, so it has to name the fix
       rather than surface a module-resolution error from deep in a bundler. */
    if (runtimeBuilt) return
    await expect(exportHtml(doc())).rejects.toThrow(/npm run build:runtime/)
  })
})
