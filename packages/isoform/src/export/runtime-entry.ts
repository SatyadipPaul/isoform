/**
 * The script that runs inside an exported HTML file.
 *
 * Bundled to a standalone IIFE — three.js and the viewer included — and inlined
 * into the page by `exportHtml`. Nothing here may reach the network: the whole
 * point of the export is that it survives a corporate proxy, an air-gapped wiki
 * and a `file://` double-click from an email attachment.
 *
 * It reads the document out of the page rather than having it compiled in, so
 * the exported file doubles as a data file: the JSON is sitting there in a
 * `<script type="application/json">` block for anyone who wants to extract the
 * diagram and drive it themselves.
 */

import { createViewer, type Viewer } from '../render/viewer.js'
import type { Doc } from '../doc/schema.js'

interface BootConfig {
  autoplay?: string | null
  autoRotate?: number
  labels?: boolean
  grid?: boolean
}

declare global {
  interface Window {
    isoform?: IsoformPageApi
  }
}

/**
 * What an exported page exposes.
 *
 * This is the surface that turns the export from a picture into a component —
 * a host page can drive it, and a click inside it can drive the host.
 */
export interface IsoformPageApi {
  readonly viewer: Viewer
  readonly doc: Doc
  focus(ids: string[] | null): void
  playTrace(id: string): boolean
  pauseTrace(): void
  seekTrace(u: number): void
  setView(view: 'hero' | 'iso' | 'top'): void
  fit(): void
  on(event: 'select' | 'hover', fn: (id: string | null) => void): () => void
}

function readDoc(): Doc {
  const el = document.getElementById('isoform-doc')
  if (!el?.textContent) throw new Error('Isoform: no embedded document found')
  return JSON.parse(el.textContent) as Doc
}

function readConfig(): BootConfig {
  const el = document.getElementById('isoform-config')
  return el?.textContent ? (JSON.parse(el.textContent) as BootConfig) : {}
}

function boot(): void {
  const mount = document.getElementById('isoform-root')
  if (!mount) throw new Error('Isoform: no mount element')

  const doc = readDoc()
  const cfg = readConfig()
  const viewer = createViewer(mount, {
    doc,
    labels: cfg.labels,
    grid: cfg.grid,
    autoRotate: cfg.autoRotate,
  })

  const api: IsoformPageApi = {
    viewer,
    doc,
    focus: (ids) => viewer.focus(ids),
    playTrace: (id) => viewer.playTrace(id),
    pauseTrace: () => viewer.pauseTrace(),
    seekTrace: (u) => viewer.seekTrace(u),
    setView: (v) => viewer.setView(v),
    fit: () => viewer.fit(),
    on: (e, fn) => viewer.on(e, fn),
  }
  window.isoform = api

  if (cfg.autoplay) viewer.playTrace(cfg.autoplay)

  /**
   * The same surface over `postMessage`, which is what makes an iframe embed
   * programmable. A host page cannot reach into a cross-origin frame's globals,
   * and an exported diagram is very often in one.
   *
   * Replies are posted back to the sender's origin rather than `*` so a page
   * that embeds this does not leak its selections to every other frame.
   */
  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { isoform?: string; args?: unknown[] } | null
    if (!msg || typeof msg.isoform !== 'string') return
    const fn = (api as unknown as Record<string, unknown>)[msg.isoform]
    if (typeof fn !== 'function') return
    const result = (fn as (...a: unknown[]) => unknown)(...(msg.args ?? []))
    const reply = { isoform: msg.isoform, result: typeof result === 'function' ? null : result }
    ;(e.source as Window | null)?.postMessage(reply, e.origin === 'null' ? '*' : e.origin)
  })

  for (const event of ['select', 'hover'] as const) {
    viewer.on(event, (id) => {
      window.parent?.postMessage({ isoform: 'event', event, id }, '*')
    })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
