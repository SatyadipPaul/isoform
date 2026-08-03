/**
 * Render the five recreations, and report anything the library could not draw.
 *
 * The issue list and the trace gaps are the interesting output. A picture that
 * renders is not evidence the diagram is right — an unresolved hop or a dropped
 * edge produces a perfectly good-looking image of the wrong system.
 */

import {
  fitGroups,
  layout,
  parseDsl,
  renderDocument,
  Reconciler,
  palette,
  type Doc,
} from '@satyadip28/isoform'
import * as THREE from 'three'
import { EXAMPLES, type Example } from './examples.js'
import { measure } from './critique.js'

const SINK = 'http://localhost:5199/'
const out = () => document.getElementById('out')!
const log = (s: string) => {
  document.getElementById('log')!.textContent += s + '\n'
}

function build(ex: Example): { doc: Doc; issues: string[] } {
  const { doc, issues } = parseDsl(ex.dsl)
  const { positions } = layout(doc)
  for (const n of doc.nodes) {
    const p = positions.get(n.id)
    if (p) n.pos = p
  }
  doc.groups = fitGroups(doc)
  return { doc, issues: issues.map((i) => `line ${i.line}: ${i.message}`) }
}

/**
 * Hops in a trace with no connector under them.
 *
 * Resolved against a real reconciler rather than by inspecting the document,
 * because a hop is only drawable if the *router* produced a line for it.
 */
function traceGaps(doc: Doc): string[] {
  const rec = new Reconciler(new THREE.Scene(), { anchorIdle: palette('link').lit('lit', 0.9) })
  rec.sync(doc)
  const bad: string[] = []
  for (const t of doc.traces) {
    for (const g of rec.trace.resolve(t).gaps) bad.push(`${t.label ?? t.id}: ${g.from} → ${g.to}`)
  }
  return bad
}

async function render(ex: Example, save: boolean): Promise<void> {
  const card = document.createElement('div')
  card.className = 'case'
  card.innerHTML =
    `<h2>${ex.title}</h2><p class="src">${ex.source}</p><p class="note">${ex.note}</p>`
  out().append(card)

  const { doc, issues } = build(ex)
  const gaps = traceGaps(doc)

  if (issues.length || gaps.length) {
    const p = document.createElement('p')
    p.className = 'bad'
    p.textContent = [...issues.map((i) => `dsl ${i}`), ...gaps.map((g) => `trace gap — ${g}`)].join('\n')
    card.append(p)
  }

  const trace = doc.traces[0]
  const url = renderDocument(doc, {
    width: 1700,
    aspect: 2,
    labels: true,
    padding: 0.4,
    trace: trace?.id,
    traceAt: 0.55,
  })
  const img = new Image()
  img.src = url
  img.alt = ex.title
  card.append(img)

  const m = measure(doc, 2)
  log(
    `${ex.id.padEnd(10)} ${String(doc.nodes.length).padStart(2)}p ${String(doc.edges.length).padStart(2)}e · ` +
      `label collisions ${String(m.labelCollisions).padStart(2)} (worst ${(m.worstOverlap * 100).toFixed(0)}%) · ` +
      `frame ${(m.frameUse * 100).toFixed(0)}% · weight ×${m.weightRange.toFixed(1)} · ` +
      `occluded ${m.occluded}` +
      (issues.length ? ` · ${issues.length} DSL ISSUES` : '') +
      (gaps.length ? ` · ${gaps.length} TRACE GAPS` : ''),
  )

  if (save) {
    const a = document.createElement('a')
    a.href = url
    a.download = `${ex.id}.png`
    a.click()
  }
  await fetch(SINK + ex.id, { method: 'POST', body: url }).catch(() => {})
}

async function main(save: boolean): Promise<void> {
  document.getElementById('log')!.textContent = ''
  out().replaceChildren()
  for (const ex of EXAMPLES) await render(ex, save)
}

document.getElementById('save')!.addEventListener('click', () => void main(true))
void main(false)
